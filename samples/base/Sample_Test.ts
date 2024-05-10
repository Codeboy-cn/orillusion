import { Engine3D, Scene3D, CameraUtil, View3D, AtmosphericComponent, ComponentBase, Time, AxisObject, Object3DUtil, KelvinUtil, DirectLight, Object3D, HoverCameraController, MeshRenderer, LitMaterial, BoxGeometry, UnLit, UnLitMaterial, Interpolator, VertexAttributeName, GeometryBase, Color, Vector3, GPUPrimitiveTopology, FlyCameraController, GPUCullMode, BoundingBox, RenderNode, Matrix4, PlaneGeometry, SphereGeometry, Camera3D, RendererBase, OcclusionSystem, ClusterLightingBuffer, PassType, VirtualTexture, webGPUContext, GPUTextureFormat, PostBase, ComputeShader, RendererPassState, WebGPUDescriptorCreator, ComputeGPUBuffer, GBufferFrame, RTFrame, GPUContext, RTDescriptor, EntityCollect, PostProcessingComponent, GlobalBindGroup } from "@orillusion/core";
import { GUIHelp } from "@orillusion/debug/GUIHelp";
import { SupportGenerator } from "./SupportGenerator/SupportGenerator";
import { Octree } from "./SupportGenerator/Octree";
import { Mesh } from "./SupportGenerator/Geometry";
import { DepthMaterial } from "./SupportGeneratorNew/DepthMaterial";
import { Support_Cs } from "./SupportGeneratorNew/Support_Cs";

class SupportCalculator extends PostBase {
    public state: string = 'init';
    public lineCount: number = 0;
    public supportCompute: ComputeShader;
    public supportBuffer: ComputeGPUBuffer;
    public rendererPassState: RendererPassState;
    public callback: Function;

    private createResource() {
        // let [w, h] = webGPUContext.presentationSize;
        // this.supportBuffer && this.supportBuffer.destroy();
        // this.supportBuffer = new ComputeGPUBuffer(this.heightTexture.width * this.heightTexture.height);
    }

