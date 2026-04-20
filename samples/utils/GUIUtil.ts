import { GUIHelp } from "@orillusion/debug/GUIHelp";
import { UVMoveComponent } from "@samples/material/script/UVMoveComponent";
import { ProfilerDraw, PassType, OutlinePost, GBufferPost, Engine3D, AtmosphericComponent, GlobalFog, Transform, BloomPost, GodRayPost, Object3D, DirectLight, PointLight, SpotLight, GlobalIlluminationComponent, View3D, UIShadow, Color, UIPanel, GPUCullMode, BillboardType, LitMaterial, BlendMode, MorphTargetBlender, SkinnedMeshRenderer2, AnimatorComponent, GTAOPost, TAAPost, DepthOfFieldPost, Vector3, Vector4, Vector2 } from "@orillusion/core";
import { Graphic3D } from "@orillusion/graphic";

export class GUIUtil {

    static renderProfiler(arg0: ProfilerDraw) {
        let gui = GUIHelp._creatPanel();
        let cache = {};
        for (const key in PassType) {
            let i = parseInt(key);
            if (i >= 0) {
            } else {
                let fg = GUIHelp._addFolder(gui, key);
                fg.open();
                cache[key] = [
                    GUIHelp._addLabelValue(fg, `indicesCount`, arg0[key].indicesCount),
                    GUIHelp._addLabelValue(fg, `vertexCount`, arg0[key].vertexCount),
                    GUIHelp._addLabelValue(fg, `triCount`, arg0[key].triCount),
                    GUIHelp._addLabelValue(fg, `instanceCount`, arg0[key].instanceCount),
                    GUIHelp._addLabelValue(fg, `drawCount`, arg0[key].drawCount),
                    GUIHelp._addLabelValue(fg, `pipelineCount`, arg0[key].pipelineCount),
                ]
            }
        }
        gui.open();

        setInterval(() => {
            for (const key in PassType) {
                let i = parseInt(key);
                if (i >= 0) {
                } else {
                    cache[key][0].setValue(arg0[key].indicesCount);
                    cache[key][1].setValue(arg0[key].vertexCount);
                    cache[key][2].setValue(arg0[key].triCount);
                    cache[key][3].setValue(arg0[key].instanceCount);
                    cache[key][4].setValue(arg0[key].drawCount);
                    cache[key][5].setValue(arg0[key].pipelineCount);
                }
            }
        }, 2000);
    }


    static renderOutlinePost(post: OutlinePost) {
        GUIHelp.addFolder('OutlinePost');
        GUIHelp.add(post, 'outlinePixel', 0, 2048, 1);
        GUIHelp.add(post, 'fadeOutlinePixel', 0.0001, 0.2, 0.00001);
        GUIHelp.add(post, 'strength', 0.0001, 0.2, 0.00001);
        GUIHelp.add(post, 'useAddMode');
        open && GUIHelp.open();
        GUIHelp.endFolder();
    }

    public static renderShadowSetting(engine: Engine3D, open: boolean = true) {
        GUIHelp.addFolder('ShadowSetting');
        let setting = engine.setting.shadow;

        GUIHelp.add(setting, 'shadowSize', 256, 4096, 1);
        open && GUIHelp.open();
        GUIHelp.endFolder();
    }


    static renderGBufferPost(post: GBufferPost, open: boolean = true) {
        GUIHelp.addFolder('GBufferPost&Reflection');
        let bufferState = {
            current: 0,
            abldeo: 1,
            viewNormal: 2,
            worldNormal: 3,
            roughness: 4,
            metallic: 5,
            alpha: 6,
            modelID: 7,
        }
        GUIHelp.add(post, 'state', bufferState);
        GUIHelp.add(post, 'size1', 64.0, 1024, 1.0);
        GUIHelp.add(post, 'size2', 64.0, 1024, 1.0);
        open && GUIHelp.open();
        GUIHelp.endFolder();
    }


    //render AtmosphericComponent
    public static renderAtmosphericSky(component: AtmosphericComponent, open: boolean = true, name?: string) {
        name ||= 'AtmosphericSky';
        GUIHelp.addFolder(name);
        GUIHelp.add(component, 'sunX', 0, 1, 0.01);
        GUIHelp.add(component, 'sunY', 0.4, 1.6, 0.01);
        GUIHelp.add(component, 'eyePos', 0, 5000, 1);
        GUIHelp.add(component, 'sunRadius', 0, 1000, 0.01);
        GUIHelp.add(component, 'sunRadiance', 0, 100, 0.01);
        GUIHelp.add(component, 'sunBrightness', 0, 10, 0.01);
        GUIHelp.add(component, 'exposure', 0, 2, 0.01);
        GUIHelp.add(component, 'displaySun', 0, 1, 0.01);
        GUIHelp.add(component, 'enable');

        open && GUIHelp.open();
        GUIHelp.endFolder();
    }

