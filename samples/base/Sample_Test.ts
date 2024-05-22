import { Engine3D, Scene3D, CameraUtil, View3D, AtmosphericComponent, ComponentBase, Time, AxisObject, Object3DUtil, KelvinUtil, DirectLight, Object3D, HoverCameraController, MeshRenderer, LitMaterial, BoxGeometry, UnLit, UnLitMaterial, Interpolator, VertexAttributeName, GeometryBase, Color, Vector3, GPUPrimitiveTopology, FlyCameraController, GPUCullMode, BoundingBox, RenderNode, Matrix4, PlaneGeometry, SphereGeometry, Camera3D, RendererBase, OcclusionSystem, ClusterLightingBuffer, PassType, VirtualTexture, webGPUContext, GPUTextureFormat, PostBase, ComputeShader, RendererPassState, WebGPUDescriptorCreator, ComputeGPUBuffer, GBufferFrame, RTFrame, GPUContext, RTDescriptor, EntityCollect, PostProcessingComponent, GlobalBindGroup, UniformGPUBuffer, Material, BoundUtil, CubeCamera } from "@orillusion/core";
import { GUIHelp } from "@orillusion/debug/GUIHelp";
import { SupportGenerator } from "./SupportGenerator/SupportGenerator";
import { Octree } from "./SupportGenerator/Octree";
import { Face, Geometry, Mesh } from "./SupportGenerator/Geometry";
import { DepthMaterial } from "./SupportGenerator/DepthMaterial";
import { Support_Cs } from "./SupportGenerator/Support_Cs";
import { MinHeap } from "./SupportGenerator/MinHeap";

class SupportCalculator extends PostBase {
    public state: string = 'init';
    public lineCount: number = 0;
    public supportCompute: ComputeShader;
    public paramsSetting: UniformGPUBuffer;
    public supportInputBuffer: ComputeGPUBuffer;
    public supportOutputBuffer: ComputeGPUBuffer;
    public rendererPassState: RendererPassState;
    public callback: Function;

    public maxAngle: number = 45;

    private createResource() {
        if (!this.paramsSetting) {
            this.paramsSetting = new UniformGPUBuffer(4 * 2);
        }
        this.paramsSetting.setFloat('maxAngle', this.maxAngle);
        this.paramsSetting.setVector3('reserve', Vector3.ZERO);
        this.paramsSetting.apply();
    }

    private createCompute() {
        this.supportCompute && this.supportCompute.destroy();
        this.supportCompute = new ComputeShader(Support_Cs);

        this.supportCompute.setUniformBuffer('params', this.paramsSetting);

        let rtFrame = GBufferFrame.getGBufferFrame("ColorPassGBuffer");
        this.supportCompute.setSamplerTexture('visibleMap', rtFrame.getPositionMap());
        this.supportCompute.setSamplerTexture('normalTexture', rtFrame.getNormalMap());
        this.supportCompute.setStorageBuffer('inputData', this.supportInputBuffer);
        // this.supportCompute.setStorageBuffer('outputData', this.supportOutputBuffer);
        

        this.supportCompute.workerSizeX = this.lineCount;
        this.supportCompute.workerSizeY = 1;
        this.supportCompute.workerSizeZ = 1;
    }

    public compute(view: View3D) {
        switch (this.state) {
            case 'init':
                break;
            case 'compute':
                {
                    let stand = GlobalBindGroup.getCameraGroup(view.camera);
                    this.supportCompute.setStorageBuffer('globalUniform', stand.uniformGPUBuffer);

                    let command = GPUContext.beginCommandEncoder();
                    GPUContext.computeCommand(command, [this.supportCompute]);
                    GPUContext.endCommandEncoder(command);

                    console.warn("call compute!");

                    this.state = 'wait';

                    this.supportInputBuffer.readBuffer(true).then(()=>{
                        this.state = 'complete';
                    });
                }
                break;
            case 'complete':
                {
                    let result = [];

                    for (let i = 0; i < this.lineCount; i++) {
                        const index = i * 12;

                        let x = this.supportInputBuffer.outFloat32Array[index + 4];
                        let y = this.supportInputBuffer.outFloat32Array[index + 5];
                        let z = this.supportInputBuffer.outFloat32Array[index + 6];

                        let reserve = this.supportInputBuffer.outFloat32Array[index + 7];

                        let nx = this.supportInputBuffer.outFloat32Array[index + 8];
                        let ny = this.supportInputBuffer.outFloat32Array[index + 9];
                        let nz = this.supportInputBuffer.outFloat32Array[index + 10];

                        let data = {
                            // v: {
                            //     x: x,
                            //     y: y,
                            //     z: z,
                            // },
                            // normal: {
                            //     x: nx,
                            //     y: ny,
                            //     z: nz,
                            // },
                            v: new Vector3(x, y, z),
                            normal: new Vector3(nx, ny, nz),
                            reserve: reserve,
                        };
                        result.push(data);

                        // if (reserve >= 0) {
                        //     // if (reserve === 100) {
                        //     //     console.error(`${i}: ${reserve}, pos(${x}, ${y})`); 
                        //     // }

                        //     console.warn(`${i}: ${reserve}, position(${x}, ${y}, ${z})`);
                            
                        //     // let data = {
                        //     //     x: x,
                        //     //     y: y,
                        //     //     z: z,
                        //     //     reserve: true,
                        //     // };
                        //     // result.push(data);
                        // } else {
                        //     console.error(`Remove(${i}): angle:${reserve}`);
                        // }
                    }
                    this.state = 'wait';

                    console.warn("call complete!");

                    if (this.callback) {
                        this.callback(result);
                    }
                }
                break;
        }
    }

