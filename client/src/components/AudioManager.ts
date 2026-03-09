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
  | 'defeat'
  | 'engine_idle';

const SOUND_PATHS: Record<SoundName, string> = {
  fire: '/audio/fire.mp3',
  hit: '/audio/hit.mp3',
  explosion: '/audio/explosion.mp3',
  miss: '/audio/miss.mp3',
  move: '/audio/move.mp3',
  match: '/audio/match.mp3',
  victory: '/audio/victory.mp3',
  defeat: '/audio/defeat.mp3',
  engine_idle: '/audio/engine-idle.mp3',
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
  engine_idle: 0.15,
};

class AudioManager {
  private buffers = new Map<SoundName, AudioBuffer>();
  private ctx: AudioContext | null = null;
  private masterVolume = 0.6;
  private loaded = false;
  private loopSource: AudioBufferSourceNode | null = null;
  private loopGain: GainNode | null = null;
  private loopName: SoundName | null = null;

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

  /** Start a looping sound (e.g. engine idle). Only one loop at a time. */
  startLoop(name: SoundName): void {
    if (!this.ctx || !this.loaded) return;
    if (this.loopName === name) return; // already playing
    this.stopLoop();

    const buffer = this.buffers.get(name);
    if (!buffer) return;

    if (this.ctx.state === 'suspended') this.ctx.resume();

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;

    const gain = this.ctx.createGain();
    gain.gain.value = 0; // start silent
    // Fade in
    gain.gain.linearRampToValueAtTime(
      this.masterVolume * (SOUND_VOLUMES[name] ?? 0.15),
      this.ctx.currentTime + 0.5,
    );

    source.connect(gain);
    gain.connect(this.ctx.destination);
    source.start(0);

    this.loopSource = source;
    this.loopGain = gain;
    this.loopName = name;
  }

  /** Stop the current looping sound with a short fade out. */
  stopLoop(): void {
    if (!this.ctx || !this.loopSource || !this.loopGain) return;
    const gain = this.loopGain;
    const source = this.loopSource;

    // Fade out over 0.4s then stop
    gain.gain.setValueAtTime(gain.gain.value, this.ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 0.4);
    setTimeout(() => {
      try { source.stop(); } catch { /* already stopped */ }
    }, 500);

    this.loopSource = null;
    this.loopGain = null;
    this.loopName = null;
  }

  setVolume(vol: number): void {
    this.masterVolume = Math.max(0, Math.min(1, vol));
    // Update loop volume if playing
    if (this.loopGain && this.loopName && this.ctx) {
      this.loopGain.gain.setValueAtTime(
        this.masterVolume * (SOUND_VOLUMES[this.loopName] ?? 0.15),
        this.ctx.currentTime,
      );
    }
  }
}

export const audioManager = new AudioManager();
