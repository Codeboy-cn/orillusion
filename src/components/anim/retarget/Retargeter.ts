/**
 * Animation retargeting utility — copies per-bone rotations (and the
 * hip's translation, optionally) from a source AnimatorComponent to a
 * target AnimatorComponent each frame.
 *
 * **Rotation channel — world-space delta with full Character FK.**
 * For every retargeted bone:
 *
 *   delta_world = currentWorld_S * inv(bindWorld_S)
 *   desired_world_T = delta_world * bindWorld_T
 *   target.localQ = inv(parentCurrentWorld_T) * desired_world_T
 *
 * Including the Character (skeleton root) rotation in the FK chain is
 * what makes this work across rigs whose per-bone bind orientations
 * differ — a bone-local-frame delta would silently hit anti-parallel
 * axes on Mixamo cross-rig (Michelle vs Soldier) and fold the target
 * sideways. With Character rotation folded in, the bind world frames
 * align between rigs and the world delta transfers anatomical motion.
 *
 * **Translation channel — hip position only, with optional height
 * scaling.** Mirrors three.js `SkeletonUtils.retarget`'s
 * `preserveHipPosition` semantics:
 *
 *   delta_charLocal_S = sourceHip.localPosition - bindHipLocal_S
 *   delta_world       = rootRot_S * delta_charLocal_S
 *   delta_charLocal_T = inv(rootRot_T) * delta_world
 *   targetHip.localPosition = bindHipLocal_T + delta_charLocal_T * heightScale
 *
 * Children bones never receive position updates — Mixamo characters
 * have different bone-segment lengths, and forcing source positions
 * onto target bones distorts the mesh shape (limbs end up in wrong
 * places relative to body proportions). The hip is the one bone where
 * translation is meaningful: it carries root motion (jumps, walks,
 * crouches), and scaling its delta by the rig height ratio keeps
 * Soldier from "flying" or "sinking" relative to a taller Michelle.
 *
 * Bone resolution between the two rigs:
 *   1. explicit `nameMap` in the config (highest priority)
 *   2. exact (case-insensitive) name match, with `mixamorig:` /
 *      `Armature|` prefixes stripped
 *
 * @group Animation
 */
import { Quaternion } from "../../../math/Quaternion";
import { Vector3 } from "../../../math/Vector3";
import type { AnimatorComponent } from "../AnimatorComponent";
import type { PrefabAvatarData } from "../../../loader/parser/prefab/prefabData/PrefabAvatarData";

export interface RetargeterConfig {
    source: AnimatorComponent;
    target: AnimatorComponent;
    /** Optional explicit source-bone-name → target-bone-name mapping. */
    nameMap?: Map<string, string> | { [src: string]: string };
    /** Bone names on the source that should be ignored. */
    excludeSourceBones?: Set<string>;
    /**
     * When true (default) the retargeter computes a world-space delta
     * from each rig's bind pose so the target tracks the source's
     * motion even when the two rigs have different bind orientations.
     * Set to false for same-rig retargeting where you really want a
     * strict identity copy of local rotations.
     */
    useRestOffset?: boolean;
    /**
     * If true, the hip (root joint) position is locked to the target's
     * bind pose — root motion (jumps, walks, crouches) is dropped.
     * Default false: the source hip's position delta is replayed on
     * the target, scaled by `heightScale`. Equivalent to three.js's
     * `SkeletonUtils.retarget(... { preserveHipPosition })`.
     */
    preserveHipPosition?: boolean;
    /**
     * Multiplier applied to the hip translation delta before writing
     * it onto the target. Use the height ratio (target rig height /
     * source rig height) when the two rigs are different sizes —
     * otherwise a 0.5m source jump on a 1.8m rig produces an over- or
     * under-jump on a 1.6m target. Default 1.0 (no scaling).
     */
    heightScale?: number;
}

interface ResolvedPair {
    srcName: string;
    tgtName: string;
}

export class Retargeter {
    private _source: AnimatorComponent;
    private _target: AnimatorComponent;
    private _nameMap: Map<string, string>;
    private _exclude: Set<string>;
    private _useRestOffset: boolean;
    private _preserveHipPosition: boolean;
    private _heightScale: number;

