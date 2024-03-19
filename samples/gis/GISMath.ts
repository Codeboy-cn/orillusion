import { Camera3D, Color, DEGREES_TO_RADIANS, Engine3D, Graphic3D, Matrix4, RADIANS_TO_DEGREES, Ray, Vector2, Vector3, rad2Deg, sin } from "@orillusion/core";
import { TileData } from "./EarthTileRenderer";

export class GISPostion {
    public lng: number;
    public lat: number;
    constructor(longitude: number, latitude: number) {
        this.lng = longitude;
        this.lat = latitude;
    }

    public ToMercatorPos(): MercatorPos {
        return null;
    }
}

export class MercatorPos {
    public x: number;
    public y: number;
    constructor(x: number, y: number) {
        this.x = x;
        this.y = y;
    }

    public ToGISPostion(): GISPostion {
        return null;
    }
}

export class GISMath {
    public static readonly EarthRadius = 6378137.0;
    public static readonly EarthPerimeter = 2 * Math.PI * GISMath.EarthRadius;
    public static readonly EPSG3857_MAX_BOUND = this.EarthPerimeter;
    // public static readonly EPSG3857_MAX_BOUND = 20037508.34;
    public static readonly INV_POLE_BY_180 = 180 / GISMath.EPSG3857_MAX_BOUND;
    public static readonly PI_BY_POLE = Math.PI / GISMath.EPSG3857_MAX_BOUND;
    public static readonly PID2 = Math.PI * 0.5;
    public static readonly PIX2 = Math.PI * 2;
    public static readonly RAD = 180 / Math.PI;
    public static readonly RADB2 = GISMath.RAD * 2;
    public static readonly PID360 = Math.PI / 360;
    public static readonly INV_PI_BY_180_HALF_PI = GISMath.RAD * GISMath.PID2;

    public static readonly PolarRadius = 6356752.314245;
    public static readonly MinLatitude = -85.05112878;
    public static readonly MaxLatitude = 85.05112878;
    public static readonly MinLongitude = -180;
    public static readonly MaxLongitude = 180;
    public static readonly Size = 360;
    public static readonly TileSize = 256;

    public static readonly Max_Div_Min = this.EarthRadius / this.PolarRadius;
    public static readonly Min_Div_Max = this.PolarRadius / this.EarthRadius;

    public static SurfacePosToLngLat(position: Vector3): [number, number] {
        if (Math.abs(position.x) <= 0.01 && Math.abs(position.z) <= 0.01) {
            return [0, position.y > 0 ? 90 : -90];
        }
        let surface = position.clone().normalize();
        let xz = new Vector2(surface.x, surface.z);
        xz.normalize();
        let jd = rad2Deg(Math.atan2(xz.y, xz.x)) - 180;
        if (jd < 0) jd = -jd;
        let surface2 = surface.clone();
        surface2.y = 0;
        surface2.normalize();

        let wd = surface2.dotProduct(surface);
        wd = rad2Deg(Math.acos(wd));

        if (position.y < 0) wd *= -1;
        return [jd, wd];
    }

    private static UP: Vector3 = Vector3.UP;
    private static FORWARD: Vector3 = Vector3.FORWARD;

    public static LngLatToPolarEarthSurface(lng: number, lat: number, ret?: Vector3): Vector3 {
        ret ||= new Vector3();

        if (lat >= 90) {
            ret.copyFrom(this.UP);
        } else if (lat <= -90) {
            ret.copyFrom(this.UP).negate();
        } else {
            lng = DEGREES_TO_RADIANS * lng - 90 * DEGREES_TO_RADIANS;
            lat = DEGREES_TO_RADIANS * lat;

            ret.copyFrom(this.FORWARD);
            ret.y = Math.tan(lat);
            ret.normalize();

            let mat = Matrix4.helpMatrix.makeRotationAxis(this.UP, lng);
            mat.transformVector(ret, ret);
        }


        //sphere to polar surface
        ret = this.CalcPolarSurface(ret, new Vector3());
        return ret;
    }


