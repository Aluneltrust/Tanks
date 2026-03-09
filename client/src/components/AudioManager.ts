// ============================================================================
// AUDIO MANAGER — Preloads and plays game sound effects
// ============================================================================

type SoundName =
  | 'fire'
  | 'hit'
  | 'explosion'
  | 'miss'
  | 'move'
  | 'match'
  | 'victory'
  | 'defeat';

const SOUND_PATHS: Record<SoundName, string> = {
  fire: '/audio/fire.mp3',
  hit: '/audio/hit.mp3',
  explosion: '/audio/explosion.mp3',
  miss: '/audio/miss.mp3',
  move: '/audio/move.mp3',
  match: '/audio/match.mp3',
  victory: '/audio/victory.mp3',
  defeat: '/audio/defeat.mp3',
};

// Volume per sound (0–1)
const SOUND_VOLUMES: Partial<Record<SoundName, number>> = {
  fire: 0.7,
  hit: 0.6,
  explosion: 0.8,
  miss: 0.3,
  move: 0.2,
  match: 0.5,
  victory: 0.6,
  defeat: 0.5,
};

class AudioManager {
  private buffers = new Map<SoundName, AudioBuffer>();
  private ctx: AudioContext | null = null;
  private masterVolume = 0.6;
  private loaded = false;

  /** Call once after first user interaction (click/tap) to unlock audio. */
  async init(): Promise<void> {
    if (this.ctx) return;
    this.ctx = new AudioContext();

    const entries = Object.entries(SOUND_PATHS) as [SoundName, string][];
    await Promise.all(
      entries.map(async ([name, path]) => {
        try {
          const res = await fetch(path);
          if (!res.ok) {
            console.warn(`Audio not found: ${path}`);
            return;
          }
          const arrayBuf = await res.arrayBuffer();
          const audioBuf = await this.ctx!.decodeAudioData(arrayBuf);
          this.buffers.set(name, audioBuf);
        } catch {
          console.warn(`Failed to load audio: ${path}`);
        }
      }),
    );
    this.loaded = true;
  }

  /** Play a sound effect by name. */
  play(name: SoundName): void {
    if (!this.ctx || !this.loaded) return;
    const buffer = this.buffers.get(name);
    if (!buffer) return;

    // Resume context if suspended (browser autoplay policy)
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;

    const gain = this.ctx.createGain();
    gain.gain.value = this.masterVolume * (SOUND_VOLUMES[name] ?? 0.5);

    source.connect(gain);
    gain.connect(this.ctx.destination);
    source.start(0);
  }

  setVolume(vol: number): void {
    this.masterVolume = Math.max(0, Math.min(1, vol));
  }
}

export const audioManager = new AudioManager();
