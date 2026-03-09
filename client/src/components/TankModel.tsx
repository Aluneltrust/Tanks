// ============================================================================
// TANK MODEL LOADER — GLB models with procedural fallback
// ============================================================================
import * as THREE from 'three';

// GLTFLoader inline (avoids import path issues with three/examples)
// We'll load it dynamically
let GLTFLoader: any = null;

async function getGLTFLoader() {
  if (GLTFLoader) return GLTFLoader;
  try {
    const module = await import('three/examples/jsm/loaders/GLTFLoader.js');
    GLTFLoader = module.GLTFLoader;
    return GLTFLoader;
  } catch {
    console.warn('GLTFLoader not available, using procedural tanks');
    return null;
  }
}

// Cache loaded models
const modelCache = new Map<string, THREE.Group>();

/**
 * Load a .glb tank model. Returns a cloned group with userData.barrelPivot
 * The model should have an object named "Barrel" or "Turret" for the pivot.
 */
export async function loadTankModel(
  url: string,
  tintColor?: number,
): Promise<THREE.Group | null> {
  const Loader = await getGLTFLoader();
  if (!Loader) return null;

  // Check cache
  const cacheKey = url;
  if (modelCache.has(cacheKey)) {
    const clone = modelCache.get(cacheKey)!.clone();
    if (tintColor !== undefined) tintModel(clone, tintColor);
    return clone;
  }

  return new Promise((resolve) => {
    const loader = new Loader();
    loader.load(
      url,
      (gltf: any) => {
        const model = gltf.scene;
        model.traverse((child: any) => {
          if (child.isMesh) {
            child.castShadow = false;
            child.receiveShadow = false;
          }
        });

        // Find barrel pivot — look for objects named Barrel, Gun, Turret_pivot, etc.
        let barrelPivot: THREE.Object3D | null = null;
        model.traverse((child: any) => {
          const name = child.name.toLowerCase();
          if (name.includes('barrel') || name.includes('gun_pivot') || name.includes('turret_rotate')) {
            barrelPivot = child;
          }
        });

        // If no named pivot found, create one at a reasonable position
        if (!barrelPivot) {
          barrelPivot = new THREE.Group();
          barrelPivot.name = 'barrelPivot';
          model.add(barrelPivot);
        }

        model.userData.barrelPivot = barrelPivot;
        modelCache.set(cacheKey, model.clone());

        if (tintColor !== undefined) tintModel(model, tintColor);
        resolve(model);
      },
      undefined,
      (err: any) => {
        console.warn(`Failed to load tank model: ${url}`, err);
        resolve(null);
      },
    );
  });
}

function tintModel(model: THREE.Group, color: number) {
  const tint = new THREE.Color(color);
  model.traverse((child: any) => {
    if (child.isMesh && child.material) {
      const mat = child.material.clone();
      mat.color.lerp(tint, 0.4);
      child.material = mat;
    }
  });
}

// ============================================================================
// PROCEDURAL FALLBACK — used when no .glb files available
// ============================================================================

export function makeProceduralTank(primary: number, secondary: number): THREE.Group {
  const tank = new THREE.Group();
  const m = (c: number, r = .55, met = .4) =>
    new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: met });

  const bodyMat = m(primary, .5, .45);
  const darkMat = m(secondary, .55, .4);
  const steelMat = m(0x7a7a80, .3, .85);
  const dkSteel = m(0x555558, .35, .7);
  const rubber = m(0x1c1c1c, .92, .05);

  // Hull
  const hull = new THREE.Mesh(new THREE.BoxGeometry(1.8, .55, 1.4), bodyMat);
  hull.position.y = .5; tank.add(hull);
  const glacis = new THREE.Mesh(new THREE.BoxGeometry(.5, .5, 1.38), darkMat);
  glacis.position.set(1.05, .48, 0); glacis.rotation.z = -.55; tank.add(glacis);

  // Tracks
  for (const z of [1, -1]) {
    const tb = new THREE.Mesh(new THREE.BoxGeometry(2.2, .35, .18), rubber);
    tb.position.set(0, .18, z * .62); tank.add(tb);
    for (let i = -2; i <= 2; i++) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(.16, .16, .14, 16), dkSteel);
      w.rotation.x = Math.PI / 2; w.position.set(i * .42, .18, z * .66); tank.add(w);
    }
    const sp = new THREE.Mesh(new THREE.CylinderGeometry(.2, .2, .14, 16), steelMat);
    sp.rotation.x = Math.PI / 2; sp.position.set(1.02, .2, z * .64); tank.add(sp);
    const id = new THREE.Mesh(new THREE.CylinderGeometry(.17, .17, .14, 16), steelMat);
    id.rotation.x = Math.PI / 2; id.position.set(-1.02, .2, z * .64); tank.add(id);
  }

  // Turret dome
  const tBase = new THREE.Mesh(new THREE.CylinderGeometry(.55, .6, .3, 20), bodyMat);
  tBase.position.y = .9; tank.add(tBase);
  const tDome = new THREE.Mesh(
    new THREE.SphereGeometry(.52, 20, 12, 0, Math.PI * 2, 0, Math.PI * .55), bodyMat);
  tDome.position.y = 1.0; tank.add(tDome);

  // Barrel pivot
  const bp = new THREE.Group();
  bp.position.set(.15, 1.0, 0); tank.add(bp);
  const gun = new THREE.Mesh(new THREE.CylinderGeometry(.065, .08, 2.4, 14), steelMat);
  gun.rotation.z = -Math.PI / 2; gun.position.x = 1.2; bp.add(gun);
  const muzzle = new THREE.Mesh(new THREE.CylinderGeometry(.12, .07, .2, 12), steelMat);
  muzzle.rotation.z = -Math.PI / 2; muzzle.position.x = 2.42; bp.add(muzzle);
  for (let i = 0; i < 4; i++) {
    const band = new THREE.Mesh(new THREE.CylinderGeometry(.09, .09, .06, 14), dkSteel);
    band.rotation.z = -Math.PI / 2; band.position.x = .4 + i * .45; bp.add(band);
  }

  // Antenna
  const ant = new THREE.Mesh(new THREE.CylinderGeometry(.005, .008, 1.6, 4), dkSteel);
  ant.position.set(-.35, 2.1, -.25); tank.add(ant);

  tank.userData.barrelPivot = bp;
  return tank;
}