    public render(view: View3D, command: GPUCommandEncoder) {
        this.compute(view);
        // this.rtViewQuad.forEach((viewQuad, k) => {
        //     let lastTexture = GPUContext.lastRenderPassState.getLastRenderTexture();
        //     viewQuad.renderToViewQuad(view, viewQuad, command, lastTexture);
        // });
    }

    public calculateSupport(lines: { p0: { x: number, y: number }, p1: { x: number, y: number } }[], callback?:Function) {
        this.callback = callback;
        this.lineCount = lines.length;

        let supportData = new Float32Array(12 * lines.length);
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            const p0 = line.p0;
            supportData[i * 12 + 0] = p0.x;
            supportData[i * 12 + 1] = p0.y;

            const p1 = line.p1;
            supportData[i * 12 + 2] = p1.x;
            supportData[i * 12 + 3] = p1.y;

            supportData[i * 12 + 4] = 0;
            supportData[i * 12 + 5] = 0;
            supportData[i * 12 + 6] = 0;

            supportData[i * 12 + 7] = 0;
        }

        this.supportInputBuffer && this.supportInputBuffer.destroy();
        this.supportInputBuffer = new ComputeGPUBuffer(supportData.length, supportData);

        this.createResource();
        this.createCompute();
        this.state = 'compute';
    }
}

export class Sample_Test {
    view: View3D;

    protected supportGenerator: SupportGenerator;
    protected mainCamera: Camera3D;
    protected orthoCamera: Camera3D;

    protected peer: Window;
    protected supportCalculator: SupportCalculator;

    protected mainCanvas: HTMLCanvasElement;

    protected enableDebug: boolean = false;

    protected scaleFactor: number = 20;
    protected supportPillarTopPoints: Vector3[];

    async run() {

        let canvas = document.createElement('canvas');
        document.body.appendChild(canvas);
        this.mainCanvas = canvas;
        this.mainCanvas.style.width = '100%';
        this.mainCanvas.style.height = '100%';

        await Engine3D.init({
            canvasConfig: {
                canvas: canvas,
            },
        });

        GUIHelp.init();

        let scene = new Scene3D();

        let sky = scene.addComponent(AtmosphericComponent)
        sky.sunY = 0.6;
        // sky.enable = false;

        // init camera3D
        let mainCamera = CameraUtil.createCamera3D(null, scene);
        mainCamera.perspective(60, Engine3D.aspect, 0.01, 200.0);
        this.mainCamera = mainCamera;
        let hoverCameraController = mainCamera.object3D.addComponent(FlyCameraController);

        // add a basic direct light
        let lightObj = new Object3D();
        lightObj.rotationX = 45;
        lightObj.rotationY = 60;
        lightObj.rotationZ = 150;
        let dirLight = lightObj.addComponent(DirectLight);
        dirLight.lightColor = KelvinUtil.color_temperature_to_rgb(5355);
        dirLight.intensity = 20;
        scene.addChild(lightObj);
        // sky.relativeTransform = dirLight.transform;

        // create a view with target scene and camera
        this.view = new View3D();
        this.view.scene = scene;
        this.view.camera = mainCamera;

        // start render
        Engine3D.startRenderView(this.view);

        let postProcessing = scene.addComponent(PostProcessingComponent);
        this.supportCalculator = postProcessing.addPost(SupportCalculator);

        await this.test();
    }

    private mesh: Mesh;