    public static CalcPolarSurface(position: Vector3, ret: Vector3): Vector3 {
        position.normalize();
        const sphereY = position.y;
        ret.copyFrom(position);
        if (Math.abs(sphereY) >= 1 - 1e-12) {
            ret.multiplyScalar(this.PolarRadius);
            return ret;
        }
        if (Math.abs(sphereY) < 1e-12) {
            ret.y = sphereY * this.Min_Div_Max;
            ret.multiplyScalar(this.EarthRadius);
            return ret;
        }

        //sphere to polar surface
        const xzLength = Vector2.HELP_0.set(ret.x, ret.z).length();
        const tanAngle = sphereY / xzLength;

        let scale = 1.0 / (tanAngle * tanAngle) + this.Max_Div_Min * this.Max_Div_Min;
        scale = 1 / Math.sqrt(scale);
        scale = scale / Math.abs(sphereY);
        scale = this.EarthRadius * scale;
        ret.multiplyScalar(scale);
        return ret;
    }


    //cameraDistanceToEarthSurface
    public static getLevel(list: number[], distanceToSurface: number, scale: number = 0.1): number {
        let area = distanceToSurface * scale;

        for (let level = 0, count = list.length; level < count; level++) {
            if (area < list[level])
                return level > 0 ? level - 1 : 0;
        }
        return 0;
    }

    public static getLevel2(list: number[], distanceToSurface: number, scale: number = 0.1): number {
        const FOV = 60;
        const distance = distanceToSurface * scale;
        let resolution = distance * Math.tan(FOV / 2 * DEGREES_TO_RADIANS);
        let level = 0;
        for (; level < list.length; level++) {
            if (resolution <= list[level]) {
                level = level > 0 ? level - 1 : 0;
                break;
            }
        }
        // console.warn(`resolution:${resolution}, level:${level}`);
        return level;
    }


    private static help1Vec3: Vector3 = new Vector3();
    private static help2Vec3: Vector3 = new Vector3();
    private static help3Vec3: Vector3 = new Vector3();
    private static help4Vec3: Vector3 = new Vector3();
    private static help5Vec3: Vector3 = new Vector3();

    public static HitPolarSurface(ray: Ray): Vector3 {
        let earthRaius: number = this.EarthRadius;
        //scale ray
        ray.origin.y *= this.Max_Div_Min;
        ray.direction.y *= this.Max_Div_Min;
        ray.direction.normalize();

        let toCenter = this.help2Vec3.copyFrom(ray.origin);
        let toCenterLen = toCenter.length;
        toCenter.normalize().negate();
        let cosValue = ray.direction.dotProduct(toCenter);
        let angle = Math.acos(cosValue);
        let crossPointLen = Math.sin(angle) * toCenterLen;
        if (crossPointLen >= earthRaius)
            return null;
        let up = ray.direction.crossProduct(toCenter, this.help3Vec3).normalize();
        let right = ray.direction.crossProduct(up, this.help4Vec3);
        let crossPoint = this.help5Vec3.copyFrom(right).multiplyScalar(crossPointLen);
        let sinValue = crossPointLen / earthRaius;
        let edgeLength = Math.sqrt(1 - sinValue * sinValue) * earthRaius;
        let ret = crossPoint.add(ray.direction.clone().multiplyScalar(-edgeLength));

        ret.y *= this.Min_Div_Max;
        return ret;
    }


    public static CameraToLngLat(roll: number, pitch: number, result: Vector2 = new Vector2()): Vector2 {
        let lat = -pitch;
        let lng = (roll / 180 * Math.PI + (Math.PI / 2)) % this.PIX2;
        if (lng < 0) {
            lng += this.PIX2;
        }
        lng *= 180 / Math.PI;
        if (lng > 180) {
            lng -= 360
        }
        result.set(lng, lat);
        return result;
    }

    public static GetTileXY(lng: number, lat: number, levelZ: number): Vector2 {
        return new Vector2();
    }

    public static Test_getResolution(levelZ: number): number {
        const tileNums = Math.pow(2, levelZ);
        const tileTotalPixel = tileNums * GISMath.TileSize;
        return GISMath.EarthPerimeter / tileTotalPixel;
    }

    public static LngLatToMercator(lng: number, lat: number, result: Vector2 = new Vector2()): Vector2 {
        let x = lng * DEGREES_TO_RADIANS * GISMath.EarthRadius;
        let rad = lat * DEGREES_TO_RADIANS;
        let sin = Math.sin(rad);
        let y = GISMath.EarthRadius / 2 * Math.log((1 + sin) / (1 - sin));
        result.set(x, y);
        return result;
    }

    public static getResolution(levelZ: number): number {
        const tileNums = Math.pow(2, levelZ);
        const tileTotalPixel = tileNums * GISMath.TileSize;
        return GISMath.EarthPerimeter / tileTotalPixel;
    }