    public static renderGlobalFog(fog: GlobalFog, open: boolean = true, name?: string) {
        name ||= 'GlobalFog';
        GUIHelp.addFolder(name);
        GUIHelp.add(fog, 'fogType', {
            Liner: 0,
            Exp: 1,
            Exp2: 2,
        });
        GUIHelp.add(fog, 'start', -0.0, 1000.0, 0.0001);
        GUIHelp.add(fog, 'end', -0.0, 1000.0, 0.0001);
        GUIHelp.add(fog, 'fogHeightScale', 0.0001, 1.0, 0.0001);
        GUIHelp.add(fog, 'density', 0.0, 1.0, 0.0001);
        GUIHelp.add(fog, 'ins', 0.0, 5.0, 0.0001);
        GUIHelp.add(fog, 'skyFactor', 0.0, 1.0, 0.0001);
        GUIHelp.add(fog, 'skyRoughness', 0.0, 1.0, 0.0001);
        GUIHelp.add(fog, 'overrideSkyFactor', 0.0, 1.0, 0.0001);
        GUIHelp.add(fog, 'falloff', 0.0, 100.0, 0.01);
        GUIHelp.add(fog, 'rayLength', 0.01, 2000.0, 0.01);
        GUIHelp.add(fog, 'scatteringExponent', 1, 40.0, 0.001);
        GUIHelp.add(fog, 'dirHeightLine', 0.0, 20.0, 0.01);
        GUIHelp.addColor(fog, 'fogColor');
        open && GUIHelp.open();
        GUIHelp.endFolder();
    }

    //render transform
    public static renderTransform(transform: Transform, open: boolean = true, name?: string, scale?: number) {
        name ||= 'Transform';
        GUIHelp.addFolder(name);
        GUIHelp.add(transform, 'x', -scale, scale, 0.01);
        GUIHelp.add(transform, 'y', -scale, scale, 0.01);
        GUIHelp.add(transform, 'z', -scale, scale, 0.01);
        GUIHelp.add(transform, 'rotationX', 0.0, 360.0, 0.01);
        GUIHelp.add(transform, 'rotationY', 0.0, 360.0, 0.01);
        GUIHelp.add(transform, 'rotationZ', 0.0, 360.0, 0.01);
        GUIHelp.add(transform, 'scaleX', -2.0, 2.0, 0.01);
        GUIHelp.add(transform, 'scaleY', -2.0, 2.0, 0.01);
        GUIHelp.add(transform, 'scaleZ', -2.0, 2.0, 0.01);

        open && GUIHelp.open();
        GUIHelp.endFolder();
    }

    public static renderBloom(bloom: BloomPost, open: boolean = true, name?: string) {
        name ||= 'Bloom';
        GUIHelp.addFolder(name);
        GUIHelp.add(bloom, 'downSampleBlurSize', 3, 15, 1);
        GUIHelp.add(bloom, 'downSampleBlurSigma', 0.01, 500, 0.001);
        GUIHelp.add(bloom, 'upSampleBlurSize', 3, 15, 1);
        GUIHelp.add(bloom, 'upSampleBlurSigma', 0.01, 500, 0.001);
        GUIHelp.add(bloom, 'luminanceThreshole', 0.001, 10.0, 0.001);
        GUIHelp.add(bloom, 'bloomIntensity', 0.001, 10.0, 0.001);
        GUIHelp.add(bloom, 'hdr', 0.001, 10.0, 0.001);
        open && GUIHelp.open();
        GUIHelp.endFolder();
    }

    static renderGodRay(godRay: GodRayPost, open: boolean = true, name?: string) {
        name ||= 'GodRay';
        GUIHelp.addFolder(name);
        GUIHelp.add(godRay, 'blendColor');
        GUIHelp.add(godRay, 'rayMarchCount', 8, 20, 1);
        GUIHelp.add(godRay, 'scatteringExponent', 1, 40, 1);
        GUIHelp.add(godRay, 'intensity', 0.01, 5, 0.001);
        open && GUIHelp.open();
        GUIHelp.endFolder();
    }

