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
  | 'engine_idle'
  | 'music_lobby'
  | 'music_battle';

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
  music_lobby: '/audio/lobby-music.mp3',
  music_battle: '/audio/battle-music.mp3',
};

// Target volume per sound (0–1), multiplied by masterVolume
const SOUND_VOLUMES: Record<SoundName, number> = {
  fire: 0.8,
  hit: 0.7,
  explosion: 0.9,
  miss: 0.35,
  move: 0.35,
  match: 0.5,
  victory: 0.7,
  defeat: 0.6,
  engine_idle: 0.2,
  music_lobby: 0.3,
  music_battle: 0.35,
};

interface LoopHandle {
  source: AudioBufferSourceNode;
  gain: GainNode;
}

class AudioManager {
  private buffers = new Map<SoundName, AudioBuffer>();
  private ctx: AudioContext | null = null;
  private masterVolume = 0.7;
  private musicVolume = 0.3;
  private loaded = false;
  private muted = false;

  // Named loops — supports multiple concurrent loops
  private loops = new Map<SoundName, LoopHandle>();

  /** Call once after first user interaction (click/tap) to unlock audio. */
  async init(): Promise<void> {
    if (this.ctx) return;
    this.ctx = new AudioContext();

    const entries = Object.entries(SOUND_PATHS) as [SoundName, string][];
    await Promise.all(
      entries.map(async ([name, path]) => {
        try {
          const res = await fetch(path);
          if (!res.ok) { console.warn(`Audio not found: ${path}`); return; }
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

  private ensureResumed(): boolean {
    if (!this.ctx || !this.loaded) return false;
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return true;
  }

  /** Play a one-shot sound effect. */
  play(name: SoundName): void {
    if (this.muted) return;
    if (!this.ensureResumed()) return;
    const buffer = this.buffers.get(name);
    if (!buffer) return;

    const source = this.ctx!.createBufferSource();
    source.buffer = buffer;
    const gain = this.ctx!.createGain();
    gain.gain.value = this.masterVolume * SOUND_VOLUMES[name];
    source.connect(gain);
    gain.connect(this.ctx!.destination);
    source.start(0);
  }

  /** Start a named looping sound. Fades in over fadeIn seconds. */
  startLoop(name: SoundName, fadeIn = 0.4): void {
    if (this.muted) return;
    if (!this.ensureResumed()) return;
    if (this.loops.has(name)) return; // already playing

    const buffer = this.buffers.get(name);
    if (!buffer) return;

    const source = this.ctx!.createBufferSource();
    source.buffer = buffer;
    source.loop = true;

    const gain = this.ctx!.createGain();
    const isMusic = name === 'music_lobby' || name === 'music_battle';
    const targetVol = isMusic ? this.musicVolume : this.masterVolume * SOUND_VOLUMES[name];
    gain.gain.setValueAtTime(0, this.ctx!.currentTime);
    gain.gain.linearRampToValueAtTime(targetVol, this.ctx!.currentTime + fadeIn);

    source.connect(gain);
    gain.connect(this.ctx!.destination);
    source.start(0);

    this.loops.set(name, { source, gain });
  }

  /** Stop a named loop with fade out. */
  stopLoop(name: SoundName, fadeOut = 0.3): void {
    const handle = this.loops.get(name);
    if (!handle || !this.ctx) return;

    this.loops.delete(name);
    const { source, gain } = handle;
    gain.gain.setValueAtTime(gain.gain.value, this.ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0, this.ctx.currentTime + fadeOut);
    setTimeout(() => { try { source.stop(); } catch { /* ok */ } }, (fadeOut + 0.1) * 1000);
  }

  /** Stop ALL loops (game over / leave). */
  stopAllLoops(fadeOut = 0.3): void {
    for (const name of [...this.loops.keys()]) {
      this.stopLoop(name, fadeOut);
    }
  }

  /** Crossfade: stop one loop and start another. */
  crossfade(from: SoundName, to: SoundName, duration = 0.3): void {
    this.stopLoop(from, duration);
    this.startLoop(to, duration);
  }

  isLoopPlaying(name: SoundName): boolean {
    return this.loops.has(name);
  }

  setVolume(vol: number): void {
    this.masterVolume = Math.max(0, Math.min(1, vol));
    if (!this.ctx) return;
    for (const [name, handle] of this.loops) {
      handle.gain.gain.setValueAtTime(
        this.masterVolume * SOUND_VOLUMES[name],
        this.ctx.currentTime,
      );
    }
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.muted) {
      this.stopAllLoops(0.3);
    }
    return this.muted;
  }

  isMuted(): boolean {
    return this.muted;
  }

  setMusicVolume(vol: number): void {
    this.musicVolume = Math.max(0, Math.min(0.4, vol));
    if (!this.ctx) return;
    // Update any currently playing music loops
    for (const name of ['music_lobby', 'music_battle'] as SoundName[]) {
      const handle = this.loops.get(name);
      if (handle) {
        handle.gain.gain.setValueAtTime(this.musicVolume, this.ctx.currentTime);
      }
    }
  }

  getMusicVolume(): number {
    return this.musicVolume;
  }
}

export const audioManager = new AudioManager();
