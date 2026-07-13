import { Vector4 } from "@orillusion/core";
import { ParticleGlobalMemory } from '../../buffer/ParticleGlobalMemory';
import { ParticleLocalMemory } from '../../buffer/ParticleLocalMemory';
import { ParticleModuleBase } from './ParticleModuleBase';

/**
 * Particle module of move speed over life time
 * @group Particle 
 */
export class ParticleOverLifeSpeedModule extends ParticleModuleBase {

    /**
    * Per-axis scale applied to the particle displacement, interpolated from
    * birth (segment 0) to end of life (segment 1). 1.0 keeps the original
    * speed; 0.0 stops the particle.
    */
    public speedSegments: Vector4[] = [new Vector4(1, 1, 1, 1), new Vector4(1, 1, 1, 1)];


    /**
     * Genarate particle move speed module with type over life time 
     * @param globalMemory
     * @param localMemory
     * 
     */
    public generateParticleModuleData(globalMemory: ParticleGlobalMemory, localMemory: ParticleLocalMemory) {
        globalMemory.setVector4Array(`overLife_speed`, this.speedSegments);
    }
}