    private async test() {
        let rawGeometry: GeometryBase;

        // this.view.graphic3D.drawAxis('axis');

        {
            // const res = 'stls/支撑模型/基托.stl';
            // const res = 'stls/支撑模型/铸造蜡-活动义齿支架.stl';
            const res = 'stls/No_bottom_thick2.5.stl';
            // const res = 'stls/sphere.stl';
            // const res = 'stls/testA.stl';
            // const res = 'stls/0325/0325/抽壳/底部孤岛自适应.stl';

            let obj = await Engine3D.res.loadSTL(res) as Object3D;

            let mr = obj.getComponentsInChild(MeshRenderer)[0];
            rawGeometry = mr.geometry;
            // mr.material.doubleSide = true;
            // mr.material.cullMode = GPUCullMode.back;
            mr.material.baseColor = new Color(1.0, 1.0, 1.0);
            // this.view.scene.addChild(obj);

            if (true) {
                let mesh = new Mesh(mr);
                this.mesh = mesh;

                // obj.rotationX = -90;

                // obj.x = 50;
                obj.y = 40;

                let meshObj = new Object3D();
                meshObj.rotationX = mesh.rawMesh.transform.rotationX;
                meshObj.localPosition = mesh.matrixWorld.position;

                let mainMaterial = new LitMaterial();
                mainMaterial.doubleSide = true;
                mainMaterial.baseColor = Color.COLOR_WHITE; //new Color(0.0, 0.9, 1.0);

                let mr2 = meshObj.addComponent(MeshRenderer);
                mr2.geometry = mesh.geometry.toGeometryBase();
                mr2.material = mainMaterial;
                this.view.scene.addChild(meshObj);

                let depthMaterial = new DepthMaterial();
                depthMaterial.doubleSide = true;
                depthMaterial.boundBox = meshObj.bound;

                let bottomEdgeMaterial = new DepthMaterial();
                bottomEdgeMaterial.doubleSide = true;
                bottomEdgeMaterial.boundBox = meshObj.bound;
                bottomEdgeMaterial.onlyBottomEdge = true;

                // this.myRenderer.target = mr2;
                mr2.material = depthMaterial;
                // this.myRenderer.setTarget(meshObj);
                // mr2.material = mainMaterial;

                if (true) {
                    const min = meshObj.bound.min;
                    const max = meshObj.bound.max;
                    const rectWidth = max.x - min.x + 2;
                    const rectHeight = max.z - min.z + 2;
                    if (!this.orthoCamera) {
                        this.orthoCamera = CameraUtil.createCamera3D(null, this.view.scene);
                        let orthoCamera = this.orthoCamera;
                        orthoCamera.ortho(-rectWidth, rectHeight, 0.01, 1000.0);
                        let pos = obj.transform.worldPosition.clone().addScaledVector(Vector3.DOWN, 50);
                        orthoCamera.lookAt(pos, obj.transform.worldPosition, Vector3.Z_AXIS);
                    }

                    let supportPoint: Object3D = new Object3D();
                    this.view.scene.addChild(supportPoint);

                    let params = {
                        BorderStep: 60,
                        BorderOffSize: 3,
                        KernelStep: 5,
                        ContourStep: 50,
                        SupportAngle: 45,
                    }

                    let supportPointList = [];
                    let topContourTest = [];
                    let bottomContourTest = [];

                    let support = GUIHelp.addFolder('Support');
                    support.add(params, 'BorderStep', 1, 100);
                    support.add(params, 'BorderOffSize', 1, 5);
                    // support.add(params, 'KernelStep', 1, 100);
                    support.add(params, 'ContourStep', 1, 200);
                    support.add(params, 'SupportAngle', 1, 90);
                    GUIHelp.addButton('Generate', async () => {
                        supportPoint.removeAllChild();

                        this.supportCalculator.maxAngle = params.SupportAngle;

                        params.KernelStep = Math.floor(params.ContourStep / 10);

                        this.mainCanvas.removeAttribute('style');

                        this.view.camera = this.orthoCamera;

                        mr2.material = depthMaterial;

                        let linesAndBottomContour = await new Promise<{ lines:{p0: { x: number; y: number; }; p1: { x: number; y: number; }; key: boolean}[], topContour: { x: number; y: number; }[], bottomContour: { x: number; y: number; }[] }>(res => {
                            let iframe = document.createElement('iframe');
                            iframe.id = 'support';
                            iframe.src = '/support.html';
                            iframe.setAttribute('style', 'position:fixed; top:0; left:100%; width: 1000px; height: 100%;');
                            document.body.appendChild(iframe);
                            this.peer = iframe.contentWindow;
                            let topContour;
                            let bottomContour;
                            iframe.contentWindow.addEventListener('message', async (event) => {
                                if (event.data.id === 'ready') {
                                    console.warn('3D:recv ready.');
        
                                    let width = Math.floor(rectWidth * this.scaleFactor);
                                    let height = Math.floor(rectHeight * this.scaleFactor);
                                    this.mainCanvas.width = width;
                                    this.mainCanvas.height = height;
                                    this.mainCanvas.style.width = width + 'px';
                                    this.mainCanvas.style.height = height + 'px';
                                    console.error(this.mainCanvas.getAttribute('style'));
                                    console.warn('Canvas:', width, height);
                                    console.error('MainCanvasSize1:', this.mainCanvas.width, this.mainCanvas.height);
        
                                    await new Promise(res=>{
                                        setTimeout(() => {
                                           res(true);
                                        }, 100);
                                    })
        
                                    
                                    var imageDataURL = this.mainCanvas.toDataURL('image/png');
                                    console.error('MainCanvasSize2:', this.mainCanvas.width, this.mainCanvas.height);

    
                                    mr2.material = bottomEdgeMaterial;
    
                                    event.source.postMessage({
                                        id: 'reqLines',
                                        params: params,
                                        imageData: imageDataURL,
                                    });
        
                                    return;
                                }

                                if (event.data.id === 'resBottom') {
                                    console.warn('recv: bottom');
                                    topContour = event.data.path1;
                                    bottomContour = event.data.path2;
                                    return;
                                }
        
                                if (event.data.id === 'resLines') {
                                    console.warn('recv: lines');
                                    if (!this.enableDebug) {
                                        iframe.remove();
                                    } else {
                                        iframe.style.left = '50%';
                                    }
                                    res({
                                        lines: event.data.lines,
                                        topContour: topContour,
                                        bottomContour: bottomContour,
                                    });
                                    return;
                                }
                            });
                        })
    
                        let borderPoints = await new Promise<number[][]>(res => {
                            let iframe = document.createElement('iframe');
                            iframe.id = 'supportBorder';
                            iframe.src = '/supportBorder.html';
                            iframe.setAttribute('style', 'position:fixed; top:0; left:100%; width: 1000px; height: 100%;');
                            document.body.appendChild(iframe);
                            this.peer = iframe.contentWindow;
                            iframe.contentWindow.addEventListener('message', async (event) => {
                                if (event.data.id === 'ready') {
                                    console.warn('3D:recv ready.');
    
                                    var imageDataURL = this.mainCanvas.toDataURL('image/png');
    
                                    mr2.material = depthMaterial;
    
                                    event.source.postMessage({
                                        id: 'reqBorder',
                                        imageData: imageDataURL,
                                        params: params,
                                    });
        
                                    return;
                                }
        
                                if (event.data.id === 'resBorder') {
                                    console.warn('recv: Border');
                                    iframe.remove();
                                    res(event.data.borderPoints);
                                    return;
                                }
                            });
                        })
    
                        function dis(x1, y1, x2, y2){
                            return Math.sqrt((x1-x2)*(x1-x2) + (y1-y2)*(y1-y2))
                        }
    
                        const maxDis = params.ContourStep;
    
                        let newLines = [];
                        const lines = linesAndBottomContour.lines;
                        for (let line of lines) {
                            if (line.key === true) {
                                continue;
                            }
                            let remove = false;
                            for (let p of borderPoints) {
                                const x = p[0]; const y = p[1];
                                let d = dis(line.p0.x, line.p0.y, x, y);
                                if (d <= maxDis) {
                                    remove = true;
                                    break;
                                }
                            }
    
                            if (!remove) {
                                newLines.push(line);
                            }
                        }

                        for (let p of borderPoints) {
                            let pos = {
                                x: p[0],
                                y: p[1],
                            };
                            newLines.push({
                                p0: pos,
                                p1: pos,
                            })
                        }

                        let worldBoundBox = BoundUtil.transformBound(mr2.transform.worldMatrix, mr2.geometry.bounds);
                        worldBoundBox.center.y = 0;
                        let w = worldBoundBox.max.x - worldBoundBox.min.x;
                        let h = worldBoundBox.max.z - worldBoundBox.min.z;
                        let geo = new SphereGeometry(0.2, 8, 8);
                        let centerPointMat = new UnLitMaterial();
                        centerPointMat.baseColor = new Color(0, 1, 1);

                        if (linesAndBottomContour.topContour) {
                            for (let pos of linesAndBottomContour.topContour) {
                                topContourTest.push(new Vector3(
                                    (pos.x / this.scaleFactor) - rectWidth * 0.5 + worldBoundBox.center.x,
                                    2,
                                    ((rectHeight - pos.y / this.scaleFactor) - rectHeight * 0.5) + worldBoundBox.center.z
                                ));
                            }
                        }

                        for (let pos of linesAndBottomContour.bottomContour) {
                            bottomContourTest.push(new Vector3(
                                (pos.x / this.scaleFactor) - rectWidth * 0.5 + worldBoundBox.center.x,
                                0,
                                ((rectHeight - pos.y / this.scaleFactor) - rectHeight * 0.5) + worldBoundBox.center.z
                            ));
                        }
    
                        this.supportCalculator.calculateSupport(newLines, (points)=> {
                            let geo = new SphereGeometry(0.2, 8, 8);

                            let supportPointMat = new UnLitMaterial();
                            supportPointMat.baseColor = new Color(1, 0, 0); // (0.2, 0.3, 1);

                            let removePointMat = new UnLitMaterial();
                            removePointMat.baseColor = new Color(1, 1, 0);
    
                            let centerPointMat = new UnLitMaterial();
                            centerPointMat.baseColor = new Color(0, 1, 1);

                            supportPointList = [];

                            let i = 0;
                            for (let point of points) {

                                let useMaterial: Material;

                                const pos = point.v;

                                if (point.reserve == 10000) {
                                    useMaterial = centerPointMat;
                                    supportPointList.push(point);
                                    let v = pos.clone();
                                    v.y = 0;
                                    // bottomContourTest.push(v);
                                    i++;
                                    if (i > 3) {
                                        // continue;
                                    }
                                } else if (point.reserve >= 0) {
                                    useMaterial = supportPointMat;
                                    supportPointList.push(point);
                                } else {
                                    useMaterial = removePointMat;
                                    // continue;
                                }

                                // Invalid filter point
                                if (pos.x == pos.y && pos.y == pos.z && pos.z == 0) {
                                    continue;
                                }

                                let obj = new Object3D();
                                obj.x = pos.x;
                                obj.y = pos.y;
                                obj.z = pos.z;

                                let mr = obj.addComponent(MeshRenderer);
                                mr.geometry = geo;
                                mr.material = useMaterial;
                                supportPoint.addChild(obj);
    
                                // console.warn(pos.x, pos.y, pos.z);
                            }
    
                            let pos = obj.transform.worldPosition.clone().addScaledVector(Vector3.DOWN, 100);
                            this.mainCamera.lookAt(pos, obj.transform.worldPosition, Vector3.Z_AXIS);
    
                            this.view.camera = this.mainCamera;
                            if (!this.enableDebug) {
                                this.mainCanvas.style.width = '100%';
                                this.mainCanvas.style.height = '100%';
                            }
                            mr2.material = mainMaterial;


                            this.removeSupports();
                            this.baseMesh = mesh;
                            if (!this.supportGenerator) {
                                this.supportGenerator = new SupportGenerator(mesh, this.getOctree());
                            }
                        });
                    });
                    GUIHelp.addButton('Remove', () => {
                        supportPoint.removeAllChild();
                    });
                    GUIHelp.addButton('SwitchCamera', () => {
                        if (this.view.camera === this.mainCamera) {
                            this.view.camera = this.orthoCamera;
                        } else {
                            this.view.camera = this.mainCamera;
                        }
                    });
                    support.add(this.params, 'radius', 0.01, 1).name('PillarSize');
                    support.add(this.params, 'taperFactor', 0.1, 1).name('TaperSize');
                    support.add(this.params, 'subdivs', 2, 64, 2).name('SubdivsNum');
                    GUIHelp.addButton('BuildSupportPillar', () => {
                        this.removeSupports();
                        // build support structure
                        this.buildSupports(supportPointList);
                    });
                    GUIHelp.addButton('RemoveSupportPillar', () => {
                        this.removeSupports();
                    });

                    support.add(this.supportBaseBuildParams, 'offset', 0.1, 10).name('Offset');
                    support.add(this.supportBaseBuildParams, 'height', 0.1, 10).name('Height');
                    support.add(this.supportBaseBuildParams, 'angle', 3, 90).name('Angle');
                    GUIHelp.addButton('BuildSupportBase', async () => {
                        this.removeSupportBaseFromContourPoints()

                        this.buildSupportBaseFromContourPoints_Old(bottomContourTest, this.supportBaseBuildParams);

                        // this.buildSupportBaseFromContourPoints(this.supportPillarTopPoints, rectWidth, rectHeight);
                    });
                    GUIHelp.addButton('RemoveSupportBase', () => {
                        this.removeSupportBaseFromContourPoints()
                    });
                    support.add(this.supportPillarReinforceParams, 'height', 0.1, 10).name('Height');
                    support.add(this.supportPillarReinforceParams, 'angle', 5, 60).name('Angle');
                    support.add(this.supportPillarReinforceParams, 'radius', 0.01, 10).name('Radius');
                    // support.add(this.supportPillarReinforceParams, 'subdivs', 3, 64, 1).name('Subdivs');
                    GUIHelp.addButton('BuildReinforcePillar', () => {
                        this.removeSupportPillarReinforce();
                        // this.supportPillarReinforceParams.radius = this.params.radius - 0.05;
                        this.supportPillarReinforceParams.subdivs = this.params.subdivs;
                        this.buildSupportPillarReinforce(this.supportPillarTopPoints, this.supportPillarReinforceParams);
                    });
                    GUIHelp.addButton('RemoveReinforcePillar', () => {
                        this.removeSupportPillarReinforce();
                    });
                    GUIHelp.addButton('ShowAxis', () => {
                        this.view.graphic3D.drawAxis('axis');
                    });
                    support.open();
                }
            }
        }

        if (false) {
            let obj = new Object3D();
            let mr = obj.addComponent(MeshRenderer);
            mr.geometry = new PlaneGeometry(200, 120, 1, 1, Vector3.Y_AXIS);
            mr.material = new LitMaterial();
            this.view.scene.addChild(obj);
        }
    }