    public static MercatorToTileXY(mercatorX: number, mercatorY: number, levelZ: number, result: Vector2 = new Vector2()): Vector2 {
        mercatorX += this.EarthPerimeter / 2;
        mercatorY = this.EarthPerimeter / 2 - mercatorY;
        const resolution = this.getResolution(levelZ);
        let tileX = Math.floor(mercatorX / resolution / this.TileSize);
        let tileY = Math.floor(mercatorY / resolution / this.TileSize);
        result.set(tileX, tileY);
        return result;
    }

    public static MercatorToLngLat(x: number, y: number, result: Vector2 = new Vector2()): Vector2 {
        let lng = x * RADIANS_TO_DEGREES / GISMath.EarthRadius;
        let lat = (2 * Math.atan(Math.exp(y / GISMath.EarthRadius)) - (Math.PI / 2)) * RADIANS_TO_DEGREES;
        result.set(lng, lat);
        return result;
    }



    //------------------------------------------------------------------------------------------------------------------;

    public static spherify(e: number, t: number): Vector3 {
        const n = (90 - t) / 180 * Math.PI, r = e / 180 * Math.PI;
        let result = Vector3.HELP_0.set(Math.sin(n) * Math.cos(r), Math.cos(n), Math.sin(n) * Math.sin(r));
        this.CalcPolarSurface(result, this.help1Vec3);
        return result;
    }

    public static inverseWebMercator(x: number, z: number, y?: number): Vector3 {
        let result = Vector3.HELP_0;
        result.set(x * GISMath.INV_POLE_BY_180, y, GISMath.RADB2 * Math.atan(Math.exp(z * GISMath.PI_BY_POLE)) - GISMath.INV_PI_BY_180_HALF_PI);
        return result;
    }

    public static MapNumberToInterval(v0: number, minV0: number, maxV0: number, minV1: number, maxV1: number) {
        return (v0 - minV0) * (maxV1 - minV1) / (maxV0 - minV0) + minV1;
    }

    private static Levels = [];
    public static GetLevels(): number[] {
        if (this.Levels.length === 0) {
            for (let z = 0; z < 20; z++) {
                const tileNums = Math.pow(2, z);
                const tileTotalPixel = tileNums * GISMath.TileSize;
                this.Levels.push(tileTotalPixel);
            }
        }
        return this.Levels;
    }


    public static GetBestLevelResolution(t: number, i: number) {
        const n = window.devicePixelRatio * i;
        const r = Math.tan(t / 50 * 0.5);

        let levels = this.GetLevels();

        let level = 0;
        for (level = 0; level < levels.length; level++) {
            if (r * levels[level] >= n) {
                // console.error(`${r}, ${levels[level]}, ${r * levels[level]} > ${n}, ${level}`);
                break;
            }
        }
        return level - 1;
    }

    public static CameraToLatlong(beta: number, alpha: number) {
        let n = -alpha;
        let r = (beta / 180 * Math.PI + (Math.PI / 2)) % this.PIX2;
        r < 0 && (r += this.PIX2);
        r *= 180 / Math.PI;
        r > 180 && (r -= 360);
        return new Vector2(n, r);
    }

    public static LatLongToPixelXY(latitude: number, longitude: number, levelOfDetail: number) {
        latitude = this.Clamp(latitude, this.MinLatitude, this.MaxLatitude);
        longitude = this.Clamp(longitude, this.MinLongitude, this.MaxLongitude);

        let x = (longitude + 180) / 360;
        let sinLatitude = Math.sin(latitude * Math.PI / 180);
        let y = 0.5 - Math.log((1 + sinLatitude) / (1 - sinLatitude)) / (4 * Math.PI);

        let mapSize = this.MapSize(levelOfDetail);
        let pixelX = this.Clamp(x * mapSize + 0.5, 0, mapSize - 1);
        let pixelY = this.Clamp(y * mapSize + 0.5, 0, mapSize - 1);
        return new Vector2(pixelX, pixelY);
    }

    public static Clamp(n: number, minValue: number, maxValue: number) {
        return Math.min(Math.max(n, minValue), maxValue);
    }

    public static MapSize(levelOfDetail: number) {
        return 256 << levelOfDetail;
    }

