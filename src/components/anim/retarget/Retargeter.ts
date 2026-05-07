/**
 * Animation retargeting utility — copies per-bone rotations from a
 * source AnimatorComponent to a target AnimatorComponent each frame.
 *
 * The retargeter computes a **world-space delta** with FK over each
 * rig's full ancestor chain (Character node included) and applies it
 * to the target so that the target bone ends up at the same world
 * orientation as the source. For every retargeted bone:
 *
 *   delta_world = currentWorld_S * inv(bindWorld_S)
 *   desired_world_T = delta_world * bindWorld_T
 *   target.localQ = inv(parentCurrentWorld_T) * desired_world_T
 *
 * Why include the Character (skeleton root) rotation in the FK chain.
 * Different Mixamo characters (Michelle vs Soldier) have *different*
 * per-bone bind orientations: each rig's Character node carries an
 * axis-convention rotation that the bone's local bind compensates
 * against. With those Character rotations included, the world bind
 * orientations of corresponding bones do line up between the two rigs
 * — and a world-space delta then transfers anatomical motion cleanly.
 *
 * If we treat each rig as if its Character was identity ("rig-local"
 * world), the bind orientations diverge and the delta produces a
 * front/back-flipped pose on the target. If we instead apply a naive
 * bone-local-frame delta (`bindLocal_T * inv(bindLocal_S) * source`),
 * any joint where the two rigs' bone-local axes don't align — the
 * hipsbone in particular — gets a rotation around the wrong anatomical
 * axis and the target collapses sideways.
 *
 * Bone resolution between the two rigs:
 *   1. explicit `nameMap` in the config (highest priority)
 *   2. exact (case-insensitive) name match, with `mixamorig:` / `Armature|`
 *      prefixes stripped
 *
 * @group Animation
 */
import { Quaternion } from "../../../math/Quaternion";
import type { AnimatorComponent } from "../AnimatorComponent";
import type { PrefabAvatarData } from "../../../loader/parser/prefab/prefabData/PrefabAvatarData";

export interface RetargeterConfig {
    source: AnimatorComponent;
    target: AnimatorComponent;
    /** Optional explicit source-bone-name → target-bone-name mapping. */
    nameMap?: Map<string, string> | { [src: string]: string };
    /** Also copy root position. Default false. */
    copyRootPosition?: boolean;
    /** Bone names on the source that should be ignored. */
    excludeSourceBones?: Set<string>;
    /**
     * When true (default) the retargeter computes a world-space delta from
     * each rig's bind pose so the target tracks the source's motion even
     * when the two rigs have different bind orientations. Set to false
     * for same-rig retargeting where you really want a strict identity
     * copy of local rotations.
     */
    useRestOffset?: boolean;
}

interface ResolvedPair {
    srcName: string;
    tgtName: string;
}

export class Retargeter {
    private _source: AnimatorComponent;
    private _target: AnimatorComponent;
    private _nameMap: Map<string, string>;
    private _copyRootPosition: boolean;
    private _exclude: Set<string>;
    private _useRestOffset: boolean;

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
    /** scratch reusable quaternions to avoid per-frame GC pressure. */
    private _scratchA = new Quaternion();
    private _scratchB = new Quaternion();
    private _scratchInvBindS = new Quaternion();
    private _scratchInvParentT = new Quaternion();
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
        this._copyRootPosition = cfg.copyRootPosition ?? false;
        this._exclude = cfg.excludeSourceBones ?? new Set();
        this._useRestOffset = cfg.useRestOffset ?? true;
    }

    /**
     * Build the source→target bone mapping + capture rest-pose world
     * rotations (including each rig's Character root rotation). Called
     * lazily on the first `apply()`; can be re-called explicitly if
     * either avatar changes.
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

        if (this._useRestOffset) {
            // Capture the Character (rig root) rotation for both rigs.
            // This is the rotation Sample_AnimationRetargeting set via
            // `sourceRoot.rotationY = 90` etc., NOT the bind rotation
            // baked into the glTF — that bind rotation got overwritten
            // by the sample. We use whatever the rig's Character node
            // is currently rotated to as the FK starting point.
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

            // Pre-compute bind worldQ via FK over the bind-pose local
            // quats, with Character rotation as the starting frame.
            // boneData is in DFS order so parents come before children.
            computeBindWorldRotations(srcAvatar, this._rootRotS, this._bindWorldS);
            computeBindWorldRotations(tgtAvatar, this._rootRotT, this._bindWorldT);
        }
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
            this._copyRootPositionIfRequested();
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

        this._copyRootPositionIfRequested();
    }

    private _copyRootPositionIfRequested(): void {
        if (!this._copyRootPosition || !this._resolved || this._resolved.length === 0) return;
        const srcAvatar = this._source.getAvatar();
        if (srcAvatar && srcAvatar.boneData.length > 0) {
            const srcRoot = this._source.getJointObject(srcAvatar.boneData[0].boneName);
            const tgtRoot = this._target.getJointObject(this._resolved[0].tgtName);
            if (srcRoot && tgtRoot) {
                tgtRoot.localPosition = srcRoot.localPosition;
            }
        }
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