    private octree: Octree;
    private baseMesh: Mesh;
    private supportObj: Object3D;
    private supportPoint: Object3D;
    private supportFaces: Object3D;
    private supportBase: Object3D;
    private supportReinforcePillar: Object3D;
    private removeSupports() {
        if (this.supportObj) {
            this.supportObj.removeFromParent();
            this.supportObj = null;
        }
        if (this.supportPoint) {
            this.supportPoint.removeFromParent();
            this.supportPoint = null;
        }
        if (this.supportFaces) {
            this.supportFaces.removeFromParent();
            this.supportFaces = null;
        }
    }

    private params = {
        angle: 90,
        axis: 'y',
        layerHeight: 0.1,
        radius: 0.4,
        radiusFn: SupportGenerator.RadiusFunctions_sqrt,
        radiusFnK: 0.01,
        resolution: 2.4000000000000004,
        subdivs: 6,
        taperFactor: 0.25,

        spacingFactor: 24,
    };

    private buildSupports(supportPoints: {v:{x:number,y:number, z:number},normal:{x:number,y:number,z:number}}[]) {
        this.generateSupports(this.mesh, this.params, supportPoints);
    }

    private supportBaseBuildParams = {
        offset: 1.0,
        height: 0.5,
        angle: 90,
    };

    private removeSupportBaseFromContourPoints() {
        if (this.supportBase) {
            this.supportBase.removeFromParent();
            this.supportBase = null;
        }
    }

