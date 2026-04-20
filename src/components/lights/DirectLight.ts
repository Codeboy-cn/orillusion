import { Camera3D } from '../../core/Camera3D';
import { UUID } from '../../util/Global';
import { RegisterComponent } from '../../util/SerializeDecoration';
import { LightBase } from './LightBase';
import { LightType } from './LightData';
import { CameraUtil } from '../../util/CameraUtil';
import { Vector3 } from '../../math/Vector3';
import { FrustumCSM } from '../..';
/**
 *
 *Directional light source.
 *The light of this light source is parallel, for example, sunlight. This light source can generate shadows.
 * @group Lights
 */
@RegisterComponent(DirectLight, 'DirectLight')
export class DirectLight extends LightBase {
    public shadowCamera: Camera3D;
    // Debug visualization toggles (wired from GUIUtil). Split so CSM cascade draw
    // and non-CSM orthographic shadow-bound draw can be toggled independently.
    public debugCSM: boolean = false;
    public debugShadowBound: boolean = false;
    public csmShadowCamera: Camera3D[] = [];
    public frustumCSM: FrustumCSM;
    public csmAutoUpdate: boolean = true;
    public csmSplitFunction: (near: number, far: number, index: number, max: number) => number;
    protected _enableCSM: boolean = false;

    constructor() {
        super();
        this.shadowCamera = CameraUtil.createCamera3DObject(null, 'shadowCamera');
        this.shadowCamera.shadowLight = this;
        this.shadowCamera.isShadowCamera = true;
        // Initialize the shadow camera frustum to a usable default cube
        // (covers a [-bound/2, bound/2] world-space box) so the GUI shows
        // meaningful numbers even before any sample tweaks them. Writes go
        // through the underlying camera/field directly to bypass the CSM
        // gate in the public setters — when CSM is on these are inert anyway.
        const bound = LightBase.DEFAULT_SHADOW_BOUND;
        this._shadowBoundWidth = bound;
        this._shadowBoundHeight = bound;
        this.shadowCamera.left = -bound * 0.5;
        this.shadowCamera.right = bound * 0.5;
        this.shadowCamera.bottom = -bound * 0.5;
        this.shadowCamera.top = bound * 0.5;
        this.shadowCamera.near = 0.01;
        this.shadowCamera.far = bound;
    }

    public start(): void {
        super.start();
        this.castGI = true;
    }

    public updateShadowCameraCSM(renderCamera: Camera3D) {
        if (!this.csmAutoUpdate) return;

        this.frustumCSM.update(renderCamera.projectionMatrix, renderCamera.pvMatrixInv, renderCamera.near, renderCamera.far, this.transform.view3D!.engine3D.setting.shadow, this.csmSplitFunction);

        for (let i = 0; i < this.cascadeNum; i++) {
            const lookAt = this.frustumCSM.children[i].bound.center;

            const shadowPos = Vector3.HELP_0;
            shadowPos.copy(this.direction).normalize(renderCamera.far);

            const shadowCameraTarget = Vector3.HELP_1;
            Vector3.add(lookAt, shadowPos, shadowCameraTarget);
            Vector3.sub(lookAt, shadowPos, shadowPos);

            this.csmShadowCamera[i].near = renderCamera.near;
            this.csmShadowCamera[i].far = renderCamera.far * 2;

            this.csmShadowCamera[i].transform.lookAt(shadowPos, shadowCameraTarget);
            const extents = Math.round(this.frustumCSM.children[i].bound.extents.length);
            this.csmShadowCamera[i].orthoOffCenter(-extents, extents, -extents, extents, renderCamera.near, renderCamera.far * 2);
        }
    }

    // RFC-003 Layer C: 'auto' lets ShadowBiasCalculator derive a texelSize-based
    // value from the cascade frustum + shadow map size. Setting a number overrides
    // it (NDC depth units for shadowBias, world units for normalBias).
    private _shadowBias: 'auto' | number = 'auto';
    private _normalBias: 'auto' | number = 'auto';

    public get enableCSM(): boolean{
        return this._enableCSM;
    }

    public set enableCSM(value: boolean) {
        if (this._enableCSM != value) {
            if (value) {
                if (this.cascadeNum == 0){
                    this.cascadeNum = 4;
                }
            } else if (this.lightData.csmShadowMapIndex != -1) {
                this.lightData.csmShadowMapIndex = -1;
            }
            this._enableCSM = value;
            this.onChange();
        }
    }

    public get cascadeNum(): number{
        return this.lightData.csmShadowMapNum;
    }

