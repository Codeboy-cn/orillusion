import { Engine3D, Scene3D, CameraUtil, View3D, AtmosphericComponent, ComponentBase, Time, AxisObject, Object3DUtil, KelvinUtil, DirectLight, Object3D, HoverCameraController, MeshRenderer, LitMaterial, BoxGeometry, UnLit, UnLitMaterial, Interpolator, VertexAttributeName, GeometryBase, Color, Vector3, GPUPrimitiveTopology, FlyCameraController, GPUCullMode, BoundingBox, RenderNode, Matrix4 } from "@orillusion/core";
import { GUIHelp } from "@orillusion/debug/GUIHelp";
import { SupportGenerator } from "./SupportGenerator/SupportGenerator";
import { Octree } from "./SupportGenerator/Octree";
import { Mesh } from "./SupportGenerator/Geometry";

export class Sample_Test {
    view: View3D;

    protected supportGenerator: SupportGenerator;

    async run() {
        // init engine
        await Engine3D.init();

        GUIHelp.init();

        // create new Scene
        let scene = new Scene3D();

        // add atmospheric sky
        let sky = scene.addComponent(AtmosphericComponent)
        sky.sunY = 0.6;

        // init camera3D
        let mainCamera = CameraUtil.createCamera3D(null, scene);
        mainCamera.perspective(60, Engine3D.aspect, 0.01, 1000.0);
        let hoverCameraController = mainCamera.object3D.addComponent(FlyCameraController);
        // hoverCameraController.setCamera(15, -30, 100);
        GUIHelp.add(mainCamera, "near", 0.001, 200, 0.01);
        GUIHelp.add(mainCamera, "far", 0.001, 1000, 0.01);

        // add a basic direct light
        let lightObj = new Object3D();
        lightObj.rotationX = 45;
        lightObj.rotationY = 60;
        lightObj.rotationZ = 150;
        let dirLight = lightObj.addComponent(DirectLight);
        dirLight.lightColor = KelvinUtil.color_temperature_to_rgb(5355);
        dirLight.intensity = 20;
        scene.addChild(lightObj);
        sky.relativeTransform = dirLight.transform;

        // create a view with target scene and camera
        this.view = new View3D();
        this.view.scene = scene;
        this.view.camera = mainCamera;

        // start render
        Engine3D.startRenderView(this.view);

        await this.test();
    }

