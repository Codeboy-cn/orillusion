import { AnimationCurveT, KeyframeT, Matrix4, Orientation3D, PrefabAvatarData, PrefabBoneData, PropertyAnimationClip, Quaternion, ValueEnumType, Vector3 } from "../../..";
import { GLTF_Info } from "./GLTFInfo";
import { GLTFSubParser } from "./GLTFSubParser";

/**
 * Internal glTF sub-parser stage that builds the avatar/bone hierarchy
 * (`PrefabAvatarData`) from a glTF skeleton and converts glTF animation
 * channels into engine `PropertyAnimationClip` skeletal animations.
 *
 * @internal
 */
export class GLTFSubParserSkeleton {
    protected gltf: GLTF_Info;
    protected subParser: GLTFSubParser;

    constructor(subParser: GLTFSubParser) {
        this.gltf = subParser.gltf;
        this.subParser = subParser;
    }

    public parse(skeletonID: number): PrefabAvatarData {
        let avatarData: PrefabAvatarData = new PrefabAvatarData();
        avatarData.name = 'Id:' + skeletonID;
        avatarData.count = 0;
        avatarData.boneData = [];
        avatarData.boneMap = new Map<string, PrefabBoneData>();
        this.buildSkeleton(avatarData, undefined, skeletonID);
        return avatarData;
    }

    public parseSkeletonAnimation(avatarData: PrefabAvatarData, animation): PropertyAnimationClip {
        let result: PropertyAnimationClip = new PropertyAnimationClip();
        result.clipName = animation.name;
        result.useSkeletonPos = false;
        result.useSkeletonScale = false;

        for (let channel of animation.channels) {
            let sampler = animation.samplers[channel.sampler];
            const inputAccessor = this.subParser.parseAccessor(sampler.input);
            const outputAccessor = this.subParser.parseAccessor(sampler.output);
            // CUBICSPLINE output stores (inTangent, value, outTangent)
            // triplets per keyframe — read only the VALUE element of each
            // triplet; tangents are ignored (minimal linear playback).
            const cubic = sampler.interpolation === 'CUBICSPLINE';
            let nodeId = channel.target.node;
            let property = channel.target.path;
            let node = this.gltf.nodes[nodeId];
            if (!node) {
                continue;
            }
            if (!avatarData.boneMap.has(node.name)) {
                continue;
            }
            let bone = avatarData.boneMap.get(node.name);

            switch (property) {
                case 'scale':
                    {
                        let animationCurveT = new AnimationCurveT(outputAccessor.numComponents);
                        animationCurveT.path = "";
                        animationCurveT.attribute = "";
                        animationCurveT.propertys = animationCurveT.attribute.split(".");
                        animationCurveT.preInfinity = 0;
                        animationCurveT.postInfinity = 0;
                        animationCurveT.rotationOrder = 0;
                        result.useSkeletonScale = true;
                        result.scaleCurves.set(bone.bonePath, animationCurveT);

                        for (let i = 0; i < inputAccessor.data.length; i++) {
                            const t = inputAccessor.data[i];
                            const offset = (cubic ? i * 3 + 1 : i) * outputAccessor.numComponents;

                            let keyframe = new KeyframeT(0);
                            keyframe.time = t;

                            const v = new Vector3().set(
                                outputAccessor.data[offset + 0], 
                                outputAccessor.data[offset + 1], 
                                outputAccessor.data[offset + 2]
                            );

                            keyframe.split(ValueEnumType.vector3, v, "value");

                            // keyframe.split(ValueEnumType.single, 0, "inSlope");
                            // keyframe.split(ValueEnumType.single, 0, "outSlope");
                            // keyframe.tangentMode = 0;
                            // keyframe.weightedMode = 0;
                            // keyframe.split(ValueEnumType.single, 1, "inWeight");
                            // keyframe.split(ValueEnumType.single, 1, "outWeight");

                            animationCurveT.addKeyFrame(keyframe);
                        }
                    }
                    break;
                case 'rotation':
                    {
                        let animationCurveT = new AnimationCurveT(outputAccessor.numComponents);
                        animationCurveT.path = "";
                        animationCurveT.attribute = "";
                        animationCurveT.propertys = animationCurveT.attribute.split(".");
                        animationCurveT.preInfinity = 0;
                        animationCurveT.postInfinity = 0;
                        animationCurveT.rotationOrder = 0;
                        result.rotationCurves.set(bone.bonePath, animationCurveT);

                        for (let i = 0; i < inputAccessor.data.length; i++) {
                            const t = inputAccessor.data[i];
                            const offset = (cubic ? i * 3 + 1 : i) * outputAccessor.numComponents;

                            let keyframe = new KeyframeT(0);
                            keyframe.time = t;

                            const v = new Quaternion().set(
                                outputAccessor.data[offset + 0], 
                                outputAccessor.data[offset + 1], 
                                outputAccessor.data[offset + 2],
                                outputAccessor.data[offset + 3],
                            );

                            keyframe.split(ValueEnumType.quaternion, v, "value");

                            // keyframe.split(ValueEnumType.single, 0, "inSlope");
                            // keyframe.split(ValueEnumType.single, 0, "outSlope");
                            // keyframe.tangentMode = 0;
                            // keyframe.weightedMode = 0;
                            // keyframe.split(ValueEnumType.single, 1, "inWeight");
                            // keyframe.split(ValueEnumType.single, 1, "outWeight");

                            animationCurveT.addKeyFrame(keyframe);
                        }
                    }
                    break;
                case 'translation':
                    {
                        let animationCurveT = new AnimationCurveT(outputAccessor.numComponents);
                        animationCurveT.path = "";
                        animationCurveT.attribute = "";
                        animationCurveT.propertys = animationCurveT.attribute.split(".");
                        animationCurveT.preInfinity = 0;
                        animationCurveT.postInfinity = 0;
                        animationCurveT.rotationOrder = 0;
                        result.useSkeletonPos = true;
                        result.positionCurves.set(bone.bonePath, animationCurveT);

                        for (let i = 0; i < inputAccessor.data.length; i++) {
                            const t = inputAccessor.data[i];
                            const offset = (cubic ? i * 3 + 1 : i) * outputAccessor.numComponents;

                            let keyframe = new KeyframeT(0);
                            keyframe.time = t;

                            const v = new Vector3().set(
                                outputAccessor.data[offset + 0], 
                                outputAccessor.data[offset + 1], 
                                outputAccessor.data[offset + 2]
                            );

                            keyframe.split(ValueEnumType.vector3, v, "value");

                            // keyframe.split(ValueEnumType.single, 0, "inSlope");
                            // keyframe.split(ValueEnumType.single, 0, "outSlope");
                            // keyframe.tangentMode = 0;
                            // keyframe.weightedMode = 0;
                            // keyframe.split(ValueEnumType.single, 1, "inWeight");
                            // keyframe.split(ValueEnumType.single, 1, "outWeight");

                            animationCurveT.addKeyFrame(keyframe);
                        }
                    }
                    break;
            }
        }
        return result;
    }

