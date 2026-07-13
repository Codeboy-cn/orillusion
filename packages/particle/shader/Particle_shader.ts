/**
 * @internal
 */
export let ParticleComputeShader = /* wgsl */ `
  #include "ParticleDataStruct"

  @group(0) @binding(0) var<storage, read> globalData: GlobalData;
  @group(0) @binding(1) var<storage, read_write> particles: array<ParticleData>;

  var<private> index: u32;
  var<private> countTime: f32;
  var<private> totalLifeTime: f32;
  var<private> lifeTime: f32;
  var<private> lifeOverTime: f32;
  var<private> visible: f32;
  var<private> localForce: vec4<f32>;

  @compute @workgroup_size(64)
  fn CsMain(@builtin(global_invocation_id) GlobalInvocationID: vec3<u32>) {
    index = GlobalInvocationID.x;

    // Dispatch is rounded up to the workgroup size; out-of-range threads
    // must not touch the particle buffer.
    if (index >= globalData.maxParticles) {
      return;
    }

    particleLife();

    var vPos: vec4<f32> = particles[index].vPos;
    // Scale the per-frame displacement by the speed-over-life factor
    // (interpolated between the two segments; defaults to 1.0).
    let speedScale: vec4<f32> = mix(globalData.overLife_speed[0], globalData.overLife_speed[1], lifeOverTime);
    vPos = vPos + (calculationForce(lifeTime) + gravity(lifeTime)) * speedScale;
    // vPos = vPos + calculationAngularVelocity(lifeTime);

    var vSpeed: vec3<f32> = normalize(vPos.xyz - particles[index].vPos.xyz);
    particles[index].vSpeed = vec4<f32>(vSpeed,1.0);
    particles[index].vPos = vPos;
    calculationOverLifeSize(lifeTime);
    calculationOverLifeColor(lifeTime);
    calculationOverLifeRotation(lifeTime);
    calculationTextureSheetAnim(lifeTime);

    local_rotVelocity(globalData.timeDelta);

    particles[index].vPos = calculationAngularVelocity(globalData.timeDelta);
  }

  fn resetForce() {
    localForce = particles[index].start_velocity + particles[index].start_acceleration;
    particles[index].vForce_Pos = localForce;
  }

  fn waitReset() {
    lifeTime = 0.0;
    visible = 0.0;
    resetForce();

    particles[index].vScale = particles[index].start_size;
    particles[index].vPos = particles[index].start_pos;
    particles[index].vRot = particles[index].start_rotation;

    const LocalSpace = 0;
    const WorldSpace = 1;
    if (globalData.simulatorSpace == WorldSpace) {
      particles[index].vPos += globalData.emitterPos;
    }
  }

  fn particleLife() {
    visible = 0.0;
    totalLifeTime = particles[index].start_time + particles[index].life_time;

    countTime = particles[index].particleLifeDuration;
    
    if (countTime > particles[index].start_time) {
      visible = 1.0 ;
      
      lifeTime = countTime - particles[index].start_time;
      if (countTime >= totalLifeTime) {
        if (countTime >= globalData.duration && u32(globalData.isLoop) == 1) {
          countTime = countTime % globalData.duration;
          // obj.worldPos;
        }
        waitReset();
      }
    } else {
      waitReset();
    }

    lifeOverTime = lifeTime / particles[index].life_time;
    particles[index].particleLifeDuration = countTime + globalData.timeDelta;
    particles[index].hide = visible;
  }

  fn gravity(time:f32) -> vec4<f32> {
    // Uniform-acceleration displacement: 0.5 * g * t^2 (matches the
    // force integrator below); the linear-in-time variant was a debug
    // leftover that made gravity fall short of a parabola.
    let t: f32 = time * time;
    return 0.5 * vec4<f32>(globalData.gravity, 1.0) * t * ( 1.0 - (globalData.spaceDamping * 0.002) );
  }

  fn calculationForce(time:f32) -> vec4<f32> {
    localForce = particles[index].vForce_Pos;
    localForce = localForce * ( 1.0 - (globalData.spaceDamping * 0.002) );

    particles[index].vForce_Pos = localForce;
    let t: f32 = time * time;
    return localForce * t;
  }

  fn calculationOverLifeSize(time:f32) {
    var vSize: vec4<f32> = mix(globalData.overLife_scale[0], globalData.overLife_scale[1], lifeOverTime);
    // The over-life curve is a scale factor; apply it on top of the
    // per-particle base size instead of replacing it.
    particles[index].vScale = particles[index].start_size * vSize;
  }

  fn local_rotVelocity(time:f32) {
    var rv = particles[index].start_rotVelocity * time;
    var av = 0.5 * particles[index].start_rotAcceleration * time * time;
    particles[index].vRot += rv + av;
  }

  fn local_rotAcceleration(time:f32) {
  }

  fn calculationOverLifeColor(time:f32) {
    var vColor: vec4<f32> = mix(globalData.overLife_colors[0], globalData.overLife_colors[1], lifeOverTime);
    particles[index].vColor = vColor;
  }

  fn calculationOverLifeRotation(time:f32) {
    var vRot: vec4<f32> = mix(globalData.overLife_rotations[0], globalData.overLife_rotations[1], lifeOverTime);
    particles[index].vRot = particles[index].start_rotation + vRot;
  }

  fn calculationTextureSheetAnim(time: f32) {
    particles[index].textureSheet_Frame = u32(lifeTime * globalData.textureSheet_PlayRate) % globalData.textureSheet_TotalClip;
    // particles[index].textureSheet_Frame += 1;
  }

  fn calculationAngularVelocity(time: f32) -> vec4<f32> {
    let angle: vec3<f32> = particles[index].start_angularVelocity.xyz * time;

    let rotationMatrix: mat3x3<f32> = mat3x3<f32>(
      vec3<f32>(1.0, 0.0, 0.0),
      vec3<f32>(0.0, cos(angle.x), sin(angle.x)),
      vec3<f32>(0.0, -sin(angle.x), cos(angle.x))
    ) * mat3x3<f32>(
      vec3<f32>(cos(angle.y), 0.0, -sin(angle.y)),
      vec3<f32>(0.0, 1.0, 0.0),
      vec3<f32>(sin(angle.y), 0.0, cos(angle.y))
    ) * mat3x3<f32>(
      vec3<f32>(cos(angle.z), sin(angle.z), 0.0),
      vec3<f32>(-sin(angle.z), cos(angle.z), 0.0),
      vec3<f32>(0.0, 0.0, 1.0)
    );

    let rotatedPosition: vec3<f32> = rotationMatrix * particles[index].vPos.xyz;

    return vec4<f32>(rotatedPosition, 1.0);
  }
`;