    public static renderVector3(obj: Object3D, open: boolean = true, name?: string) {
        name ||= 'Vector3';
        GUIHelp.addFolder(name);
        GUIHelp.add(obj, 'x', -10.0, 10.0, 0.01);
        GUIHelp.add(obj, 'y', -10.0, 10.0, 0.01);
        GUIHelp.add(obj, 'z', -10.0, 10.0, 0.01);

        GUIHelp.add(obj.transform, 'rotationX', 0.0, 360.0, 0.01);
        GUIHelp.add(obj.transform, 'rotationY', 0.0, 360.0, 0.01);
        GUIHelp.add(obj.transform, 'rotationZ', 0.0, 360.0, 0.01);
        open && GUIHelp.open();
        GUIHelp.endFolder();
    }

    //render direct light gui panel
    public static renderDirLight(light: DirectLight, open: boolean = true, name?: string) {
        name ||= `DirectLight-${light.name || light.object3D.name}`;
        GUIHelp.addFolder(name);
        GUIHelp.add(light, 'enable');
        GUIHelp.add(light.transform, 'x', -500, 500, 0.01);
        GUIHelp.add(light.transform, 'y', -500, 500, 0.01);
        GUIHelp.add(light.transform, 'z', -500, 500, 0.01);
        GUIHelp.add(light.transform, 'rotationX', 0.0, 360.0, 0.01);
        GUIHelp.add(light.transform, 'rotationY', 0.0, 360.0, 0.01);
        GUIHelp.add(light.transform, 'rotationZ', 0.0, 360.0, 0.01);

        // shadowBias / normalBias default to 'auto' (RFC-003) — explicit GUI
        // controls omitted; samples can override directly if needed.
        GUIHelp.add(light, 'shadowBoundWidth', 0, 1000, 0.1);
        GUIHelp.add(light, 'shadowBoundHeight', 0, 1000, 0.1);
        GUIHelp.add(light, 'shadowBoundNear', 0.01, 1000)
        GUIHelp.add(light, 'shadowBoundFar', 1, 1000);

        GUIHelp.addColor(light, 'lightColor');
        GUIHelp.add(light, 'intensity', 0.0, 50.0, 0.01);
        GUIHelp.add(light, 'indirect', 0.0, 1.0, 0.01);
        GUIHelp.add(light, 'castShadow');

        GUIHelp.add(light, 'enableCSM');
        GUIHelp.add(light, 'csmAutoUpdate');
        GUIHelp.add(light, 'debugCSM').onChange(() => this.refreshDirectLightDebug(light));
        GUIHelp.add(light, 'debugShadowBound').onChange(() => this.refreshDirectLightDebug(light));

        GUIUtil._addBiasReadout(light);

        open && GUIHelp.open();
        GUIHelp.endFolder();
    }

    /**
     * Live readout of the per-frame auto-resolved shadowBias / normalBias
     * (RFC-003 ShadowBiasCalculator output). The values live in
     * `light.lightData.shadowBias[i]` / `light.lightData.normalBias[i]` and are
     * rewritten every frame in GlobalUniformGroup.setCamera, so we expose
     * getters and mark the dat.gui control `.listen()` to poll.
     *
     * - DirectLight with CSM: one row per cascade.
     * - DirectLight without CSM, PointLight, SpotLight: single row (cascade 0).
     */
    private static _addBiasReadout(light: DirectLight | PointLight | SpotLight) {
        const maxCascades = light.transform.view3D?.engine3D?.setting.shadow.maxCascades ?? 4;
        const isDirect = light instanceof DirectLight;
        const readout: any = {};
        const rows: { sKey: string; nKey: string; idx: number }[] = [];
        const pushRow = (suffix: string, idx: number) => {
            const sKey = `shadowBias${suffix}`;
            const nKey = `normalBias${suffix}`;
            Object.defineProperty(readout, sKey, {
                enumerable: true,
                get: () => light.lightData.shadowBias[idx] ?? 0,
                set: () => { /* read-only: next frame's listen() poll resets the input */ },
            });
            Object.defineProperty(readout, nKey, {
                enumerable: true,
                get: () => light.lightData.normalBias[idx] ?? 0,
                set: () => { /* read-only */ },
            });
            rows.push({ sKey, nKey, idx });
        };
        if (isDirect) {
            for (let i = 0; i < maxCascades; i++) pushRow(`[${i}]`, i);
        } else {
            pushRow('', 0);
        }
        for (const row of rows) {
            GUIHelp.add(readout, row.sKey).listen();
            GUIHelp.add(readout, row.nKey).listen();
        }
    }