    private createCompute() {
        this.supportCompute && this.supportCompute.destroy();
        this.supportCompute = new ComputeShader(Support_Cs);

        let rtFrame = GBufferFrame.getGBufferFrame("ColorPassGBuffer");
        this.supportCompute.setSamplerTexture('visibleMap', rtFrame.getPositionMap());
        this.supportCompute.setSamplerTexture('normalTexture', rtFrame.getNormalMap());
        this.supportCompute.setStorageBuffer('supportBuffer', this.supportBuffer);

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

                    this.supportBuffer.readBuffer(()=>{
                        this.state = 'complete';
                    });
                }
                break;
            case 'complete':
                {
                    let result = [];

                    for (let i = 0; i < this.lineCount; i++) {
                        const index = i * 8;

                        let x = this.supportBuffer.outFloat32Array[index + 4];
                        let y = this.supportBuffer.outFloat32Array[index + 5];
                        let z = this.supportBuffer.outFloat32Array[index + 6];

                        let reserve = this.supportBuffer.outFloat32Array[index + 7];

                        let data = {
                            x: x,
                            y: y,
                            z: z,
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

        let supportData = new Float32Array((2 + 2 + 3 + 1) * lines.length);
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            const p0 = line.p0;
            supportData[i * 8 + 0] = p0.x;
            supportData[i * 8 + 1] = p0.y;

            const p1 = line.p1;
            supportData[i * 8 + 2] = p1.x;
            supportData[i * 8 + 3] = p1.y;

            supportData[i * 8 + 4] = 0;
            supportData[i * 8 + 5] = 0;
            supportData[i * 8 + 6] = 0;

            supportData[i * 8 + 7] = 0;
        }

        this.supportBuffer && this.supportBuffer.destroy();
        this.supportBuffer = new ComputeGPUBuffer(supportData.length, supportData);

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

    protected peer: Window;// = window.opener || window.parent;
    protected supportCalculator: SupportCalculator;

    protected mainCanvas: HTMLCanvasElement;

    async run() {

        let canvas = document.createElement('canvas');
        document.body.appendChild(canvas);
        this.mainCanvas = canvas;

        // init engine
        await Engine3D.init({
            canvasConfig: {
                canvas: canvas,
                // alpha: true,
                // backgroundImage: 'logo/bg.webp',
            },
        });

        GUIHelp.init();

        // create new Scene
        let scene = new Scene3D();

        // add atmospheric sky
        let sky = scene.addComponent(AtmosphericComponent)
        sky.sunY = 0.6;
        // sky.enable = false;

        // init camera3D
        let mainCamera = CameraUtil.createCamera3D(null, scene);
        mainCamera.perspective(60, Engine3D.aspect, 0.01, 200.0);
        this.mainCamera = mainCamera;
        let hoverCameraController = mainCamera.object3D.addComponent(FlyCameraController);
        // hoverCameraController.setCamera(15, -30, 100);
        // GUIHelp.add(mainCamera, "near", 0.001, 200, 0.01);
        // GUIHelp.add(mainCamera, "far", 0.001, 1000, 0.01);

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

    private async test() {
        let rawGeometry: GeometryBase;

        // this.view.graphic3D.drawAxis('axis');

        {
            const res = 'stls/No_bottom_thick2.5.stl';
            // const res = 'stls/testA.stl';
            // const res = 'stls/0325/0325/抽壳/底部孤岛自适应.stl';

            let obj = await Engine3D.res.loadSTL(res) as Object3D;
            // let obj = new Object3D();
            // {
            //     let mr = obj.addComponent(MeshRenderer);
            //     mr.geometry = new BoxGeometry(25, 25, 25);
            //     // mr.geometry = new SphereGeometry(25 * 0.5, 64, 64);
            //     mr.material = new LitMaterial();
            // }

            let mr = obj.getComponentsInChild(MeshRenderer)[0];
            rawGeometry = mr.geometry;
            // mr.material.doubleSide = true;
            // mr.material.cullMode = GPUCullMode.back;
            mr.material.baseColor = new Color(1.0, 1.0, 1.0);
            // this.view.scene.addChild(obj);

            if (true) {
                let mesh = new Mesh(mr);

                // obj.rotationX = -90;

                obj.x = 50;
                obj.y = 20; // mesh.geometry.bounds.max.y;

                let meshObj = new Object3D();
                meshObj.rotationX = mesh.rawMesh.transform.rotationX;
                meshObj.localPosition = mesh.matrixWorld.position;

                let mainMaterial = new LitMaterial();
                mainMaterial.doubleSide = true;
                mainMaterial.baseColor = new Color(0.0, 0.9, 1.0);

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
                // mr2.material = depthMaterial;
                // this.myRenderer.setTarget(meshObj);
                // mr2.material = mainMaterial;

                if (false) {
                    let support = GUIHelp.addFolder('Shoot');
                    GUIHelp.addButton('Recover', () => {
                        this.view.camera = this.mainCamera;
                        // mr2.material = mainMaterial;
                    });
                    GUIHelp.addButton('ShootEdge', () => {
                        const min = meshObj.bound.min;
                        const max = meshObj.bound.max;
                        const rectWidth = max.x - min.x + 2;
                        const rectHeight = max.z - min.z + 2;
                        if (!this.orthoCamera) {
                            this.orthoCamera = CameraUtil.createCamera3D(null, this.view.scene);
                            let orthoCamera = this.orthoCamera;
                            orthoCamera.ortho(rectWidth, rectHeight, 0.01, 1000.0);
                            let pos = obj.transform.worldPosition.clone().addScaledVector(Vector3.DOWN, 50);
                            orthoCamera.lookAt(pos, obj.transform.worldPosition, Vector3.Z_AXIS);
                        }
                        this.view.camera = this.orthoCamera;

                        mr2.material = mainMaterial;
                    });
                    GUIHelp.addButton('ShootDepth', () => {
                        const min = meshObj.bound.min;
                        const max = meshObj.bound.max;
                        const rectWidth = max.x - min.x + 2;
                        const rectHeight = max.z - min.z + 2;
                        console.warn(min.y, max.y);
                        if (!this.orthoCamera) {
                            this.orthoCamera = CameraUtil.createCamera3D(null, this.view.scene);
                            let orthoCamera = this.orthoCamera;
                            orthoCamera.ortho(rectWidth, rectHeight, 0.01, 1000.0);
                            let pos = obj.transform.worldPosition.clone().addScaledVector(Vector3.DOWN, 50);
                            orthoCamera.lookAt(pos, obj.transform.worldPosition, Vector3.Z_AXIS);
                        }
                        this.view.camera = this.orthoCamera;

                        mr2.material = depthMaterial;
                    });
                    support.open();
                }

                if (true) {
                    const min = meshObj.bound.min;
                    const max = meshObj.bound.max;
                    const rectWidth = max.x - min.x + 2;
                    const rectHeight = max.z - min.z + 2;
                    console.warn(`RectWidth:${rectWidth}, RectHeight:${rectHeight}`);
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
                        BorderStep: 10,
                        BorderOffSize: 5,
                        KernelStep: 5,
                        ContourStep: 50,
                    }

                    let support = GUIHelp.addFolder('Support');
                    support.add(params, 'BorderStep', 1, 100);
                    support.add(params, 'BorderOffSize', 1, 5);
                    // support.add(params, 'KernelStep', 1, 100);
                    support.add(params, 'ContourStep', 1, 200);
                    GUIHelp.addButton('Generate', async () => {
                        supportPoint.removeAllChild();

                        params.KernelStep = Math.floor(params.ContourStep / 10);

                        this.mainCanvas.removeAttribute('style');

                        this.view.camera = this.orthoCamera;

                        mr2.material = depthMaterial;

                        let lines = await new Promise<{ p0: { x: number; y: number; }; p1: { x: number; y: number; }; }[]>(res => {
                            let iframe = document.createElement('iframe');
                            iframe.src = '/support.html';
                            iframe.setAttribute('style', 'position:fixed; top:0; left:100%; width: 1000px; height: 100%;');
                            document.body.appendChild(iframe);
                            this.peer = iframe.contentWindow;
                            iframe.contentWindow.addEventListener('message', async (event) => {
                                if (event.data.id === 'ready') {
                                    console.warn('3D:recv ready.');
        
                                    const scaleFactor = 10;
                                    let width = Math.floor(rectWidth * scaleFactor);
                                    let height = Math.floor(rectHeight * scaleFactor);
                                    this.mainCanvas.width = width;
                                    this.mainCanvas.height = height;
                                    console.warn('Canvas:', width, height);
        
                                    await new Promise(res=>{
                                        setTimeout(() => {
                                           res(true);
                                        }, 100);
                                    })
        
                                    var imageDataURL = this.mainCanvas.toDataURL('image/png');
    
                                    mr2.material = bottomEdgeMaterial;
    
                                    event.source.postMessage({
                                        id: 'reqLines',
                                        imageData: imageDataURL,
                                        // data: {
                                        //     rectWidth: rectWidth,
                                        //     rectHeight: rectHeight,
                                        //     scaleFactor: scaleFactor,
                                        // },
                                        params: params,
                                    });
        
                                    return;
                                }
        
                                if (event.data.id === 'resLines') {
                                    console.warn('recv: lines');
                                    // iframe.remove();
                                    res(event.data.lines);
                                    return;
                                }
                            });
                        })
    
                        let borderPoints = await new Promise<number[][]>(res => {
                            let iframe = document.createElement('iframe');
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
                                    // iframe.remove();
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
                        for (let line of lines) {
                            let remove = false;
                            for (let p of borderPoints) {
                                const x = p[0]; const y = p[1];
                                let d = dis(line.p0.x, line.p0.y, x, y);
                                if (d <= maxDis) {
                                    remove = true;
                                    break;
                                }
                            }
    
                            if (!remove){
                                newLines.push(line);
                            }
                        }
    
                        // console.warn('lines:', lines);
                        // console.warn('newLines:', newLines);
    
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
    
                        this.supportCalculator.calculateSupport(newLines, (points)=> {
                            let geo = new SphereGeometry(0.2, 8, 8);
                            let mat = new UnLitMaterial();
                            let removeMat = new UnLitMaterial();
                            removeMat.baseColor = new Color(1, 1, 0);
    
                            let centerMat = new UnLitMaterial();
                            centerMat.baseColor = new Color(0, 1, 1);
    
                            mat.baseColor = new Color(1, 0, 0);
                            for (let pos of points) {
                                let obj = new Object3D();
                                let mr = obj.addComponent(MeshRenderer);
                                mr.geometry = geo;
                                // mr.material = pos.reserve ? mat : removeMat;
    
                                if (pos.reserve == 10000) {
                                    mr.material = centerMat;
                                } else if (pos.reserve >= 0) {
                                    mr.material = mat;
                                } else {
                                    mr.material = removeMat;
                                }
    
                                obj.x = pos.x;
                                obj.y = pos.y;
                                obj.z = pos.z;
                                supportPoint.addChild(obj);
    
                                // console.warn(pos.x, pos.y, pos.z);
                            }
    
                            let pos = obj.transform.worldPosition.clone().addScaledVector(Vector3.DOWN, 100);
                            this.mainCamera.lookAt(pos, obj.transform.worldPosition, Vector3.Z_AXIS);
    
                            this.view.camera = this.mainCamera;
                            // this.mainCanvas.style.width = '100%';
                            // this.mainCanvas.style.height = '100%';
                        });
                    });
                    GUIHelp.addButton('Remove', () => {
                        supportPoint.removeAllChild();
                    });
                    GUIHelp.addButton('MainCamera', () => {
                        this.view.camera = this.mainCamera;
                    });
                    support.open();


                }

                // let params = {
                //     angle: 45,
                //     axis: 'y',
                //     layerHeight: 0.1,
                //     radius: 0.4,
                //     radiusFn: SupportGenerator.RadiusFunctions_sqrt,
                //     radiusFnK: 0.01,
                //     resolution: 2.4000000000000004,
                //     subdivs: 16,
                //     taperFactor: 0.25,

                //     spacingFactor: 24,
                // };

                // let support = GUIHelp.addFolder('Support');
                // support.add(params, 'layerHeight', 0.01, 10);
                // support.add(params, 'resolution', 0.1, 10);
                // support.add(params, 'taperFactor', 0.1, 1);
                // support.add(params, 'angle', 0, 89);
                // support.add(params, 'subdivs', 2, 64);
                // support.add(params, 'radius', 0.01, 1);
                // GUIHelp.addButton('Generate', () => {
                //     this.generateSupports(mesh, params);
                // });
                // GUIHelp.addButton('Remove', () => {
                //     this.removeSupports();
                // });
                // support.open();

                // const lineWidth = 0.1;
                // // const spacingFactor = 24;
                // params.spacingFactor = 50;
                // params.angle = 45;
                // params.resolution = lineWidth * params.spacingFactor;
                // params.radius = 0.4;
                // params.taperFactor = 0.25;
                // params.subdivs = 16;
                // params.radiusFn = SupportGenerator.RadiusFunctions_sqrt;
                // params.radiusFnK = 0.01;

                // params.angle = 45;
                // params.radius = 1;
                // params.subdivs = 4;
                // params.resolution = 5;

                // let support = GUIHelp.addFolder('Support');
                // support.add(params, 'spacingFactor', 1, 100).name('Spacing Factor');
                // // support.add(params, 'resolution', 1, 20).name('Space');
                // support.add(params, 'taperFactor', 0.1, 10).name('CuspSize');
                // support.add(params, 'subdivs', 2, 64).name('PoleSubdivs');
                // support.add(params, 'radius', 0.1, 10).name('PoleSize');
                // GUIHelp.addButton('Generate', () => {
                //     params.resolution = lineWidth * params.spacingFactor;
                //     this.generateSupports(mesh, params);
                // });
                // GUIHelp.addButton('Remove', () => {
                //     this.removeSupports();
                // });
                // support.open();
            }

            // obj = obj.clone();
            // mr = obj.getComponentsInChild(MeshRenderer)[0];
            // mr.material = new LitMaterial();
            // mr.material.cullMode = GPUCullMode.front;
            // mr.material.baseColor = new Color(0.3, 0.0, 0.0);
            // this.view.scene.addChild(obj);
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

    private generateSupports(mesh: Mesh, params) {
        this.removeSupports();
        this.baseMesh = mesh;

        if (!this.supportGenerator) {
            this.supportGenerator = new SupportGenerator(mesh, this.getOctree());
        }

        let supportGeometryResult = this.supportGenerator.Generate(params);

        if (!supportGeometryResult) return;

        // support geometry is generated in world space; put it in the base mesh's
        // object space so that they can be transformed with the same matrix
        let inverseMatrix = Matrix4.help_matrix_0.copyFrom(mesh.matrixWorld); inverseMatrix.invert();
        // supportGeometry.applyMatrix(inverseMatrix);

        if (false) {
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

        if (true) {
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