    private buildSkeleton(avatarData: PrefabAvatarData, parent: PrefabBoneData, nodeId: number) {
        let node = this.gltf.nodes[nodeId];
        if (!node.name) {
            node.name = 'Bone' + avatarData.count;
        }

        let boneData = new PrefabBoneData();
        boneData.boneName = node.name;
        boneData.bonePath = parent ? parent.bonePath + '/' + node.name : node.name;
        boneData.parentBoneName = parent ? parent.boneName : "";

        boneData.boneID = avatarData.count++;
        boneData.parentBoneID = parent ? parent.boneID : -1;

        boneData.instanceID = "";
        boneData.parentInstanceID = "";

        boneData.s = new Vector3(1, 1, 1);
        boneData.q = new Quaternion();
        boneData.t = new Vector3();

        if (node.matrix) {
            // glTF nodes may carry a column-major number[16] matrix instead
            // of TRS — decompose it, otherwise matrix-authored bones stay
            // at identity in the avatar bind pose.
            let mat = new Matrix4();
            mat.rawData.set(node.matrix);
            let prs = mat.decompose(Orientation3D.QUATERNION, [new Vector3(), new Vector3(), new Vector3()]);
            boneData.t.set(prs[0].x, prs[0].y, prs[0].z);
            boneData.q.set(prs[1].x, prs[1].y, prs[1].z, prs[1].w);
            boneData.s.set(prs[2].x, prs[2].y, prs[2].z);
        } else {
            if (node.scale) {
                boneData.s.set(node.scale[0], node.scale[1], node.scale[2]);
            }
            if (node.rotation) {
                boneData.q.set(node.rotation[0], node.rotation[1], node.rotation[2], node.rotation[3]);
            }
            if (node.translation) {
                boneData.t.set(node.translation[0], node.translation[1], node.translation[2]);
            }
        }

        avatarData.boneData.push(boneData);
        avatarData.boneMap.set(boneData.boneName, boneData);

        if (node.children) {
            for (let children of node.children) {
                this.buildSkeleton(avatarData, boneData, children);
            }
        }
    }
}