    private static _clearDebugDirectLight(light: DirectLight) {
        if (light.object3D && light.transform.view3D && light.transform.view3D.scene) {
            let g = light.transform.view3D.scene.getChildByName('graphic3D') as Graphic3D;
            if (!g) { g = new Graphic3D(); light.transform.view3D.scene.addChild(g); }
            const debugId = `DirectLight_${light.object3D.instanceID}`;
            g.Clear(debugId);
            g.Clear(`CameraFrustum_${light.shadowCamera.object3D.instanceID}`);
            g.Clear(`CameraFrustum_${light.object3D.transform.scene3D.view.camera.object3D.instanceID}`);
            for (let i = 0; i < light.cascadeNum; i++) {
                g.Clear(`${debugId}_cms${i}`);
                g.Clear(`CameraFrustum_${light.csmShadowCamera[i].object3D.instanceID}`);
                g.Clear(`${debugId}_cms${i}_corners`);
            }
        }
    }

    /**
     * Refresh the light's debug visualization based on the two independent toggles
     * (debugCSM, debugShadowBound). Either flag installs a single bindOnChange
     * closure that redraws on light transform / shadow bound changes.
     */
    public static refreshDirectLightDebug(light: DirectLight) {
        const debugId = `DirectLight_${light.object3D.instanceID}`;
        this._clearDebugDirectLight(light);
        if (!light.debugCSM && !light.debugShadowBound) {
            light.bindOnChange = null;
            return;
        }
        light.bindOnChange = () => {
            // csmAutoUpdate gate only matters in CSM mode (frustum follows render
            // camera). Non-CSM shadow camera follows the light alone.
            if (light.enableCSM && !light.csmAutoUpdate) return;
            if (!(light.object3D && light.transform.view3D && light.transform.view3D.scene)) return;
            let g = light.transform.view3D.scene.getChildByName('graphic3D') as Graphic3D;
            if (!g) { g = new Graphic3D(); light.transform.view3D.scene.addChild(g); }
            this._clearDebugDirectLight(light);
            g.drawAxis(debugId, light.transform.worldPosition, 10);
            if (light.debugCSM && light.enableCSM) {
                g.drawCameraFrustum(light.object3D.transform.scene3D.view.camera, new Color(1, 1, 0));
                for (let i = 0; i < light.cascadeNum; i++) {
                    g.drawBoundingBox(`${debugId}_cms${i}`, light.frustumCSM.children[i].bound);
                    g.drawCameraFrustum(light.csmShadowCamera[i], light.lightColor);

                    const corners = light.frustumCSM.sections[i + 1].corners;
                    g.drawLines(`${debugId}_cms${i}_corners`, [
                        corners[0], corners[2], corners[1], corners[3]
                    ], Color.COLOR_GREEN);
                }
            }
            if (light.debugShadowBound && !light.enableCSM) {
                // Pose the shadow camera from the light's current transform so the
                // rectangle tracks xyz / rotation changes immediately. poseShadowCamera
                // in the render pass only runs at frame time, which would lag behind
                // a GUI slider drag.
                const eye = light.transform.worldPosition;
                const target = new Vector3().copyFrom(light.direction).add(eye);
                light.shadowCamera.transform.lookAt(eye, target);
                g.drawCameraFrustum(light.shadowCamera, light.lightColor);
            }
        };
        light.bindOnChange();
    }

    //show point light gui controller
    public static showPointLightGUI(light: PointLight) {
        GUIHelp.addFolder('PointLight');
        GUIHelp.add(light, 'enable');
        GUIHelp.addColor(light, 'lightColor');
        GUIHelp.add(light.transform, 'x', -1000, 1000.0, 0.01);
        GUIHelp.add(light.transform, 'y', -1000, 1000.0, 0.01);
        GUIHelp.add(light.transform, 'z', -1000, 1000.0, 0.01);

        GUIHelp.add(light, 'r', 0.0, 1.0, 0.001);
        GUIHelp.add(light, 'g', 0.0, 1.0, 0.001);
        GUIHelp.add(light, 'b', 0.0, 1.0, 0.001);
        GUIHelp.add(light, 'intensity', 0.0, 100.0, 0.001);
        GUIHelp.add(light, 'at', 0.0, 100.0, 0.001);
        GUIHelp.add(light, 'radius', 0.0, 1.0, 0.001);
        GUIHelp.add(light, 'range', 0.0, 1000.0, 0.001);
        GUIHelp.add(light, 'quadratic', 0.0, 2.0, 0.001);
        GUIHelp.add(light, 'castShadow');

        GUIUtil._addBiasReadout(light);

        GUIHelp.open();
        GUIHelp.endFolder();
    }

