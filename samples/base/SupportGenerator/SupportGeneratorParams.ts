
export class SupportGeneratorParams {
    public angle: number = 45;
    public resolution: number = 0.3;
    public layerHeight: number = 0.1;
    public radius: number = 0.1;
    public subdivs: number = 16;
    public taperFactor: number = 0.5;
    public radiusFn: any;
    public radiusFnK: number = 0.01;
    public axis: string = "z";
    public epsilon: number = 1e-5;
}