    private _resolved: ResolvedPair[] | null = null;
    /** target boneName → source boneName, for quick reverse lookup in apply(). */
    private _tgtToSrc: Map<string, string> = new Map();
    /** source bone bind worldQ (FK starting from source root rotation). */
    private _bindWorldS: Map<string, Quaternion> = new Map();
    /** target bone bind worldQ (FK starting from target root rotation). */
    private _bindWorldT: Map<string, Quaternion> = new Map();
    /** source rig root (Character node) rotation captured at buildMapping. */
    private _rootRotS = new Quaternion();
    /** target rig root (Character node) rotation captured at buildMapping. */
    private _rootRotT = new Quaternion();
    /** Hip pair name + bind localPosition for the position channel. */
    private _hipSrcName: string | null = null;
    private _hipTgtName: string | null = null;
    private _bindHipLocalPosS = new Vector3();
    private _bindHipLocalPosT = new Vector3();
    /** scratch reusable quaternions/vectors to avoid per-frame GC pressure. */
    private _scratchA = new Quaternion();
    private _scratchB = new Quaternion();
    private _scratchInvBindS = new Quaternion();
    private _scratchInvParentT = new Quaternion();
    private _scratchInvRootRotT = new Quaternion();
    private _scratchHipDelta = new Vector3();
    private _scratchHipPos = new Vector3();
    /** per-bone tracked currentWorldQ during apply(); reused, cleared each call. */
    private _currentWorldS: Map<string, Quaternion> = new Map();
    private _currentWorldT: Map<string, Quaternion> = new Map();

    constructor(cfg: RetargeterConfig) {
        this._source = cfg.source;
        this._target = cfg.target;
        if (!cfg.nameMap) {
            this._nameMap = new Map();
        } else if (cfg.nameMap instanceof Map) {
            this._nameMap = cfg.nameMap;
        } else {
            this._nameMap = new Map(Object.entries(cfg.nameMap));
        }
        this._exclude = cfg.excludeSourceBones ?? new Set();
        this._useRestOffset = cfg.useRestOffset ?? true;
        this._preserveHipPosition = cfg.preserveHipPosition ?? false;
        this._heightScale = cfg.heightScale ?? 1.0;
    }