    private async test() {
        let rawGeometry: GeometryBase;

        this.view.graphic3D.drawAxis('axis');

        {
            let obj = await Engine3D.res.loadSTL('stls/No_bottom_thick2.5.stl') as Object3D;
            let mr = obj.getComponentsInChild(MeshRenderer)[0];
            rawGeometry = mr.geometry;
            // mr.material.doubleSide = true;
            // mr.material.cullMode = GPUCullMode.back;
            mr.material.baseColor = new Color(1.0, 1.0, 1.0);
            // this.view.scene.addChild(obj);

            if (true) {
                let mesh = new Mesh(mr);

                obj.x = 50;
                obj.y = 20; // mesh.geometry.bounds.max.y;

                let meshObj = new Object3D();
                meshObj.localPosition = mesh.matrixWorld.position;
                let mr2 = meshObj.addComponent(MeshRenderer);
                mr2.geometry = mesh.geometry.toGeometryBase();
                mr2.material = new LitMaterial();
                mr2.material.baseColor = new Color(0.0, 0.9, 1.0);
                this.view.scene.addChild(meshObj);

                let params = {
                    angle: 45,
                    axis: 'y',
                    layerHeight: 0.1,
                    radius: 0.4,
                    radiusFn: SupportGenerator.RadiusFunctions_sqrt,
                    radiusFnK: 0.01,
                    resolution: 2.4000000000000004,
                    subdivs: 16,
                    taperFactor: 0.25,
                };

                let support = GUIHelp.addFolder('Support');
                support.add(params, 'layerHeight', 0.01, 10);
                support.add(params, 'resolution', 0.1, 10);
                support.add(params, 'taperFactor', 0.1, 1);
                support.add(params, 'angle', 30, 90);
                support.add(params, 'subdivs', 2, 64);
                support.add(params, 'radius', 0.01, 10);
                GUIHelp.addButton('Generate', () => {
                    this.generateSupports(mesh, params);
                });
                GUIHelp.addButton('Remove', () => {
                    this.removeSupports();
                });
                support.open();
            }

            // obj = obj.clone();
            // mr = obj.getComponentsInChild(MeshRenderer)[0];
            // mr.material = new LitMaterial();
            // mr.material.cullMode = GPUCullMode.front;
            // mr.material.baseColor = new Color(0.3, 0.0, 0.0);
            // this.view.scene.addChild(obj);
        }

        // if (false) {
        //     let obj2 = new Object3D();

        //     // obj2.x = anchorObj.x - 330 - 85;
        //     // obj2.y = anchorObj.y;
        //     // obj2.z = anchorObj.z;

        //     let mr = obj2.addComponent(MeshRenderer);
        //     mr.geometry = this.rebuildGeometry_voxel(rawGeometry, -1.5, 1);
        //     let litMat = new LitMaterial();
        //     litMat.baseColor = new Color(0.3, 0.3, 0.3);
        //     // litMat.doubleSide = true;
        //     mr.material = litMat;
        //     o.addChild(obj2);


        //     obj2 = obj2.clone();
        //     mr = obj2.getComponent(MeshRenderer);
        //     mr.material = new UnLitMaterial();
        //     mr.material.cullMode = GPUCullMode.front;
        //     mr.material.baseColor = new Color(0.3, 0.0, 0.0);
        //     // o.addChild(obj2);

        //     const graphic3D = Engine3D.views[0].graphic3D;
        //     // graphic3D.drawMeshWireframe("test", obj2MR.geometry, obj2.transform);
        // } else if (false) {
        //     let obj2 = new Object3D();

        //     let mr = obj2.addComponent(MeshRenderer);
        //     mr.geometry = this.rebuildGeometry(rawGeometry, 1.5, 1);
        //     let litMat = new LitMaterial();
        //     litMat.baseColor = new Color(0.3, 0.5, 0.6);
        //     // litMat.doubleSide = true;
        //     // mr.material.cullMode = GPUCullMode.back;
        //     mr.material = litMat;
        //     o.addChild(obj2);


        //     obj2 = obj2.clone();
        //     mr = obj2.getComponent(MeshRenderer);
        //     mr.material = new UnLitMaterial();
        //     mr.material.cullMode = GPUCullMode.front;
        //     mr.material.baseColor = new Color(0.3, 0.0, 0.0);
        //     // o.addChild(obj2);

        //     const graphic3D = Engine3D.views[0].graphic3D;
        //     // graphic3D.drawMeshWireframe("test", obj2MR.geometry, obj2.transform);
        // }
    }

    private octree: Octree;
    private baseMesh: Mesh;
    private supportObj: Object3D;
    private removeSupports() {
        if (this.supportObj) {
            this.supportObj.removeFromParent();
            this.supportObj = null;
        }
    }

    private generateSupports(mesh: Mesh, params) {
        this.removeSupports();
        this.baseMesh = mesh;

        if (!this.supportGenerator) {
            this.supportGenerator = new SupportGenerator(mesh, this.getOctree());
        }

        let supportGeometry = this.supportGenerator.Generate(params);

        if (!supportGeometry) return;

        // support geometry is generated in world space; put it in the base mesh's
        // object space so that they can be transformed with the same matrix
        let inverseMatrix = Matrix4.help_matrix_0.copyFrom(mesh.matrixWorld); inverseMatrix.invert();
        // supportGeometry.applyMatrix(inverseMatrix);

        this.supportObj = new Object3D();
        let supportMesh = this.supportObj.addComponent(MeshRenderer);
        supportMesh.geometry = supportGeometry.toGeometryBase();
        supportMesh.material = new LitMaterial();
        this.view.scene.addChild(this.supportObj);

        // supportMesh.geometry = supportGeometry;
        // this.scene.add(supportMesh);
        // this.supportsGenerated = true;
    }

    private getOctree() {
        if (!this.octree) this.octree = new Octree(this.baseMesh);

        return this.octree;
    }

