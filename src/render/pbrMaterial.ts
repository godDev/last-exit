import * as THREE from 'three';

export type SurfaceKind = 'paint' | 'metal' | 'rubber' | 'plastic' | 'fabric' | 'glass' | 'asphalt';

const SURFACES: Record<SurfaceKind, { roughness: number; metalness: number }> = {
  paint: { roughness: 0.42, metalness: 0.08 },
  metal: { roughness: 0.28, metalness: 0.82 },
  rubber: { roughness: 0.92, metalness: 0 },
  plastic: { roughness: 0.68, metalness: 0 },
  fabric: { roughness: 1, metalness: 0 },
  glass: { roughness: 0.12, metalness: 0.05 },
  asphalt: { roughness: 0.88, metalness: 0.02 },
};

export interface PBRMaterialOptions {
  surface: SurfaceKind;
  color?: THREE.ColorRepresentation;
  map?: THREE.Texture | null;
  vertexColors?: boolean;
  roughness?: number;
  metalness?: number;
  emissive?: THREE.ColorRepresentation;
  emissiveIntensity?: number;
  transparent?: boolean;
  opacity?: number;
  side?: THREE.Side;
}

/** Shared material vocabulary for every asset introduced by the visual upgrade. */
export function createPBRMaterial(options: PBRMaterialOptions): THREE.MeshStandardMaterial {
  const defaults = SURFACES[options.surface];
  const material = new THREE.MeshStandardMaterial({
    name: `pbr-${options.surface}`,
    color: options.color ?? 0xffffff,
    map: options.map ?? null,
    vertexColors: options.vertexColors ?? false,
    roughness: options.roughness ?? defaults.roughness,
    metalness: options.metalness ?? defaults.metalness,
    emissive: options.emissive ?? 0x000000,
    emissiveIntensity: options.emissiveIntensity ?? 1,
    transparent: options.transparent ?? false,
    opacity: options.opacity ?? 1,
    side: options.side ?? THREE.FrontSide,
  });
  material.envMapIntensity = options.surface === 'metal' ? 0.85 : 0.35;
  return material;
}

export function enablePBRShadows(root: THREE.Object3D, receive = true): void {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    const transparent = materials.some((material) => material.transparent && material.opacity < 0.95);
    object.castShadow = !transparent;
    object.receiveShadow = receive && !transparent;
  });
}