    public static showSpotLightGUI(light: SpotLight) {
        GUIHelp.addFolder('SpotLight');
        GUIHelp.add(light, 'enable');
        GUIHelp.add(light.transform, 'x', -1000, 1000.0, 0.01);
        GUIHelp.add(light.transform, 'y', -1000, 1000.0, 0.01);
        GUIHelp.add(light.transform, 'z', -1000, 1000.0, 0.01);

        GUIHelp.add(light.transform, 'rotationX', -360, 360.0, 0.01);
        GUIHelp.add(light.transform, 'rotationY', -360, 360.0, 0.01);
        GUIHelp.add(light.transform, 'rotationZ', -360, 360.0, 0.01);

        GUIHelp.addColor(light, 'lightColor');
        GUIHelp.add(light, 'intensity', 0.0, 100.0, 0.001);
        GUIHelp.add(light, 'at', 0.0, 100.0, 0.001);
        GUIHelp.add(light, 'radius', 0.0, 10.0, 0.001);
        GUIHelp.add(light, 'range', 0.0, 1000.0, 0.001);
        GUIHelp.add(light, 'outerAngle', 0.0, 180.0, 0.001);
        GUIHelp.add(light, 'innerAngle', 0.0, 100.0, 0.001);
        GUIHelp.add(light, 'castShadow');

        GUIUtil._addBiasReadout(light);

        GUIHelp.open();
        GUIHelp.endFolder();
    }

    public static renderGIComponent(component: GlobalIlluminationComponent, view: View3D): void {
        let volume = component['_volume'];
        let giSetting = volume.setting;
        let renderJob = view.engine3D.getRenderJob(view);
        let engine = view.engine3D;

        function onProbesChange(): void {
            component['changeProbesPosition']();
        }

        function debugProbeRay(probeIndex: number, array: Float32Array): void {
            component['debugProbeRay'](probeIndex, array);
        }

        GUIHelp.addFolder('GI');
        GUIHelp.add(giSetting, `lerpHysteresis`, 0.001, 10, 0.0001).onChange(() => {
            onProbesChange();
        });
        GUIHelp.add(giSetting, `depthSharpness`, 1.0, 100.0, 0.001).onChange(() => {
            onProbesChange();
        });
        GUIHelp.add(giSetting, `normalBias`, -100.0, 100.0, 0.001).onChange(() => {
            onProbesChange();
        });
        GUIHelp.add(giSetting, `irradianceChebyshevBias`, -100.0, 100.0, 0.001).onChange(() => {
            onProbesChange();
        });
        GUIHelp.add(giSetting, `rayNumber`, 0, 512, 1).onChange(() => {
            onProbesChange();
        });
        GUIHelp.add(giSetting, `irradianceDistanceBias`, 0.0, 200.0, 0.001).onChange(() => {
            onProbesChange();
        });
        GUIHelp.add(giSetting, `indirectIntensity`, 0.0, 100.0, 0.001).onChange(() => {
            onProbesChange();
        });
        GUIHelp.add(giSetting, `bounceIntensity`, 0.0, 1.0, 0.001).onChange(() => {
            onProbesChange();
        });
        GUIHelp.add(giSetting, `probeRoughness`, 0.0, 1.0, 0.001).onChange(() => {
            onProbesChange();
        });
        GUIHelp.add(giSetting, `ddgiGamma`, 0.0, 4.0, 0.001).onChange(() => {
            onProbesChange();
        });

        GUIHelp.add(giSetting, 'autoRenderProbe');
        GUIHelp.endFolder();

        GUIHelp.addFolder('probe volume');
        GUIHelp.add(volume.setting, 'probeSpace', 0.1, volume.setting.probeSpace * 5, 0.001).onChange(() => {
            onProbesChange();
        });
        GUIHelp.add(volume.setting, 'offsetX', -100, 100, 0.001).onChange(() => {
            onProbesChange();
        });
        GUIHelp.add(volume.setting, 'offsetY', -100, 100, 0.001).onChange(() => {
            onProbesChange();
        });
        GUIHelp.add(volume.setting, 'offsetZ', -100, 100, 0.001).onChange(() => {
            onProbesChange();
        });
        GUIHelp.addButton('show', () => {
            component.object3D.transform.enable = true;
        });
        GUIHelp.addButton('hide', () => {
            component.object3D.transform.enable = false;
        });

        let ddgiProbeRenderer = renderJob.ddgiProbeRenderer;
        GUIHelp.addButton('showRays', () => {
            let array = ddgiProbeRenderer.irradianceComputePass['depthRaysBuffer'].readBuffer();
            let count = engine.setting.gi.probeXCount * engine.setting.gi.probeYCount * engine.setting.gi.probeZCount
            for (let j = 0; j < count; j++) {
                let probeIndex = j;
                debugProbeRay(probeIndex, array);
            }
            debugProbeRay(0, array);
        });

        GUIHelp.addButton('hideRays', () => {
            let count = engine.setting.gi.probeXCount * engine.setting.gi.probeYCount * engine.setting.gi.probeZCount
            for (let j = 0; j < count; j++) {
                let probeIndex = j;
                const rayNumber = engine.setting.gi.rayNumber;
                for (let i = 0; i < rayNumber; i++) {
                    let id = `showRays${probeIndex}${i}`;
                    (view as any).graphic3D?.Clear(id);
                }
            }
        });
        GUIHelp.endFolder();
    }

