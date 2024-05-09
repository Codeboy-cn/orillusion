export let Support_Cs: string = /*wgsl*/ `

    #include "GlobalUniform"

    struct SupportData {
      p0: vec2<f32>,
      p1: vec2<f32>,
      position: vec3<f32>,
      reserve: f32,
    };

    //@group(0) @binding(0) var<uniform> globalUniform: GlobalUniform;
    @group(0) @binding(1) var visibleMap : texture_2d<f32>;
    @group(0) @binding(2) var normalTexture : texture_2d<f32>;
    @group(0) @binding(3) var<storage, read_write> supportBuffer : array<SupportData>;

    var<private> PI:f32 = 3.1415926535;

    @compute @workgroup_size(1, 1, 1)
    fn CsMain( @builtin(workgroup_id) workgroup_id : vec3<u32> , @builtin(global_invocation_id) globalInvocation_id : vec3<u32>)
    {
      let aa = textureDimensions(visibleMap).xy;
      let bb = textureDimensions(normalTexture).xy;

      // let PI = 3.1415926535;
      let index: u32 = globalInvocation_id.x;
      let data: SupportData = supportBuffer[index];
      let p0: vec3<f32> = screenPosToSpacePosition(data.p0);
      let p1: vec3<f32> = screenPosToSpacePosition(data.p1);
      let angle = computeAngleWithHorizontalPlane(p0, p1);
      let threshold = 10 * (PI / 180.0);

      // supportBuffer[index].position = p0;
      // supportBuffer[index].reserve = 1;

      if (data.p0.x == data.p1.x && data.p0.y == data.p1.y) {
        supportBuffer[index].position = p0;
        supportBuffer[index].reserve = 10000;
      } else if (i32(p0.x) == 0 && i32(p0.y) == 0 && i32(p0.z) == 0) {
        supportBuffer[index].reserve = -1;
        // supportBuffer[index].position = vec3<f32>(data.p0.x, data.p0.y, 0);
      } else if (angle <= threshold) {
        supportBuffer[index].position = p0;
        supportBuffer[index].reserve = f32(angle * (180.0 / PI)); // 1;
      } else {
        supportBuffer[index].position = p0;
        supportBuffer[index].reserve = -f32(angle * (180.0 / PI));
      }

      // if (angle <= threshold) {
      //   supportBuffer[index].position = p0;
      //   // supportBuffer[index].reserve = 1;
      // } else {
      //   // supportBuffer[index].reserve = 0;
      // }

      // supportBuffer[index].reserve = f32(angle * (180.0 / PI));
    }

    fn screenPosToSpacePosition(screenPos: vec2<f32>) -> vec3<f32> {
      let texSize: vec2<u32> = textureDimensions(visibleMap).xy;
      var screenPoint = vec2<f32>(
        screenPos.x / globalUniform.windowWidth,
        screenPos.y / globalUniform.windowHeight
      );
      screenPoint.x = 1.0 - screenPoint.x;
      let coord: vec2<i32> = vec2<i32>(screenPoint * vec2<f32>(texSize.xy));
      let info = textureLoad(visibleMap, coord, 0);
      let position: vec3<f32> = info.xyz;
      return position;
    }

    fn computeAngleWithHorizontalPlane(p0: vec3<f32>, p1: vec3<f32>) -> f32 {
      let horizontalNormal = vec3<f32>(0.0, 1.0, 0.0);
      let v: vec3<f32> = p1 - p0;
      let dotProduct: f32 = dot(v, horizontalNormal);
      let lengthV: f32 = length(v);
      let cosTheta: f32 = dotProduct / lengthV;
      var angleRadians: f32 = acos(cosTheta);

      if (angleRadians < PI / 2) {
        return PI / 2 - angleRadians;
      }

      return angleRadians - PI / 2;

      // angleRadians = PI / 2 - angleRadians;
      // return angleRadians;

      // if (angleRadians > PI / 2){
      //   angleRadians = PI - angleRadians;
      // }
      // return angleRadians;
    }

    // fn computeAngleWithHorizontalPlane_Old(p0: vec3<f32>, p1: vec3<f32>) -> f32 {
    //   let horizontalNormal = vec3<f32>(0.0, 0.0, 1.0);
    //   let v: vec3<f32> = p1 - p0;
    //   let dotProduct: f32 = dot(v, horizontalNormal);
    //   let lengthV: f32 = length(v);
    //   let cosTheta: f32 = dotProduct / lengthV;
    //   var angleRadians: f32 = acos(cosTheta);
    //   if (angleRadians > PI / 2){
    //     angleRadians -= PI / 2;
    //   }
    //   return angleRadians;
    // }

`;
