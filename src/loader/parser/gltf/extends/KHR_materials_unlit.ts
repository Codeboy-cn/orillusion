//https://github.com/KhronosGroup/glTF/tree/main/extensions/2.0/Khronos/KHR_materials_unlit

/**
 * @internal
 * @group Loader
 */
export class KHR_materials_unlit {
    public static apply(gltf: any, dmaterial: any, tMaterial: any) {
        // TODO: GLTFSubParserConverter has no unlit path — it always
        // builds a LitMaterial and no material/shader field on it switches
        // lighting off (the engine's UnLitMaterial is a separate class the
        // converter would have to instantiate instead). The previous code
        // wrote a nonexistent `supportLight` property with inverted
        // polarity — a complete no-op that pretended support. Until the
        // converter can build an UnLitMaterial for this extension, do
        // nothing here.
    }
}