    public static PixelXYToTileXY(pixelX: number, pixelY: number) {
        let tileX = Math.floor(pixelX / 256);
        let tileY = Math.floor(pixelY / 256);
        return new Vector2(tileX, tileY)
    }

    public static PixelToWorldPos(pixelX: number, pixelY: number, level: number): Vector3 {
        let l = 0;
        let u = 0;
        let h = 180;
        let d = 360;
        for (let i = 0; i < level; i++) {
            h /= 2;
            d /= 2;
            l += h;
            u += d;
        }
        const f = -l, p = l;

        const offsetX = -(u + f - pixelX);
        const offsetY = p - pixelY;

        let x = offsetX;
        let y = 0;
        let z = -offsetY;

        x = this.MapNumberToInterval(x, -this.EPSG3857_MAX_BOUND, this.EPSG3857_MAX_BOUND, this.MinLongitude, this.MaxLongitude);
        z = this.MapNumberToInterval(z, -this.EPSG3857_MAX_BOUND, this.EPSG3857_MAX_BOUND, this.MinLongitude, this.MaxLongitude)

        let o = this.inverseWebMercator(x, z)
        let s = this.spherify(o.x, o.z)
        return new Vector3(-s.x, -s.y, s.z);
    }

    public static GetTileIndexVertexPosition(t: TileData, index: number, result?: Vector3): Vector3 {
        result = result || new Vector3();

        const segmentW = 8;
        const segmentH = 8;
        const width = t.tileSize;
        const height = t.tileSize;

        let xi = index % (segmentW + 1);
        let yi = Math.floor(index / (segmentW + 1));
        // console.warn(xi, yi);

        let x = (xi / segmentW - 0.5) * width;
        let y = 0;
        let z = (yi / segmentH - 0.5) * height;

        x = x + t.offsetX;
        y = 0;
        z = z - t.offsetY;

        const PI = Math.PI;
        const PolarRadius = 6356752.314245;
        const EarthRadius = 6378137.0;
        const EarthPerimeter = 2.0 * PI * EarthRadius;
        const EPSG3857_MAX_BOUND = EarthPerimeter; // 20037508.34;
        const INV_POLE_BY_180 = 180.0 / EPSG3857_MAX_BOUND;
        const PI_BY_POLE = PI / EPSG3857_MAX_BOUND;
        const PID2 = PI * 0.5;
        const RAD = 180.0 / PI;
        const RADB2 = RAD * 2;
        const INV_PI_BY_180_HALF_PI = RAD * PID2;
        const MinLongitude = -180;
        const MaxLongitude = 180;
        const Min_Div_Max = 6356752.314245 / 6378137.0;
        const Max_Div_Min = 6378137.0 / 6356752.314245;

        function mapNumberToInterval(value: number): number {
            let minBound: number = -EPSG3857_MAX_BOUND;
            let maxBound: number = EPSG3857_MAX_BOUND;
            return (value - MinLongitude) * (maxBound - minBound) / (MaxLongitude - MinLongitude) + minBound;
        }

        function inverseWebMercator(x: number, z: number, result?: Vector3): Vector3 {
            result = result || new Vector3();
            return result.set(
                x * INV_POLE_BY_180,
                0,
                RADB2 * Math.atan(Math.exp(z * PI_BY_POLE)) - INV_PI_BY_180_HALF_PI
            );
        }

        function spherify(e: number, t: number, h: number, result?: Vector3): Vector3 {
            let n: number = (90.0 - t) / 180.0 * PI;
            let r: number = e / 180.0 * PI;
            let p = new Vector3(
                Math.sin(n) * Math.cos(r),
                Math.cos(n),
                Math.sin(n) * Math.sin(r)
            );
            return CalcPolarSurface(p, h, result);
        }

        function CalcPolarSurface(position: Vector3, h: number, result?: Vector3): Vector3 {
            result = result || new Vector3();
            result.copyFrom(position);
            let sphereY = position.y;
            if (Math.abs(sphereY) >= 0.999999999) {
                result.multiplyScalar(PolarRadius + h);
                return result;
            }
            if (Math.abs(sphereY) < 0.0000000001) {
                result.y = sphereY * Min_Div_Max;
                result.multiplyScalar(EarthRadius + h);
                return result;
            }

            //sphere to polar surface
            Vector3.HELP_0.set(result.x, result.z, 0);
            let xzLength = Vector3.HELP_0.length; // length(vec2f(result.x, result.z));
            let tanAngle = sphereY / xzLength;

            var scale = 1.0 / (tanAngle * tanAngle) + Max_Div_Min * Max_Div_Min;
            scale = 1.0 / Math.sqrt(scale);
            scale = scale / Math.abs(sphereY);
            scale = (EarthRadius + h * 20) * scale;
            result.multiplyScalar(scale);
            return result;
        }

        // console.warn(`Pos(${x},${y},${z})`);

        x = mapNumberToInterval(x);
        z = mapNumberToInterval(z);

        // console.warn(`Pos(${x},${y},${z})`);

        let o: Vector3 = inverseWebMercator(x, z);

        // console.warn(`Pos(${o.x},${o.y},${o.z})`);

        let s: Vector3 = spherify(o.x, o.z, 0);

        // console.warn(`Pos(${s.x},${s.y},${s.z})`);

        result.set(-s.x, -s.y, s.z);

        // console.warn(`Pos(${result.x},${result.y},${result.z})`);

        return result;
    }