    //render uv move component
    public static renderUVMove(component: UVMoveComponent, open: boolean = true, name?: string) {
        name ||= 'UV Move';
        GUIHelp.addFolder(name);
        GUIHelp.add(component.speed, 'x', -1, 1, 0.01);
        GUIHelp.add(component.speed, 'y', -1, 1, 0.01);
        GUIHelp.add(component.speed, 'z', 0.1, 10, 0.01);
        GUIHelp.add(component.speed, 'w', 0.1, 10, 0.01);
        GUIHelp.add(component, 'enable');

        open && GUIHelp.open();
        GUIHelp.endFolder();
    }

    public static renderUIShadow(image: UIShadow, open: boolean = true, name?: string) {
        name ||= 'Image Shadow';
        GUIHelp.addFolder(name);
        GUIHelp.add(image, 'shadowQuality', 0, 4, 1);

        GUIHelp.add(image, 'shadowRadius', 0.00, 10, 0.01);
        //shadow color
        image.shadowColor = new Color(0.1, 0.1, 0.1, 0.6);
        GUIHelp.addColor(image, 'shadowColor');

        let changeOffset = () => {
            image.shadowOffset = image.shadowOffset;
        }
        GUIHelp.add(image.shadowOffset, 'x', -100, 100, 0.01).onChange(v => changeOffset());
        GUIHelp.add(image.shadowOffset, 'y', -100, 100, 0.01).onChange(v => changeOffset());
        GUIHelp.addButton('Destroy', () => { image.object3D.removeComponent(UIShadow); })
        open && GUIHelp.open();
        GUIHelp.endFolder();
    }

    public static renderUIPanel(panel: UIPanel, open: boolean = true, name?: string) {
        name ||= 'GUI Panel';
        GUIHelp.addFolder(name);
        //cull mode
        let cullMode = {};
        cullMode[GPUCullMode.none] = GPUCullMode.none;
        cullMode[GPUCullMode.front] = GPUCullMode.front;
        cullMode[GPUCullMode.back] = GPUCullMode.back;

        // change cull mode by click dropdown box
        GUIHelp.add({ cullMode: GPUCullMode.none }, 'cullMode', cullMode).onChange((v) => {
            panel.cullMode = v;
        });

        //billboard
        let billboard = {};
        billboard['None'] = BillboardType.None;
        billboard['Y'] = BillboardType.BillboardY;
        billboard['XYZ'] = BillboardType.BillboardXYZ;

        // change billboard by click dropdown box
        GUIHelp.add({ billboard: panel.billboard }, 'billboard', billboard).onChange((v) => {
            panel.billboard = v;
        });

        let scissorData = {
            scissorCornerRadius: panel.scissorCornerRadius,
            scissorFadeOutSize: panel.scissorFadeOutSize,
            panelWidth: 400,
            panelHeight: 300,
            backGroundVisible: panel.visible,
            backGroundColor: panel.color,
            scissorEnable: panel.scissorEnable

        };
        let changeSissor = () => {
            panel.scissorCornerRadius = scissorData.scissorCornerRadius;
            panel.scissorEnable = scissorData.scissorEnable;
            panel.scissorFadeOutSize = scissorData.scissorFadeOutSize;
            panel.color = scissorData.backGroundColor;
            panel.visible = scissorData.backGroundVisible;
            panel.uiTransform.resize(scissorData.panelWidth, scissorData.panelHeight);
        }
        GUIHelp.add(scissorData, 'scissorCornerRadius', 0, 100, 0.1).onChange(() => {
            changeSissor();
        });
        GUIHelp.add(scissorData, 'scissorFadeOutSize', 0, 100, 0.1).onChange(() => {
            changeSissor();
        });
        GUIHelp.add(scissorData, 'panelWidth', 1, 400, 1).onChange(() => {
            changeSissor();
        });
        GUIHelp.add(scissorData, 'panelHeight', 1, 300, 1).onChange(() => {
            changeSissor();
        });
        GUIHelp.add(scissorData, 'backGroundVisible').onChange(() => {
            changeSissor();
        });

        GUIHelp.addColor(scissorData, 'backGroundColor').onChange(() => {
            changeSissor();
        });

        GUIHelp.add(scissorData, 'scissorEnable').onChange(() => {
            changeSissor();
        });

        //depth test
        if (panel['isWorldPanel']) {
            GUIHelp.add(panel, 'depthTest');
        }

        open && GUIHelp.open();
        GUIHelp.endFolder();
    }


