// ============================================================================
// ASSET LOADER — Load PNG assets with fallback colors
// ============================================================================

export interface GameAssets {
  sky: HTMLImageElement | null;
  mountainsFar: HTMLImageElement | null;
  mountainsMid: HTMLImageElement | null;
  hillsNear: HTMLImageElement | null;
  tank1Body: HTMLImageElement | null;
  tank1Turret: HTMLImageElement | null;
  tank2Body: HTMLImageElement | null;
  tank2Turret: HTMLImageElement | null;
  loaded: boolean;
}

const ASSET_PATHS: Record<string, string> = {
  sky: '/assets/sky.png',
  mountainsFar: '/assets/mountains-far.png',
  mountainsMid: '/assets/mountains-mid.png',
  hillsNear: '/assets/hills-near.png',
  tank1Body: '/assets/tank1-body.png',
  tank1Turret: '/assets/tank1-turret.png',
  tank2Body: '/assets/tank2-body.png',
  tank2Turret: '/assets/tank2-turret.png',
};

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => {
      console.warn(`Asset not found: ${src} — using fallback`);
      resolve(null);
    };
    img.src = src;
  });
}

let cachedAssets: GameAssets | null = null;

export async function loadGameAssets(): Promise<GameAssets> {
  if (cachedAssets) return cachedAssets;

  const [sky, mountainsFar, mountainsMid, hillsNear, tank1Body, tank1Turret, tank2Body, tank2Turret] =
    await Promise.all([
      loadImage(ASSET_PATHS.sky),
      loadImage(ASSET_PATHS.mountainsFar),
      loadImage(ASSET_PATHS.mountainsMid),
      loadImage(ASSET_PATHS.hillsNear),
      loadImage(ASSET_PATHS.tank1Body),
      loadImage(ASSET_PATHS.tank1Turret),
      loadImage(ASSET_PATHS.tank2Body),
      loadImage(ASSET_PATHS.tank2Turret),
    ]);

  cachedAssets = {
    sky, mountainsFar, mountainsMid, hillsNear,
    tank1Body, tank1Turret, tank2Body, tank2Turret,
    loaded: true,
  };
  return cachedAssets;
}