    private async buildSupportBaseFromContourPoints(supportPillarTopPoints: Vector3[], rectWidth: number, rectHeight: number) {
        let contourPoints = await new Promise<{x: number, y: number}[]>(res => {
            let iframe = document.createElement('iframe');
            iframe.id = 'mstBase';
            iframe.src = '/MST.html';
            iframe.setAttribute('style', 'position:fixed; top:0; left:100%; width: 1000px; height: 100%;');
            document.body.appendChild(iframe);
            this.peer = iframe.contentWindow;
            iframe.contentWindow.addEventListener('message', async (event) => {
                if (event.data.id === 'ready') {
                    console.warn('3D:recv ready.');

                    const scaleFactor: number = 10;

                    let points = [];
                    for (let p of supportPillarTopPoints) {
                        const x = (p.x + rectWidth * 0.5) * scaleFactor;
                        const y = (p.z + rectHeight * 0.5) * scaleFactor;
                        points.push({x: x, y: y});
                    }

                    event.source.postMessage({
                        id: 'reqBaseMST',
                        points: points,
                        width: rectWidth * scaleFactor,
                        height: rectHeight * scaleFactor,
                    });

                    return;
                }

                if (event.data.id === 'resBaseMST') {
                    console.warn('recv: BaseMST');
                    // iframe.remove();
                    res(event.data.contourPoints);
                    return;
                }
            });
        });

        console.warn('contourPoints:', contourPoints);

        let baseGeometry = new Geometry();
        this.delaunayTriangulation(contourPoints, baseGeometry, rectWidth, rectHeight);
        // this.earClippingTriangulation(contourPoints, baseGeometry, rectWidth, rectHeight);

        this.supportBase = new Object3D();
        let supportMesh = this.supportBase.addComponent(MeshRenderer);
        supportMesh.geometry = baseGeometry.toGeometryBase();

        let mat = new LitMaterial();
        mat.baseColor = new Color(1, 1, 1);
        supportMesh.material = mat;

        supportMesh.material.doubleSide = true;
        this.view.scene.addChild(this.supportBase);
    }