    static renderDebug(view: View3D) {
        GUIHelp.removeFolder(`RenderPerformance`);
        //debug
        let f = GUIHelp.addFolder('RenderPerformance');
        f.open();
        let renderJob = view.engine3D.getRenderJob(view);
        let engine = view.engine3D;
        if (renderJob.postRenderer) {
            let debugTextures = renderJob.postRenderer.debugTextures;
            let debugTextureObj = { normalRender: -1 };
            for (let i = 0; i < debugTextures.length; i++) {
                const tex = debugTextures[i];
                debugTextureObj[tex.name] = i;
            }
            GUIHelp.add(engine.setting.render, 'debugQuad', debugTextureObj);
        }
        let debugChanel = {
            PositionView: 0,
            ColorView: 1,
            normalView: 2,
            IrradianceView: 3,
            tangentView: 4,
            FinalView: 5,
            EmissiveView: 6,
            specularRadiance: 7,
            AO: 8,
            Roughness: 9,
            Metallic: 10,
            diffuse: 11,
            ambient: 12,
            meshID: 13,
            debugCluster: 14,
            debugClusterBox: 15,
            debugClusterLightCount: 16,
        }
        GUIHelp.add(engine.setting.render, 'renderState_left', debugChanel);
        GUIHelp.add(engine.setting.render, 'renderState_right', debugChanel);
        GUIHelp.add(engine.setting.render, 'renderState_split', 0.0, 2048, 0.001);
        GUIHelp.add(engine.setting.render, 'drawOpMin', 0.0, 10000, 1);
        GUIHelp.add(engine.setting.render, 'drawOpMax', 0.0, 10000, 1);
        GUIHelp.endFolder();
    }

    static renderLitMaterial(mat: LitMaterial, open?: boolean) {
        GUIHelp.addFolder(mat.name);
        GUIHelp.addColor(mat, 'baseColor').onChange((v) => {
            let color = mat.baseColor;
            color.copyFromArray(v);
            mat.baseColor = color;
        });

        GUIHelp.add(mat.baseColor, 'a').onChange((v) => {
            let color = mat.baseColor;
            color.a = v;
            mat.baseColor = color;
        });

        let blendMode = {
            NONE: BlendMode.NONE,
            NORMAL: BlendMode.NORMAL,
            ADD: BlendMode.ADD,
            ALPHA: BlendMode.ALPHA,
        }
        // change blend mode by click dropdown box
        GUIHelp.add({ blendMode: mat.blendMode }, 'blendMode', blendMode).onChange((v) => {
            mat.blendMode = BlendMode[BlendMode[parseInt(v)]];
        });

        GUIHelp.add(mat, 'alphaCutoff', 0.0, 1.0, 0.0001).onChange((v) => {
            mat.alphaCutoff = v;
        });

        GUIHelp.add(mat, 'doubleSide').onChange((v) => {
            mat.doubleSide = v;
        });

        GUIHelp.add(mat, 'roughness', 0.0, 1.0, 0.0001).onChange((v) => {
            mat.roughness = v;
        });

        GUIHelp.add(mat, 'metallic', 0.0, 1.0, 0.0001).onChange((v) => {
            mat.metallic = v;
        });

        GUIHelp.addColor(mat, 'clearcoatColor').onChange((v) => {
            let color = mat.clearcoatColor;
            color.copyFromArray(v);
            mat.clearcoatColor = color;
        });

        GUIHelp.add(mat, 'clearcoatFactor', 0.0, 1.0, 0.0001).onChange((v) => {
            mat.clearcoatFactor = v;
        });

        GUIHelp.add(mat, 'clearcoatRoughnessFactor', 0.0, 1.0, 0.0001).onChange((v) => {
            mat.clearcoatRoughnessFactor = v;
        });

        GUIHelp.add(mat, 'ior', 1.0, 4.0, 0.0001).onChange((v) => {
            mat.ior = v;
        });

        GUIHelp.add(mat, 'castShadow');
        GUIHelp.add(mat, 'acceptShadow');
        open && GUIHelp.open();

        GUIHelp.endFolder();
    }

    public static blendShape(obj: Object3D) {
        GUIHelp.addFolder('morph controller');
        // register MorphTargetBlender component
        let blendShapeComponent = obj.addComponent(MorphTargetBlender);
        let targetRenderers = blendShapeComponent.cloneMorphRenderers();

        let influenceData = {};
        // bind influenceData to gui
        for (let key in targetRenderers) {
            influenceData[key] = 0.0;
            GUIHelp.add(influenceData, key, 0, 1, 0.01).onChange((v) => {
                influenceData[key] = v;
                let list = blendShapeComponent.getMorphRenderersByKey(key);
                for (let renderer of list) {
                    renderer.setMorphInfluence(key, v);
                }
            });
        }

        GUIHelp.open();
        GUIHelp.endFolder();
    }