    private rebuildGeometry_voxel(geometry: GeometryBase, thickness: number = 0, precision: number = 0.1): GeometryBase {
        console.warn('start rebuildGeometry_voxel');
        const indices = geometry.getAttribute(VertexAttributeName.indices).data;
        const vertexs = geometry.getAttribute(VertexAttributeName.position).data as Float32Array;
        const normals = geometry.getAttribute(VertexAttributeName.normal).data as Float32Array;

        let triangleNum = indices.length / 3;

        // 创建体素数据buffer
        const max = geometry.bounds.max;
        const min = geometry.bounds.min;
        const width = Math.floor(Math.abs(max.x - min.x) / precision);
        const height = Math.floor(Math.abs(max.y - min.y) / precision);
        const depth = Math.floor(Math.abs(max.z - min.z) / precision);
        const voxels = new Uint8Array(width * height * depth);

        let triangleAABB = new BoundingBox();

        console.warn(width, height, depth, voxels.length);

        // 遍历所有三角面，计算每个三角面与体素格的相交关系
        for (let i = 0; i < triangleNum; i++) {
            let index = i * 3;

            const i0 = indices[index + 0] * 3;
            const p0 = Vector3.HELP_0.set(vertexs[i0 + 0], vertexs[i0 + 1], vertexs[i0 + 2]);

            const i1 = indices[index + 1] * 3;
            const p1 = Vector3.HELP_1.set(vertexs[i1 + 0], vertexs[i1 + 1], vertexs[i1 + 2]);

            const i2 = indices[index + 2] * 3;
            const p2 = Vector3.HELP_2.set(vertexs[i2 + 0], vertexs[i2 + 1], vertexs[i2 + 2]);

            // 计算该三角面的AABB
            triangleAABB = this.calculateTriangleAABB(p0, p1, p2, triangleAABB);

            let voxelGrid = new BoundingBox();

            // 遍历该三角面涉及的体素区域
            for (let z = Math.floor(triangleAABB.min.z / precision); z < Math.floor(triangleAABB.max.z / precision); z += 1) {
                for (let y = Math.floor(triangleAABB.min.y / precision); y < Math.floor(triangleAABB.max.y / precision); y += 1) {
                    for (let x = Math.floor(triangleAABB.min.x / precision); x < Math.floor(triangleAABB.max.x / precision); x += 1) {
                        let voxelIndex = z * (width * height) + y * width + x;
                        if (voxelIndex < 0 || voxelIndex >= voxels.length) {
                            continue;
                        }

                        voxelGrid.setFromMinMax(
                            Vector3.HELP_5.set(x * precision, y * precision, z * precision),
                            Vector3.HELP_6.set((x + 1) * precision, (y + 1) * precision, (z + 1) * precision)
                        );

                        if (voxelGrid.intersectsTriangle(p0, p1, p2)) {
                            voxels[voxelIndex] = 1; // z + precision * 0.5;
                        }
                    }
                }
            }
        }

        console.warn('done');

        // 通过体素数据生成表面Mesh
        const maxCount = Math.min(voxels.length, 100000);
        triangleNum = 12 * maxCount;
        console.error(triangleNum * 3);
        let newIndices = new Uint32Array(triangleNum * 3);
        let newVertexs = new Float32Array(triangleNum * 3 * 3);
        let newNormals = new Float32Array(triangleNum * 3 * 3);
        let newIndex = 0;
        for (let i = 0; i < voxels.length && newIndex < maxCount; i++) {
            const x = i % width;
            const y = Math.floor(i / width) % height;
            const z = Math.floor(i / (width * height));

            if (voxels[i] != 0) {
                this.buildBox(newIndex, newIndices, newVertexs, newNormals, Vector3.HELP_0.set(
                    x * precision,
                    y * precision,
                    z * precision
                ), precision);
                newIndex += 36;
            }
        }

        // this.buildBox(0, newIndices, newVertexs, newNormals, Vector3.HELP_0.set(0, 0, 0), precision);


        let result = new GeometryBase();
        result.setAttribute(VertexAttributeName.position, newVertexs);
        result.setAttribute(VertexAttributeName.normal, newNormals);
        result.setIndices(newIndices);
        result.addSubGeometry({
            indexStart: 0,
            indexCount: newIndex,
            vertexStart: 0,
            vertexCount: 0,
            firstStart: 0,
            index: 0,
            topology: 0,
        });
        return result;
    }