    public static IsInCameraVisible(camera: Camera3D, t: TileData): boolean {
        let segmentW = 8;
        let segmentH = 8;

        let posLT = this.GetTileIndexVertexPosition(t, 0 * (segmentW + 1) + 0);
        let posRT = this.GetTileIndexVertexPosition(t, 0 * (segmentW + 1) + 8);
        let posLB = this.GetTileIndexVertexPosition(t, 8 * (segmentW + 1) + 0);
        let posRB = this.GetTileIndexVertexPosition(t, 8 * (segmentW + 1) + 8);

        let isVisibleLT = camera.frustum.containsPoint(posLT);
        let isVisibleRT = camera.frustum.containsPoint(posRT);
        let isVisibleLB = camera.frustum.containsPoint(posLB);
        let isVisibleRB = camera.frustum.containsPoint(posRB);

        // enable debug draw
        if (true) {
            let uuid = `${t.tileX}-${t.tileY}-${t.tileZoom}`;
            if (!isVisibleLT) {
                Engine3D.views[0].graphic3D.drawFillCircle("posLT" + uuid, posLT, 500, 16, Vector3.Z_AXIS, new Color(1, 0, 0));
            }
            if (!isVisibleRT) {
                Engine3D.views[0].graphic3D.drawFillCircle("posRT" + uuid, posRT, 500, 16, Vector3.Z_AXIS, new Color(0, 1, 0));
            }
            if (!isVisibleLB) {
                Engine3D.views[0].graphic3D.drawFillCircle("posLB" + uuid, posLB, 500, 16, Vector3.Z_AXIS, new Color(0, 0, 1));
            }
            if (!isVisibleRB) {
                Engine3D.views[0].graphic3D.drawFillCircle("posRB" + uuid, posRB, 500, 16, Vector3.Z_AXIS, new Color(1, 1, 0));
            }
            // Engine3D.views[0].graphic3D.drawBox("posLT" + uuid, posLT, posRB);
        }

        return isVisibleLT || isVisibleRT || isVisibleLB || isVisibleRB;
    }