    private delaunayTriangulation(contourPoints, baseGeometry: Geometry, rectWidth: number, rectHeight: number) {
        class Point {
            constructor(public x: number, public y: number) {}
        }
        
        class Triangle {
            constructor(public p1: Point, public p2: Point, public p3: Point) {}
        }
        
        function circumCircle(p1: Point, p2: Point, p3: Point) {
            const A = p2.x - p1.x;
            const B = p2.y - p1.y;
            const C = p3.x - p1.x;
            const D = p3.y - p1.y;
        
            const E = A * (p1.x + p2.x) + B * (p1.y + p2.y);
            const F = C * (p1.x + p3.x) + D * (p1.y + p3.y);
        
            const G = 2.0 * (A * (p3.y - p2.y) - B * (p3.x - p2.x));
            if (Math.abs(G) < 0.000001) return null;
        
            const cx = (D * E - B * F) / G;
            const cy = (A * F - C * E) / G;
        
            const dx = cx - p1.x;
            const dy = cy - p1.y;
            const r = Math.sqrt(dx * dx + dy * dy);
        
            return { center: new Point(cx, cy), radius: r };
        }
        
        function isPointInCircumcircle(p: Point, circumcircle: { center: Point, radius: number }) {
            const dx = p.x - circumcircle.center.x;
            const dy = p.y - circumcircle.center.y;
            return (dx * dx + dy * dy) <= (circumcircle.radius * circumcircle.radius);
        }

        function delaunayTriangulation(points: Point[]): Triangle[] {
            const superTriangle = new Triangle(
                new Point(-1000, -1000),
                new Point(1000, -1000),
                new Point(0, 1000)
            );
        
            let triangles = [superTriangle];

            points.forEach(p => {
                let edges: { p1: Point, p2: Point }[] = [];
        
                triangles = triangles.filter(tri => {
                    const circumcircle = circumCircle(tri.p1, tri.p2, tri.p3);
                    if (circumcircle && isPointInCircumcircle(p, circumcircle)) {
                        edges.push({ p1: tri.p1, p2: tri.p2 });
                        edges.push({ p1: tri.p2, p2: tri.p3 });
                        edges.push({ p1: tri.p3, p2: tri.p1 });
                        return false;
                    }
                    return true;
                });
        
                for (let i = 0; i < edges.length; i++) {
                    for (let j = i + 1; j < edges.length; j++) {
                        if ((edges[i].p1 === edges[j].p2 && edges[i].p2 === edges[j].p1) ||
                            (edges[i].p1 === edges[j].p1 && edges[i].p2 === edges[j].p2)) {
                            edges.splice(j, 1);
                            edges.splice(i, 1);
                            i--;
                            break;
                        }
                    }
                }
        
                edges.forEach(edge => {
                    triangles.push(new Triangle(edge.p1, edge.p2, p));
                });
            });
        
            triangles = triangles.filter(tri => {
                return tri.p1 !== superTriangle.p1 && tri.p1 !== superTriangle.p2 && tri.p1 !== superTriangle.p3 &&
                       tri.p2 !== superTriangle.p1 && tri.p2 !== superTriangle.p2 && tri.p2 !== superTriangle.p3 &&
                       tri.p3 !== superTriangle.p1 && tri.p3 !== superTriangle.p2 && tri.p3 !== superTriangle.p3;
            });
        
            return triangles;
        }

        let result = delaunayTriangulation(contourPoints);

        for (let t of result) {
            const sidx = baseGeometry.vertices.length;
            baseGeometry.vertices.push(new Vector3(
                t.p1.x / 10 - rectWidth * 0.5,
                0, 
                t.p1.y / 10 - rectHeight * 0.5
            ));
            baseGeometry.vertices.push(new Vector3(
                t.p2.x / 10 - rectWidth * 0.5,
                0, 
                t.p2.y / 10 - rectHeight * 0.5
            ));
            baseGeometry.vertices.push(new Vector3(
                t.p3.x / 10 - rectWidth * 0.5,
                0, 
                t.p3.y / 10 - rectHeight * 0.5
            ));
            baseGeometry.faces.push(new Face(sidx + 0, sidx + 1, sidx + 2));
        }
    }

    private earClippingTriangulation(contourPoints, baseGeometry: Geometry, rectWidth: number, rectHeight: number) {

        type Point = {x: number, y: number};
        type Triangle = [Point, Point, Point];

        function isPointInTriangle(A: Point, B: Point, C: Point, P: Point): boolean {
            const area = (A: Point, B: Point, C: Point): number => {
                return 0.5 * (-B.y * C.x + A.y * (-B.x + C.x) + A.x * (B.y - C.y) + B.x * C.y);
            };
        
            const s = 1 / (2 * area(A, B, C)) * (A.y * C.x - A.x * C.y + (C.y - A.y) * P.x + (A.x - C.x) * P.y);
            const t = 1 / (2 * area(A, B, C)) * (A.x * B.y - A.y * B.x + (A.y - B.y) * P.x + (B.x - A.x) * P.y);
        
            return s > 0 && t > 0 && (1 - s - t) > 0;
        }

        function crossProduct(o: Point, a: Point, b: Point): number {
            return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
        }

        function isConvex(p1: Point, p2: Point, p3: Point): boolean {
            return crossProduct(p2, p1, p3) > 0;
        }

        function isEar(polygon: Point[], i: number): boolean {
            const prevIndex = (i - 1 + polygon.length) % polygon.length;
            const nextIndex = (i + 1) % polygon.length;
            const p1 = polygon[prevIndex];
            const p2 = polygon[i];
            const p3 = polygon[nextIndex];
        
            if (!isConvex(p1, p2, p3)) return false;
        
            for (let j = 0; j < polygon.length; j++) {
                if (j === prevIndex || j === i || j === nextIndex) continue;
                if (isPointInTriangle(p1, p2, p3, polygon[j])) {
                    return false;
                }
            }
            return true;
        }

        function earClippingTriangulation(polygon: Point[]): Triangle[] {
            const triangles: Triangle[] = [];
            const vertices = polygon.slice();
        
            while (vertices.length > 3) {
                let earFound = false;
                for (let i = 0; i < vertices.length; i++) {
                    if (isEar(vertices, i)) {
                        const prevIndex = (i - 1 + vertices.length) % vertices.length;
                        const nextIndex = (i + 1) % vertices.length;
                        triangles.push([vertices[prevIndex], vertices[i], vertices[nextIndex]]);
                        vertices.splice(i, 1);
                        earFound = true;
                        break;
                    }
                }
                if (!earFound) {
                    throw new Error("No ear found. The polygon might be degenerate or not simple.");
                }
            }
        
            // Add the last remaining triangle
            triangles.push([vertices[0], vertices[1], vertices[2]]);
            return triangles;
        }

        let result = earClippingTriangulation(contourPoints);

        for (let t of result) {
            const sidx = baseGeometry.vertices.length;
            for (let i = 0; i < 3; i++) {
                baseGeometry.vertices.push(new Vector3(
                    t[i].x / 10 - rectWidth * 0.5,
                    0, 
                    t[i].y / 10 - rectHeight * 0.5
                ));
            }
            baseGeometry.faces.push(new Face(sidx + 0, sidx + 1, sidx + 2));
        }
    }