    private buildBox(offset: number, newIndices: Uint32Array, newVertexs: Float32Array, newNormals: Float32Array, pos: Vector3, size: number) {
        size -= 0.1;
        pos.addXYZW(
            0.1, 0.1, 0.1, 0
        );

        let halfW = size / 2.0;
        let halfH = size / 2.0;
        let halfD = size / 2.0;

        let position_arr = new Float32Array([
            //up
            -halfW + pos.x, halfH + pos.y, halfD + pos.z,
            halfW + pos.x, halfH + pos.y, halfD + pos.z,
            halfW + pos.x, halfH + pos.y, -halfD + pos.z,
            -halfW + pos.x, halfH + pos.y, -halfD + pos.z,
            -halfW + pos.x, halfH + pos.y, halfD + pos.z,
            halfW + pos.x, halfH + pos.y, -halfD + pos.z,
            //buttom
            halfW + pos.x, -halfH + pos.y, halfD + pos.z,
            -halfW + pos.x, -halfH + pos.y, halfD + pos.z,
            -halfW + pos.x, -halfH + pos.y, -halfD + pos.z,
            halfW + pos.x, -halfH + pos.y, -halfD + pos.z,
            halfW + pos.x, -halfH + pos.y, halfD + pos.z,
            -halfW + pos.x, -halfH + pos.y, -halfD + pos.z,
            //left
            -halfW + pos.x, -halfH + pos.y, halfD + pos.z,
            -halfW + pos.x, halfH + pos.y, halfD + pos.z,
            -halfW + pos.x, halfH + pos.y, -halfD + pos.z,
            -halfW + pos.x, -halfH + pos.y, -halfD + pos.z,
            -halfW + pos.x, -halfH + pos.y, halfD + pos.z,
            -halfW + pos.x, halfH + pos.y, -halfD + pos.z,
            //right
            halfW + pos.x, halfH + pos.y, halfD + pos.z,
            halfW + pos.x, -halfH + pos.y, halfD + pos.z,
            halfW + pos.x, -halfH + pos.y, -halfD + pos.z,
            halfW + pos.x, halfH + pos.y, -halfD + pos.z,
            halfW + pos.x, halfH + pos.y, halfD + pos.z,
            halfW + pos.x, -halfH + pos.y, -halfD + pos.z,
            //front
            halfW + pos.x, halfH + pos.y, halfD + pos.z,
            -halfW + pos.x, halfH + pos.y, halfD + pos.z,
            -halfW + pos.x, -halfH + pos.y, halfD + pos.z,
            -halfW + pos.x, -halfH + pos.y, halfD + pos.z,
            halfW + pos.x, -halfH + pos.y, halfD + pos.z,
            halfW + pos.x, halfH + pos.y, halfD + pos.z,
            //back
            halfW + pos.x, -halfH + pos.y, -halfD + pos.z,
            -halfW + pos.x, -halfH + pos.y, -halfD + pos.z,
            -halfW + pos.x, halfH + pos.y, -halfD + pos.z,
            halfW + pos.x, halfH + pos.y, -halfD + pos.z,
            halfW + pos.x, -halfH + pos.y, -halfD + pos.z,
            -halfW + pos.x, halfH + pos.y, -halfD + pos.z,
        ]);

        let normal_arr = new Float32Array([
            //up
            0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0,

            //buttom
            0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0,

            //left
            -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0,

            //right
            1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0,

            //front
            0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1,

            //back
            0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1,
        ]);

        let indices_arr = [0, 2, 1, 3, 5, 4, 6, 8, 7, 9, 11, 10, 12, 14, 13, 15, 17, 16, 18, 20, 19, 21, 23, 22, 24, 26, 25, 27, 29, 28, 30, 32, 31, 33, 35, 34];
        for (let i = 0; i < 36; i++) {
            indices_arr[i] = offset + i;
        }

        let indicesData = new Uint32Array(indices_arr);

        newIndices.set(indicesData, offset);
        newVertexs.set(position_arr, offset * 3);
        newNormals.set(normal_arr, offset * 3);
    }

    private calculateTriangleAABB(p0: Vector3, p1: Vector3, p2: Vector3, target?: BoundingBox): BoundingBox {
        target = target || new BoundingBox();

        let minX = p2.x;
        if (p0.x <= p1.x && p0.x <= p2.x) {
            minX = p0.x;
        } else if (p1.x <= p2.x && p1.x <= p0.x) {
            minX = p1.x;
        }
        let minY = p2.y;
        if (p0.y <= p1.y && p0.y <= p2.y) {
            minY = p0.y;
        } else if (p1.y <= p2.y && p1.y <= p0.y) {
            minY = p1.y;
        }
        let minZ = p2.z;
        if (p0.z <= p1.z && p0.z <= p2.z) {
            minZ = p0.z;
        } else if (p1.z <= p2.z && p1.z <= p0.z) {
            minZ = p1.z;
        }

        let maxX = p2.x;
        if (p0.x >= p1.x && p0.x >= p2.x) {
            maxX = p0.x;
        } else if (p1.x >= p2.x && p1.x >= p0.x) {
            maxX = p1.x;
        }
        let maxY = p2.y;
        if (p0.y >= p1.y && p0.y >= p2.y) {
            maxY = p0.y;
        } else if (p1.y >= p2.y && p1.y >= p0.y) {
            maxY = p1.y;
        }
        let maxZ = p2.z;
        if (p0.z >= p1.z && p0.z >= p2.z) {
            maxZ = p0.z;
        } else if (p1.z >= p2.z && p1.z >= p0.z) {
            maxZ = p1.z;
        }

        target.setFromMinMax(
            Vector3.HELP_5.set(minX, minY, minZ),
            Vector3.HELP_6.set(maxX, maxY, maxZ),
        );
        return target;
    }