    public static ComputeVisibleTiles(camera: Camera3D, tileX: number, tileY: number, level: number, rangeAera: number, enableFrustumCulling: boolean): TileData[] {
        let tileArr: TileData[] = [];
        const tileTotal = Math.pow(2, level);
        const tileSize = this.Size / tileTotal;

        let l = 0;
        let u = 0;
        let h = 180;
        let d = 360;
        for (let i = 0; i < level; i++) {
            h /= 2;
            d /= 2;
            l += h;
            u += d;
        }
        const f = -l, p = l;

        // rangeAera -= 1;
        // rangeAera = Math.min(Math.floor(rangeAera/2), tileTotal/2);
        // if (rangeAera % 2 != 0) {
        //     rangeAera += 1;
        // }
        rangeAera += 1;
        rangeAera = Math.min(rangeAera, tileTotal);
        // rangeAera = Math.floor(rangeAera / 2);

        // console.warn(`${tileX}, ${tileY}, ${rangeAera}`);

        // const offsetX = -(u + f - tileX * tileSize);
        // const offsetY = p - tileY * tileSize;
        // let tile = new TileData(offsetX, offsetY, tileSize);
        // tile.tileX = tileX;
        // tile.tileY = tileY;
        // tile.tileZoom = level;
        // tileArr.push(tile);
        // console.log(`tile(${tileX}, ${tileY})`);

        for (let aera = 0; aera < rangeAera; aera++) {
            let minY = tileY - aera;
            let maxY = tileY + aera;
            for (let y = minY; y <= maxY; y++) {
                let yi = y;
                if (yi < 0) {
                    yi = tileTotal + yi;
                } else if (yi >= tileTotal) {
                    yi %= tileTotal;
                }

                let minX = tileX - aera;
                let maxX = tileX + aera;
                for (let x = minX; x <= maxX; x++) {
                    let xi = x;
                    if (xi < 0) {
                        xi = tileTotal + xi;
                    } else if (xi >= tileTotal) {
                        xi %= tileTotal;
                    }

                    if (aera > 0 && y <= maxY - 1 && y >= minY + 1 && x <= maxX - 1 && x >= minX + 1) {
                        continue;
                    }

                    const offsetX = -(u + f - xi * tileSize);
                    const offsetY = p - yi * tileSize;
                    let tile = new TileData(offsetX, offsetY, tileSize);
                    tile.tileX = xi;
                    tile.tileY = yi;
                    tile.tileZoom = level;

                    if (!enableFrustumCulling || this.IsInCameraVisible(camera, tile)) {
                        tileArr.push(tile);
                        // console.warn(`视锥可见的Tile(${xi}, ${yi})`);
                    } else {
                        // console.error(`视锥剔除的Tile(${xi}, ${yi})`);
                    }
                }
            }
        }

        // for (let yr = tileY - rangeAera; yr < tileY + rangeAera; yr++) {
        //     let yi = yr;
        //     if (yi < 0) {
        //         yi = tileTotal + yi;
        //     } else if (yi >= tileTotal) {
        //         yi %= tileTotal;
        //     }
        //     for (let xr = tileX - rangeAera; xr < tileX + rangeAera; xr++) {
        //         let xi = xr;
        //         if (xi < 0) {
        //             xi = tileTotal + xi;
        //         } else if (xi >= tileTotal) {
        //             xi %= tileTotal;
        //         }
        //         const offsetX = -(u + f - xi * tileSize);
        //         const offsetY = p - yi * tileSize;
        //         let tile = new TileData(offsetX, offsetY, tileSize);
        //         tile.tileX = xi;
        //         tile.tileY = yi;
        //         tile.tileZoom = level;
        //         tileArr.push(tile);
        //         // console.log(`tile(${xi}, ${yi})`);
        //     }
        // }
        return tileArr;
    }

    public static ComputeVisibleTiles_old(tileX: number, tileY: number, level: number, rangeAera: number, center: boolean): TileData[] {
        if (center) {
            let v = Math.floor(rangeAera / 2);
            tileX -= v;
            tileY -= v - 1;
        }

        let tileArr: TileData[] = [];
        const tileTotal = Math.pow(2, level);
        const tileSize = this.Size / tileTotal;

        let l = 0;
        let u = 0;
        let h = 180;
        let d = 360;
        for (let i = 0; i < level; i++) {
            h /= 2;
            d /= 2;
            l += h;
            u += d;
        }
        const f = -l, p = l;

        console.warn(`${tileX}, ${tileY}, ${rangeAera}`);

        if (tileY < 0) {
            tileY = 0;
        } else if (tileY >= tileTotal) {
            tileY = tileTotal - 1;
        }

        for (let y = tileY; y < tileY + rangeAera; y++) {
            // if (y < 0 || y >= tileTotal)
            //     continue;
            let yi = y;
            if (yi < 0) {
                yi = 0;//tileTotal + yi;
            }
            if (yi >= tileTotal) {
                yi = tileTotal - 1; // yi - tileTotal;
            }
            for (let x = tileX; x < tileX + rangeAera; x++) {
                let xi = x;
                // if (x < 0 || x >= tileTotal)
                //     continue;
                if (xi < 0) {
                    xi = tileTotal + xi;
                }
                if (xi >= tileTotal) {
                    xi = xi - tileTotal;
                }
                const offsetX = -(u + f - xi * tileSize);
                const offsetY = p - yi * tileSize;
                let tile = new TileData(offsetX, offsetY, tileSize);
                tile.tileX = xi;
                tile.tileY = yi;
                tile.tileZoom = level;
                tileArr.push(tile);
                console.log(`tile(${xi}, ${yi})`);
            }
        }
        // console.log(tileArr, "tiles", tileSize);
        return tileArr;
    }
}
