/**
 * Animation retargeting utility — copies per-bone local rotations from a
 * source AnimatorComponent to a target AnimatorComponent each frame.
 *
 * Two execution modes:
 *
 *   - **Direct copy** (`useRestOffset = false`): writes
 *     `target.localQ = source.localQ`. Works only when both rigs share
 *     the same rest pose. Cheap, simple, fine for "two clones of the
 *     same rig" demos.
 *
 *   - **Rest-offset retargeting** (`useRestOffset = true`, the default):
 *     captures each rig's bind-pose local quaternion at construction time
 *     and writes
 *
 *         target.localQ = restTarget * inv(restSource) * source.localQ
 *
 *     This compensates for differences in joint orientation between rigs
 *     so that, e.g., a Mixamo `Soldier` driven by a Mixamo `Michelle`
 *     rendered side by side does not flip head-down. Same idea as
 *     three.js's `SkeletonUtils.retargetClip` `localOffsets` map, just
 *     captured automatically from the rest pose.
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
     * When true (default) the retargeter captures each rig's bind-pose
     * rotations and applies a rest-pose offset to compensate for rest-pose
     * differences. Set to false for same-rig retargeting where the math is
     * a strict identity.
     */
    useRestOffset?: boolean;
}

interface ResolvedPair {
    srcName: string;
    tgtName: string;
    /**
     * Pre-computed `restTarget * inv(restSource)`. Multiplying this by the
     * source's current localQuaternion produces a quaternion in the target's
     * local space that, when applied, makes the target track the source's
     * pose without inheriting its rest pose.
     */
    restOffset: Quaternion | null;
}

export class Retargeter {
    private _source: AnimatorComponent;
    private _target: AnimatorComponent;
    private _nameMap: Map<string, string>;
    private _copyRootPosition: boolean;
    private _exclude: Set<string>;
    private _useRestOffset: boolean;

    private _resolved: ResolvedPair[] | null = null;
    private _scratchQ = new Quaternion();

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
     * Build the source→target bone mapping + capture rest-pose offsets.
     * Called lazily on the first `apply()`; can be re-called explicitly
     * if either avatar changes.
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
        for (const srcBone of srcAvatar.boneData) {
            if (this._exclude.has(srcBone.boneName)) continue;

            // 1) explicit map
            const mapped = this._nameMap.get(srcBone.boneName);
            let tgtName: string | null = null;
            if (mapped && targetNames.has(mapped)) {
                tgtName = mapped;
            } else {
                // 2) exact / case-insensitive / strip mixamorig
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

            // Capture rest-pose offset = target.rest * inv(source.rest).
            let restOffset: Quaternion | null = null;
            if (this._useRestOffset) {
                const srcBoneData = srcAvatar.boneMap.get(srcBone.boneName);
                const tgtBoneData = tgtAvatar.boneMap.get(tgtName);
                if (srcBoneData && tgtBoneData) {
                    const sQ = srcBoneData.q;
                    const tQ = tgtBoneData.q;
                    // restOffset = tQ * inv(sQ)
                    const sInv = new Quaternion(-sQ.x, -sQ.y, -sQ.z, sQ.w);
                    restOffset = new Quaternion();
                    restOffset.multiply(tQ, sInv);
                }
            }

            out.push({ srcName: srcBone.boneName, tgtName, restOffset });
            targetNames.delete(tgtName); // 1:1
        }
        this._resolved = out;
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

        for (const pair of this._resolved) {
            const sBone = this._source.getJointObject(pair.srcName);
            const tBone = this._target.getJointObject(pair.tgtName);
            if (!sBone || !tBone) continue;

            const sLocal = sBone.localQuaternion;
            if (pair.restOffset) {
                // target.localQ = restOffset * source.localQ * inv(restOffset_source_aligned)
                // Simplified for the rest-offset formulation we captured:
                //   pair.restOffset = restTarget * inv(restSource)
                // We want the target to mirror the source's *delta from
                // its own rest*, so:
                //   delta_src   = inv(restSrc) * source.localQ
                //   target.local = restTgt * delta_src
                //                = (restTgt * inv(restSrc)) * source.localQ
                //                = restOffset * source.localQ
                this._scratchQ.multiply(pair.restOffset, sLocal);
                tBone.localQuaternion = this._scratchQ;
            } else {
                tBone.localQuaternion = sLocal;
            }
        }

        if (this._copyRootPosition && this._resolved.length > 0) {
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
}

function stripPrefix(name: string): string {
    return name.replace(/^mixamorig:/i, '').replace(/^Armature\|/i, '');
}