    private buildSupportBaseFromContourPoints_Old(contourPoints: Vector3[], params?) {
        params = params || {
            offset: 1.0,
            height: 0.5,
            angle: 60,
        };

        let baseGeometry = new Geometry();

        function calculateCentroid(points: Vector3[]): Vector3 {
            const n = points.length;
            let sumX = 0, sumZ = 0;
            for (const point of points) {
                sumX += point.x;
                sumZ += point.z;
            }
            return new Vector3(sumX / n, points[0].y, sumZ / n);
        }

        let centroid = calculateCentroid(contourPoints);
        let points = [];
        points.push(centroid);
        points.push(...contourPoints);

        console.error("Count:", points.length);

        // bottom
        const bottomStartIdx = baseGeometry.vertices.length;
        baseGeometry.vertices.push(...points);
        for (let i = 1; i < points.length - 1; i++) {
            baseGeometry.faces.push(new Face(0, i, i+1));
        }
        baseGeometry.faces.push(new Face(0, points.length - 1, 1));


        let factor = 1.0;
        {
            function findIntersection(p0: Vector3, H: number, a: number): Vector3 {
                a = a * Math.PI / 180.0;
                const cotA = 1 / Math.tan(a);
                const x1 = p0.x + H * cotA;
                const y1 = H;
                const z1 = p0.z;
                return new Vector3(x1, y1, z1);
            }
            const p0 = Vector3.HELP_0.set(10, 0, 0); //points[1];
            const p1 = findIntersection(p0, params.height, params.angle);
            factor = 1.0 + (p1.x - p0.x) / p0.x;
        }

        // function calculateFactor(H: number, a: number): number {
        //     a = a * Math.PI / 180.0;
        //     const cotA = 1 / Math.tan(a);
        //     const x1 = H * cotA;
        //     return 1.0 + x1;
        // }
        // let factor = calculateFactor(params.height, params.angle);

        // top
        const topStartIdx = baseGeometry.vertices.length;
        for (let pos of points) {
            let newPos = pos.clone().multiplyScalar(factor);
            newPos.y += params.height;
            baseGeometry.vertices.push(newPos);
        }
        for (let i = 1; i < points.length - 1; i++) {
            baseGeometry.faces.push(new Face(topStartIdx, topStartIdx + i, topStartIdx + i + 1));
        }
        baseGeometry.faces.push(new Face(topStartIdx, topStartIdx + points.length - 1, topStartIdx + 1));

        // periphery
        for (let i = 1; i < points.length - 1; i++) {
            baseGeometry.faces.push(new Face(topStartIdx + i, bottomStartIdx + i, bottomStartIdx + i + 1));
            baseGeometry.faces.push(new Face(bottomStartIdx + i + 1, topStartIdx + i + 1, topStartIdx + i));
        }
        baseGeometry.faces.push(new Face(topStartIdx + points.length - 1, bottomStartIdx + points.length - 1, bottomStartIdx + 1));
        baseGeometry.faces.push(new Face(bottomStartIdx + 1, topStartIdx + 1, topStartIdx + points.length - 1));


        this.supportBase = new Object3D();
        let supportMesh = this.supportBase.addComponent(MeshRenderer);
        supportMesh.geometry = baseGeometry.toGeometryBase();

        let mat = new LitMaterial();
        mat.baseColor = new Color(1, 1, 1);
        supportMesh.material = mat;

        supportMesh.material.doubleSide = true;
        this.view.scene.addChild(this.supportBase);
    }

    private supportPillarReinforceParams = {
        height: 1,
        angle: 45,
        radius: 0.5,
        subdivs: 6,
    };

    private removeSupportPillarReinforce() {
        if (this.supportReinforcePillar) {
            this.supportReinforcePillar.removeFromParent();
            this.supportReinforcePillar = null;
        }
    }