    public static renderBlendShape(obj: Object3D) {
        GUIHelp.addFolder('morph controller');
        // register MorphTargetBlender component
        let blendShapeComponents = obj.getComponents(SkinnedMeshRenderer2);
        let targetRenderers = null;
        for (let ii = 0; ii < blendShapeComponents.length; ii++) {
            if (blendShapeComponents[ii].geometry.blendShapeData) {
                targetRenderers = blendShapeComponents[ii].geometry.blendShapeData.shapeNames;
            }
        }

        if (targetRenderers) {
            let influenceData = {};
            // bind influenceData to gui
            for (let i in targetRenderers) {
                let key = targetRenderers[i];
                influenceData[key] = 0.0;
                GUIHelp.add(influenceData, key, 0, 1, 0.01).onChange((v) => {
                    influenceData[key] = v;
                    for (let index = 0; index < blendShapeComponents.length; index++) {
                        for (let renderer of blendShapeComponents) {
                            renderer.setMorphInfluence(key, v);
                        }
                    }
                });
            }
        }

        GUIHelp.open();
        GUIHelp.endFolder();
    }

    static renderAnimator(com: AnimatorComponent) {
        let anim = {}
        for (let i = 0; i < com.clips.length; i++) {
            const clip = com.clips[i];
            anim[clip.clipName] = clip.clipName;
        }

        GUIHelp.addFolder('morph controller');

        GUIHelp.add({ anim: anim }, 'anim', anim).onChange((v) => {
            com.playAnim(v);
            com.playBlendShape(v);
        });
        GUIHelp.endFolder();

    }


    public static renderGTAO(post: GTAOPost) {
        GUIHelp.addFolder("GTAO");
        GUIHelp.add(post, "maxDistance", 0.0, 149, 1);
        GUIHelp.add(post, "maxPixel", 0.0, 150, 1);
        GUIHelp.add(post, "rayMarchSegment", 0.0, 50, 0.001);
        GUIHelp.add(post, "darkFactor", 0.0, 5, 0.001);
        GUIHelp.add(post, "blendColor");
        GUIHelp.add(post, "multiBounce");
        GUIHelp.endFolder();
    }

    public static renderTAA(post: TAAPost, open: boolean = true) {
        GUIHelp.addFolder("TAA");
        GUIHelp.add(post, "jitterSeedCount", 2, 8, 1);
        GUIHelp.add(post, "blendFactor", 0.0, 1.0, 0.01);
        GUIHelp.add(post, "sharpFactor", 0.1, 0.9, 0.01);
        GUIHelp.add(post, "sharpPreBlurFactor", 0.1, 0.9, 0.01);
        GUIHelp.add(post, "temporalJitterScale", 0.0, 1.0, 0.01);
        open && GUIHelp.open();
        GUIHelp.endFolder();
    }

    static renderDepthOfField(post: DepthOfFieldPost) {
        GUIHelp.addFolder("DOFPost");
        GUIHelp.add(post, 'near', 0, 100, 1)
        GUIHelp.add(post, 'far', 150, 300, 1)
        GUIHelp.add(post, 'pixelOffset', 0.0, 15, 1)
        GUIHelp.endFolder();
    }

    static RenderColor(target: Object, name: string) {
        GUIHelp.addColor(target, name).onChange(v => {
            let [r, g, b, a] = v;
            target[name] = new Color(r / 255, g / 255, b / 255, a / 255)
        })
    }

    static RenderVector4(label: string, target: Object, key: string, min: number, max: number, step: number = 0.01) {
        let components = ['x', 'y', 'z', 'w'];
        let data = {};
        let vec4: Vector4 = target[key];
        for (let component of components) {
            data[label + component] = vec4[component];
            GUIHelp.add(data, label + component, min, max, step).onChange(v => {
                vec4[component] = v;
                target[key] = vec4;
            });

        }
    }

    static RenderVector2(label: string, target: Object, key: string, min: number, max: number, step: number = 0.01) {
        let keys = ['x', 'y'];
        let data = {};
        let vec2: Vector2 = target[key];
        for (let component of keys) {
            data[label + component] = vec2[component];
            GUIHelp.add(data, label + component, min, max, step).onChange(v => {
                vec2[component] = v;
                target[key] = vec2;
            });

        }
    }
}