    /**
     * Build the source→target bone mapping + capture rest-pose world
     * rotations (including each rig's Character root rotation) and the
     * hip-pair bind translations. Called lazily on the first `apply()`;
     * can be re-called explicitly if either avatar changes.
     */
    public buildMapping(): void {
        const srcAvatar = this._source.getAvatar();
        const tgtAvatar = this._target.getAvatar();
        if (!srcAvatar || !tgtAvatar) {
            this._resolved = [];
            return;
        }

        const targetNames = new Set<string>();
        for (const b of tgtAvatar.boneData) targetNames.add(b.boneName);

        const out: ResolvedPair[] = [];
        this._tgtToSrc.clear();
        for (const srcBone of srcAvatar.boneData) {
            if (this._exclude.has(srcBone.boneName)) continue;

            const mapped = this._nameMap.get(srcBone.boneName);
            let tgtName: string | null = null;
            if (mapped && targetNames.has(mapped)) {
                tgtName = mapped;
            } else {
                const stripped = stripPrefix(srcBone.boneName);
                for (const t of targetNames) {
                    if (t === srcBone.boneName ||
                        t.toLowerCase() === srcBone.boneName.toLowerCase() ||
                        stripPrefix(t).toLowerCase() === stripped.toLowerCase()) {
                        tgtName = t;
                        break;
                    }
                }
            }
            if (!tgtName) continue;

            out.push({ srcName: srcBone.boneName, tgtName });
            this._tgtToSrc.set(tgtName, srcBone.boneName);
            targetNames.delete(tgtName);
        }
        this._resolved = out;

        // Capture the Character (rig root) rotation for both rigs.
        // This is the rotation Sample_AnimationRetargeting sets via
        // `sourceRoot.rotationY = 90` etc., NOT the bind rotation
        // baked into the glTF — the bind rotation may have been
        // overwritten by the sample. We use whatever the rig's
        // Character node is currently rotated to as the FK starting
        // frame and as the source/target frame for the hip position
        // channel below. Captured unconditionally so the position
        // channel is available even with `useRestOffset: false`.
        const srcRootBone = srcAvatar.boneData.length > 0
            ? this._source.getJointObject(srcAvatar.boneData[0].boneName) : null;
        const tgtRootBone = tgtAvatar.boneData.length > 0
            ? this._target.getJointObject(out[0]?.tgtName ?? tgtAvatar.boneData[0].boneName) : null;
        if (srcRootBone?.parent) {
            const charLocalQ = (srcRootBone.parent as any).object3D?.localQuaternion as Quaternion | undefined;
            if (charLocalQ) this._rootRotS.copyFrom(charLocalQ);
            else this._rootRotS.set(0, 0, 0, 1);
        } else {
            this._rootRotS.set(0, 0, 0, 1);
        }
        if (tgtRootBone?.parent) {
            const charLocalQ = (tgtRootBone.parent as any).object3D?.localQuaternion as Quaternion | undefined;
            if (charLocalQ) this._rootRotT.copyFrom(charLocalQ);
            else this._rootRotT.set(0, 0, 0, 1);
        } else {
            this._rootRotT.set(0, 0, 0, 1);
        }

        // Identify the hip pair (root joint = the source bone with no
        // parent in skeleton) and capture its bind localPosition for
        // both rigs. Without a parentless source bone we leave the hip
        // names null and skip the position channel entirely.
        this._hipSrcName = null;
        this._hipTgtName = null;
        for (const pair of out) {
            const srcBone = srcAvatar.boneMap.get(pair.srcName);
            if (srcBone && (!srcBone.parentBoneName || srcBone.parentBoneName === '')) {
                const tgtBone = tgtAvatar.boneMap.get(pair.tgtName);
                if (tgtBone) {
                    this._hipSrcName = pair.srcName;
                    this._hipTgtName = pair.tgtName;
                    this._bindHipLocalPosS.copyFrom(srcBone.t);
                    this._bindHipLocalPosT.copyFrom(tgtBone.t);
                }
                break;
            }
        }

        if (!this._useRestOffset) return;

        // Pre-compute bind worldQ via FK over the bind-pose local
        // quats, with Character rotation as the starting frame.
        // boneData is in DFS order so parents come before children.
        computeBindWorldRotations(srcAvatar, this._rootRotS, this._bindWorldS);
        computeBindWorldRotations(tgtAvatar, this._rootRotT, this._bindWorldT);
    }

    public get resolvedMapping(): ReadonlyArray<[string, string]> {
        if (this._resolved === null) this.buildMapping();
        return this._resolved!.map(r => [r.srcName, r.tgtName] as [string, string]);
    }

    /**
     * Per-frame retarget. Call from your render loop AFTER the source
     * Animator's own update has run.
     */
    public apply(): void {
        if (this._resolved === null) this.buildMapping();
        if (!this._resolved || this._resolved.length === 0) return;

        if (!this._useRestOffset) {
            for (const pair of this._resolved) {
                const sBone = this._source.getJointObject(pair.srcName);
                const tBone = this._target.getJointObject(pair.tgtName);
                if (sBone && tBone) tBone.localQuaternion = sBone.localQuaternion;
            }
            this._applyHipPosition();
            return;
        }

        const srcAvatar = this._source.getAvatar();
        const tgtAvatar = this._target.getAvatar();
        if (!srcAvatar || !tgtAvatar) return;

        // Step 1: source FK from rootRotS over current sourceBone.localQuaternions.
        this._currentWorldS.clear();
        for (const bone of srcAvatar.boneData) {
            const obj = this._source.getJointObject(bone.boneName);
            if (!obj) continue;
            const local = obj.localQuaternion;
            const worldQ = new Quaternion();
            if (bone.parentBoneName && this._currentWorldS.has(bone.parentBoneName)) {
                worldQ.multiply(this._currentWorldS.get(bone.parentBoneName)!, local);
            } else {
                worldQ.multiply(this._rootRotS, local);
            }
            this._currentWorldS.set(bone.boneName, worldQ);
        }

        // Step 2: walk target bones in hierarchy order. Compute localQ
        // as inv(parentCurrentWorldT) * (delta_W * bindWorldT) for any
        // bone with a source pair; otherwise propagate target's own
        // current localQ so child bones see their parent's NEW world rot.
        this._currentWorldT.clear();
        for (const bone of tgtAvatar.boneData) {
            const obj = this._target.getJointObject(bone.boneName);
            if (!obj) continue;

            let parentWorldT: Quaternion;
            if (bone.parentBoneName && this._currentWorldT.has(bone.parentBoneName)) {
                parentWorldT = this._currentWorldT.get(bone.parentBoneName)!;
            } else {
                parentWorldT = this._rootRotT;
            }

            const srcName = this._tgtToSrc.get(bone.boneName);
            const srcCurrentW = srcName ? this._currentWorldS.get(srcName) : undefined;
            const srcBindW = srcName ? this._bindWorldS.get(srcName) : undefined;
            const tgtBindW = this._bindWorldT.get(bone.boneName);

            const worldQ = new Quaternion();
            if (srcCurrentW && srcBindW && tgtBindW) {
                // delta = srcCurrentW * inv(srcBindW)
                this._scratchInvBindS.set(-srcBindW.x, -srcBindW.y, -srcBindW.z, srcBindW.w);
                this._scratchA.multiply(srcCurrentW, this._scratchInvBindS);
                // desired worldQ_T = delta * tgtBindW
                worldQ.multiply(this._scratchA, tgtBindW);
                // localQ_T = inv(parentWorldT) * desired_worldQ_T
                this._scratchInvParentT.set(-parentWorldT.x, -parentWorldT.y, -parentWorldT.z, parentWorldT.w);
                this._scratchB.multiply(this._scratchInvParentT, worldQ);
                obj.localQuaternion = this._scratchB;
            } else {
                const local = obj.localQuaternion;
                worldQ.multiply(parentWorldT, local);
            }
            this._currentWorldT.set(bone.boneName, worldQ);
        }

        // Step 3: hip translation (root motion).
        this._applyHipPosition();
    }