    public set cascadeNum(value: number){
        value = Math.max(value, 1);
        if (this.lightData.csmShadowMapNum != value) {
            this.csmShadowCamera = [];
            this.frustumCSM = new FrustumCSM(value);
            for (let i = 0; i < value; i++) {
                const csmCamera = CameraUtil.createCamera3DObject(null, `csmShadowCamera_${i}`);
                csmCamera.shadowLight = this;
                csmCamera.isShadowCamera = true;
                this.csmShadowCamera.push(csmCamera);
            }
            this.lightData.csmShadowMapNum = value;
        }
    }

    public get shadowBias(): 'auto' | number {
        return this._shadowBias;
    }

    public set shadowBias(value: 'auto' | number) {
        if (this._shadowBias != value) {
            this._shadowBias = value;
            this.onChange();
        }
    }

    public get normalBias(): 'auto' | number {
        return this._normalBias;
    }

    public set normalBias(value: 'auto' | number) {
        if (this._normalBias != value) {
            this._normalBias = value;
            this.onChange();
        }
    }

    public get shadowBoundWidth(): number {
        return this._shadowBoundWidth;
    }

    public set shadowBoundWidth(value: number) {
        if (this._shadowBoundWidth != value && !this.enableCSM) {
            this._shadowBoundWidth = value;
            const halfValue = value * 0.5;
            this.shadowCamera.left = -halfValue;
            this.shadowCamera.right = halfValue;
            this.onChange();
        }
    }

    public get shadowBoundHeight(): number {
        return this._shadowBoundHeight;
    }

    public set shadowBoundHeight(value: number) {
        if (this._shadowBoundHeight != value && !this.enableCSM) {
            this._shadowBoundHeight = value;
            const halfValue = value * 0.5;
            this.shadowCamera.bottom = -halfValue;
            this.shadowCamera.top = halfValue;
            this.onChange();
        }
    }

    public get shadowBoundNear(): number {
        return this.shadowCamera.near;
    }

    public set shadowBoundNear(value: number) {
        if (this.shadowCamera.near != value && !this.enableCSM) {
            this.shadowCamera.near = value;
            this.onChange();
        }
    }

    public get shadowBoundFar(): number {
        return this.shadowCamera.far;
    }

    public set shadowBoundFar(value: number) {
        if (this.shadowCamera.far != value && !this.enableCSM) {
            this.shadowCamera.far = value;
            this.onChange();
        }
    }

    public init(): void {
        super.init();
        if (this.object3D.name == "") {
            this.object3D.name = "DirectionLight_" + UUID();
        }
        this.radius = Number.MAX_SAFE_INTEGER;
        this.lightData.lightType = LightType.DirectionLight;
        this.lightData.linear = 0;
        this.lightData.quadratic = 0.3;
    }

    /**
     *
     * Get the radius of a directional light source
     */
    public get radius(): number {
        return this.lightData.range as number;
    }

    /**
     * Set the radius of a directional light source
     */
    public set radius(value: number) {
        this.lightData.range = value;
        this.onChange();
    }

    /**
     *
     * Get the radius of a directional light source
     */
    public get indirect(): number {
        return this.lightData.quadratic as number;
    }

    /**
     * Set the radius of a directional light source
     */
    public set indirect(value: number) {
        this.lightData.quadratic = value;
        this.onChange();
    }

    // /**
    //  * Set cast shadow
    //  * @param value
    //  **/
    // public set castShadow(value: boolean) {
    //     if (value != this._castShadow) {
    //         this.onChange();
    //     }
    //     this._castShadow = value;
    // }

    // /**
    //  * get cast shadow
    //  * @return boolean
    //  * */
    // public get castShadow(): boolean {
    //     return this.lightData.castShadowIndex as number >= 0;
    // }

    protected onChange() {
        super.onChange();
        // Bias arrays are recomputed each frame in GlobalUniformGroup.setCamera()
        // via ShadowBiasCalculator; no per-light cache needed here.
    }

    public destroy(force?: boolean): void {
        // super.destroy() flips `enable=false`, which fires onDisable → onChange,
        // and onChange reads shadowBoundFar (i.e. shadowCamera.far). Let the base
        // chain finish before we null out shadowCamera, otherwise that read throws.
        super.destroy(force);
        // Shadow cameras are created via `CameraUtil.createCamera3DObject(null, ...)`
        // with no parent, so they are NOT in the scene tree — scene.destroy() walks
        // entityChildren and would miss them. Destroy explicitly here.
        this.shadowCamera?.object3D?.destroy(force);
        this.shadowCamera = null;
        if (this.csmShadowCamera) {
            for (const cam of this.csmShadowCamera) cam?.object3D?.destroy(force);
            this.csmShadowCamera.length = 0;
        }
    }
}