    private buildSupportPillarReinforce(supportPoints: Vector3[], params?) {
        params = params || {
            height: 1,
            angle: 45,
            radius: 0.5,
            subdivs: 6,
        };

        function distance(a, b): number {
            Vector3.HELP_0.set(a.x, a.y, a.z);
            Vector3.HELP_1.set(b.x, b.y, b.z);
            return Vector3.distanceXZ(Vector3.HELP_0, Vector3.HELP_1)
        }
        const mstEdges = [];
        const unvisitedNodes = new Set(supportPoints.map((_, index) => index));
        const visitedNodes = new Set([0]);
        unvisitedNodes.delete(0);
        const edgesHeap = new MinHeap();
        supportPoints.forEach((point, i) => {
            if (i !== 0) {
                edgesHeap.push({ from: 0, to: i, weight: distance(supportPoints[0], point) });
            }
        });
        while (unvisitedNodes.size > 0) {
            const { from, to } = edgesHeap.pop();
            if (visitedNodes.has(to))
                continue;

            mstEdges.push({ from, to });
            visitedNodes.add(to);
            unvisitedNodes.delete(to);

            unvisitedNodes.forEach(nodeIndex => {
                if (!visitedNodes.has(nodeIndex)) {
                    const newWeight = distance(supportPoints[to], supportPoints[nodeIndex]);
                    edgesHeap.push({ from: to, to: nodeIndex, weight: newWeight });
                }
            });
        }


        let geometryData = new Geometry();

        function getExtensionIntersectionPoint(startPoint: Vector3, maxHeightPoint: Vector3, angle: number = 45) {
            let distance = Vector3.distanceXZ(startPoint, maxHeightPoint);
            let height = distance * Math.tan(angle * (Math.PI / 180));
            if (height > maxHeightPoint.y) {
                return null;
            }
            return new Vector3(
                maxHeightPoint.x, 
                startPoint.y + height,
                maxHeightPoint.z
            );
        }

        mstEdges.forEach(edge => {
            // drawEdge(supportPoints[edge.from], supportPoints[edge.to]);
            const startPos = supportPoints[edge.from];
            const endPos = supportPoints[edge.to];
            const minHeight = Math.min(startPos.y, endPos.y)

            const minLength = params.radius * 2 / Math.sin(params.angle * (Math.PI / 180));
            if (Vector3.distanceXZ(startPos, endPos) - this.params.radius * 2 < minLength) {
                return
            }

            let p: Vector3 = new Vector3(0, 0, 0);
            while (p && (p.y + params.height) < minHeight) {
                let s = Vector3.HELP_0.set(startPos.x, p.y + params.height, startPos.z);
                let e = Vector3.HELP_1.set(endPos.x, endPos.y, endPos.z);
                p = getExtensionIntersectionPoint(s, e, params.angle);
                if (p && p.y < minHeight) geometryData.buildConnectRod(s, p, params.radius, params.subdivs);
            }

            p = new Vector3(0, 0, 0);
            while (p && (p.y + params.height) < minHeight) {
                let s = Vector3.HELP_0.set(endPos.x, p.y + params.height, endPos.z);
                let e = Vector3.HELP_1.set(startPos.x, startPos.y, startPos.z);
                p = getExtensionIntersectionPoint(s, e, params.angle);
                if (p && p.y < minHeight) geometryData.buildConnectRod(s, p, params.radius, params.subdivs);
            }
        });

        this.supportReinforcePillar = new Object3D();
        let supportMesh = this.supportReinforcePillar.addComponent(MeshRenderer);
        supportMesh.geometry = geometryData.toGeometryBase();

        let mat = new LitMaterial();
        mat.baseColor = new Color(1, 1, 1);
        supportMesh.material = mat;

        supportMesh.material.doubleSide = true;
        this.view.scene.addChild(this.supportReinforcePillar);
    }

    private generateSupports(mesh: Mesh, params, points) {
        this.removeSupports();
        this.baseMesh = mesh;

        if (!this.supportGenerator) {
            this.supportGenerator = new SupportGenerator(mesh, this.getOctree());
        }

        let supportGeometryResult = this.supportGenerator.Generate(params, points);

        if (!supportGeometryResult) return;

        // Test:
        this.supportPillarTopPoints = supportGeometryResult.testPoints;
        // console.warn('testPoints:', testPoints.length);
        // for (let pos of testPoints) {
        //     console.warn(pos);
        //     let obj = new Object3D();
        //     obj.x = pos.x;
        //     obj.y = pos.y;
        //     obj.z = pos.z;
        //     let mr = obj.addComponent(MeshRenderer);
        //     mr.geometry = new BoxGeometry();
        //     mr.material = new UnLitMaterial();
        //     this.view.scene.addChild(obj);
        // }

        // support geometry is generated in world space; put it in the base mesh's
        // object space so that they can be transformed with the same matrix
        let inverseMatrix = Matrix4.help_matrix_0.copyFrom(mesh.matrixWorld); inverseMatrix.invert();
        // supportGeometry.applyMatrix(inverseMatrix);

        if (true) {
            this.supportObj = new Object3D();
            let supportMesh = this.supportObj.addComponent(MeshRenderer);
            supportMesh.geometry = supportGeometryResult.supportTree.toGeometryBase();
            supportMesh.material = new LitMaterial();
            supportMesh.material.doubleSide = true;
            this.view.scene.addChild(this.supportObj);
        }

        if (true) {
            this.supportPoint = new Object3D();
            let supportMesh = this.supportPoint.addComponent(MeshRenderer);
            supportMesh.geometry = supportGeometryResult.supportPoint.toGeometryBase();

            let mat = new UnLitMaterial();
            mat.baseColor = new Color(1, 0, 0);
            supportMesh.material = mat;

            supportMesh.material.doubleSide = true;
            this.view.scene.addChild(this.supportPoint);
        }

        if (false) {
            this.supportFaces = new Object3D();
            let supportMesh = this.supportFaces.addComponent(MeshRenderer);
            supportMesh.geometry = supportGeometryResult.supportFaces.toGeometryBase();

            let mat = new LitMaterial();
            mat.baseColor = new Color(0, 1, 0);
            supportMesh.material = mat;

            supportMesh.material.doubleSide = true;
            this.view.scene.addChild(this.supportFaces);
        }


        // supportMesh.geometry = supportGeometry;
        // this.scene.add(supportMesh);
        // this.supportsGenerated = true;
    }

    private getOctree() {
        if (!this.octree)
            this.octree = new Octree(this.baseMesh);
        return this.octree;
    }
}