    /**
     * Replay the source hip's bind-relative translation delta on the
     * target hip, transformed across the two rigs' Character frames
     * and scaled by `heightScale`. Skipped when `preserveHipPosition`
     * is true or when no hip pair was resolved at buildMapping.
     */
    private _applyHipPosition(): void {
        if (this._preserveHipPosition) return;
        if (!this._hipSrcName || !this._hipTgtName) return;

        const sourceHip = this._source.getJointObject(this._hipSrcName);
        const targetHip = this._target.getJointObject(this._hipTgtName);
        if (!sourceHip || !targetHip) return;

        // delta in source character-local frame.
        const sLocal = sourceHip.localPosition;
        this._scratchHipDelta.set(
            sLocal.x - this._bindHipLocalPosS.x,
            sLocal.y - this._bindHipLocalPosS.y,
            sLocal.z - this._bindHipLocalPosS.z,
        );
        // → world: delta_world = rootRot_S * delta_char_S
        Quaternion.transformVector(this._rootRotS, this._scratchHipDelta, this._scratchHipDelta);
        // → target character-local: delta_char_T = inv(rootRot_T) * delta_world
        this._scratchInvRootRotT.set(-this._rootRotT.x, -this._rootRotT.y, -this._rootRotT.z, this._rootRotT.w);
        Quaternion.transformVector(this._scratchInvRootRotT, this._scratchHipDelta, this._scratchHipDelta);
        // Apply with height scale on top of target's bind hip position.
        this._scratchHipPos.set(
            this._bindHipLocalPosT.x + this._scratchHipDelta.x * this._heightScale,
            this._bindHipLocalPosT.y + this._scratchHipDelta.y * this._heightScale,
            this._bindHipLocalPosT.z + this._scratchHipDelta.z * this._heightScale,
        );
        targetHip.localPosition = this._scratchHipPos;
    }
}

function stripPrefix(name: string): string {
    return name.replace(/^mixamorig:/i, '').replace(/^Armature\|/i, '');
}

function computeBindWorldRotations(avatar: PrefabAvatarData, rootRot: Quaternion, out: Map<string, Quaternion>): void {
    out.clear();
    for (const bone of avatar.boneData) {
        const local = bone.q;
        const world = new Quaternion();
        if (bone.parentBoneName && out.has(bone.parentBoneName)) {
            const parentWorld = out.get(bone.parentBoneName)!;
            world.multiply(parentWorld, local);
        } else {
            world.multiply(rootRot, local);
        }
        out.set(bone.boneName, world);
    }
}