    private calculateZ(p1: Vector3, p2: Vector3, p3: Vector3, x: number, y: number): number {
        // 计算三角形的重心坐标
        const denominator = ((p2.y - p3.y) * (p1.x - p3.x) + (p3.x - p2.x) * (p1.y - p3.y));
        const u = ((p2.y - p3.y) * (x - p3.x) + (p3.x - p2.x) * (y - p3.y)) / denominator;
        const v = ((p3.y - p1.y) * (x - p3.x) + (p1.x - p3.x) * (y - p3.y)) / denominator;
        const w = 1 - u - v;
        // 使用重心坐标计算 z 值
        const z = u * p1.z + v * p2.z + w * p3.z;
        return z;
    }

    private rebuildGeometry(geometry: GeometryBase, thickness: number = 0, precision: number = 2): GeometryBase {
        const graphic3D = Engine3D.views[0].graphic3D;

        const indices = geometry.getAttribute(VertexAttributeName.indices).data;
        const vertexs = geometry.getAttribute(VertexAttributeName.position).data as Float32Array;
        const normals = geometry.getAttribute(VertexAttributeName.normal).data as Float32Array;

        const triangleNum = indices.length / 3;
        let newIndices = new Uint32Array(triangleNum * 3);
        let newVertexs = new Float32Array(triangleNum * 3 * 3);
        let newNormals = new Float32Array(triangleNum * 3 * 3);

        const max = geometry.bounds.max;
        const min = geometry.bounds.min;

        const maxLP = new Vector3(min.x - thickness, max.y, max.z);
        const minLP = new Vector3(min.x - thickness, min.y, min.z);
        console.warn(`minLP(${minLP.x}, ${minLP.y}, ${minLP.z})`);
        console.warn(`maxLP(${minLP.x}, ${minLP.y}, ${minLP.z})`);

        // 构建左平面裁剪深度图
        const minLPw = Math.floor(Math.abs(max.z - min.z) / precision);
        const minLPh = Math.floor(Math.abs(max.y - min.y) / precision);
        const minLPx = new Float32Array(minLPw * minLPh);
        minLPx.fill(maxLP.x);
        for (let i = 0; i < triangleNum; i++) {
            let index = i * 3;

            const i0 = indices[index + 0] * 3;
            const v0 = Vector3.HELP_0.set(vertexs[i0 + 0], vertexs[i0 + 1], vertexs[i0 + 2]);

            const i1 = indices[index + 0] * 3;
            const v1 = Vector3.HELP_1.set(vertexs[i1 + 0], vertexs[i1 + 1], vertexs[i1 + 2]);

            const i2 = indices[index + 0] * 3;
            const v2 = Vector3.HELP_2.set(vertexs[i2 + 0], vertexs[i2 + 1], vertexs[i2 + 2]);

            let minX = v2.z;
            if (v0.z <= v1.z && v0.z <= v2.z) {
                minX = v0.z;
            } else if (v1.z <= v2.z && v1.z <= v0.z) {
                minX = v1.z;
            }

            let maxX = v2.z;
            if (v0.z >= v1.z && v0.z >= v2.z) {
                maxX = v0.z;
            } else if (v1.z >= v2.z && v1.z >= v0.z) {
                maxX = v1.z;
            }
            maxX += precision;

            let minY = v2.y;
            if (v0.y <= v1.y && v0.y <= v2.y) {
                minY = v0.y;
            } else if (v1.y <= v2.y && v1.y <= v0.y) {
                minY = v1.y;
            }

            let maxY = v2.y;
            if (v0.y >= v1.y && v0.y >= v2.y) {
                maxY = v0.y;
            } else if (v1.y >= v2.y && v1.y >= v0.y) {
                maxY = v1.y;
            }
            maxY += precision;


            for (let y = minY; y < maxY; y += precision) {
                for (let x = minX; x < maxX; x += precision) {
                    let gridIndex = y * minLPw + x;


                    let depth = this.calculateZ(v0, v1, v2, x, y);

                    if (depth < minLPx[gridIndex]) {
                        minLPx[gridIndex] = depth;
                    }
                }
            }

            let gridX = v0.z / precision;
            let gridY = v0.y / precision;
            let gridIndex = gridY * minLPw + gridX;
            if (v0.x < minLPx[gridIndex]) {
                minLPx[gridIndex] = v0.x;
            }

            gridX = v1.z / precision;
            gridY = v1.y / precision;
            gridIndex = gridY * minLPw + gridX;
            if (v1.x < minLPx[gridIndex]) {
                minLPx[gridIndex] = v1.x;
            }

            gridX = v2.z / precision;
            gridY = v2.y / precision;
            gridIndex = gridY * minLPw + gridX;
            if (v2.x < minLPx[gridIndex]) {
                minLPx[gridIndex] = v2.x;
            }
        }



        let newIndex = 0;
        for (let i = 0; i < triangleNum; i++) {
            let index = i * 3;

            newIndices[index + 0] = index + 2;
            newIndices[index + 1] = index + 1;
            newIndices[index + 2] = index + 0;

            const i0 = indices[index + 0] * 3;
            // newIndices[index + 0] = i0;
            const n0 = Vector3.HELP_0.set(normals[i0 + 0], normals[i0 + 1], normals[i0 + 2]);
            newNormals[i0 + 0] = n0.x;
            newNormals[i0 + 1] = n0.y;
            newNormals[i0 + 2] = n0.z;
            n0.normalize(thickness);
            const v0 = Vector3.HELP_1.set(vertexs[i0 + 0], vertexs[i0 + 1], vertexs[i0 + 2]);
            v0.add(n0, v0);

            newVertexs[i0 + 0] = v0.x;
            newVertexs[i0 + 1] = v0.y;
            newVertexs[i0 + 2] = v0.z;

            if (v0.x < minLP.x) {
                newVertexs[i0 + 0] = minLP.x;
                newVertexs[i0 + 1] = v0.y;
                newVertexs[i0 + 2] = v0.z;
            }

            const i1 = indices[index + 1] * 3;
            // newIndices[index + 1] = i1;
            const n1 = Vector3.HELP_2.set(normals[i1 + 0], normals[i1 + 1], normals[i1 + 2]);
            newNormals[i1 + 0] = n1.x;
            newNormals[i1 + 1] = n1.y;
            newNormals[i1 + 2] = n1.z;
            n1.normalize(thickness);
            const v1 = Vector3.HELP_3.set(vertexs[i1 + 0], vertexs[i1 + 1], vertexs[i1 + 2]);
            v1.add(n1, v1);

            newVertexs[i1 + 0] = v1.x;
            newVertexs[i1 + 1] = v1.y;
            newVertexs[i1 + 2] = v1.z;

            if (v1.x < minLP.x) {
                newVertexs[i1 + 0] = minLP.x;
                newVertexs[i1 + 1] = v1.y;
                newVertexs[i1 + 2] = v1.z;
            }

            const i2 = indices[index + 2] * 3;
            // newIndices[index + 2] = i2;
            const n2 = Vector3.HELP_4.set(normals[i2 + 0], normals[i2 + 1], normals[i2 + 2]);
            newNormals[i2 + 0] = n2.x;
            newNormals[i2 + 1] = n2.y;
            newNormals[i2 + 2] = n2.z;
            n2.normalize(thickness);
            const v2 = Vector3.HELP_5.set(vertexs[i2 + 0], vertexs[i2 + 1], vertexs[i2 + 2]);
            v2.add(n2, v2);

            newVertexs[i2 + 0] = v2.x;
            newVertexs[i2 + 1] = v2.y;
            newVertexs[i2 + 2] = v2.z;

            if (v2.x < minLP.x) {
                newVertexs[i2 + 0] = minLP.x;
                newVertexs[i2 + 1] = v2.y;
                newVertexs[i2 + 2] = v2.z;
            }
        }

        let result = new GeometryBase();
        result.setAttribute(VertexAttributeName.position, newVertexs);
        result.setAttribute(VertexAttributeName.normal, newNormals);
        result.setIndices(newIndices);
        result.addSubGeometry({
            indexStart: 0,
            indexCount: newIndices.length,
            vertexStart: 0,
            vertexCount: 0,
            firstStart: 0,
            index: 0,
            topology: 0,
        });
        return result;
    }
}
