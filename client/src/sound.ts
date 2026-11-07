/**
 * Site audio. Off by default: in a lecture hall, a room of laptops all starting music at
 * once would be chaos, and browsers block audio before a user gesture anyway.
 *
 * The one on/off switch covers everything: music, ambience, UI sounds and game sounds.
 * - First visit: off. The page makes no sound.
 * - The toggle (setEnabled) saves the choice in the browser. Off fades music and ambience out over
 *   1.6 seconds and game and UI sounds stop at once. On starts them, inside the click.
 * - A saved "on" comes back on the next page, but stays silent until the first click or key press,
 *   because browsers refuse audio before that.
 * - Click to Play (enableForGame) turns sound on for this page if the browser never chose, without
 *   saving it. A saved "off" always stays off.
 */

export type SfxName = 'hover' | 'click' | 'confirm' | 'error' | 'gate' | 'ignite' | 'unlock' | 'page';
export type AmbienceName = 'wind' | 'fire';

/** A game sound, by its file name in /audio/sfx/game without the -1, -2 or -3 of its takes. */
export type GameSfxName = keyof typeof GAME_SFX;
export type FootSurface = 'dirt' | 'stone';

/** What a game sound can be told when it plays. */
export interface GameSoundOptions {
  /** World position. Leave these out for a sound that belongs to you, like your own hit. */
  x?: number;
  z?: number;
  /** 0 to 1, on top of the sound's own level. */
  volume?: number;
  /** Share of random pitch change. Defaults to each sound's own. */
  pitchVariance?: number;
  /** Dips and muffles the music and ambience for a moment, from 0 to 1. */
  duck?: number;
  /** Seconds to wait, for layered sounds. */
  delay?: number;
  /** Plays it slower and lower than recorded: 0.5 is an octave down. */
  pitch?: number;
}

export interface HitComboOptions {
  kill?: boolean;
  heavy?: boolean;
  material?: 'flesh' | 'metal';
  x?: number;
  z?: number;
}

const STORAGE_KEY = 'cse-souls.sound';
const VOLUME_KEY = 'cse-souls.volume';
const MUSIC_VOLUME = 0.38;
const AMBIENCE_VOLUME = 0.22;
const FADE_SECONDS = 1.6;

const SFX_VOLUME: Record<SfxName, number> = {
  hover: 0.1,
  click: 0.45,
  confirm: 0.5,
  error: 0.7,
  gate: 0.6,
  ignite: 0.6,
  unlock: 0.55,
  page: 0.5,
};

/*
 * Takes is how many numbered files exist. The files are all normalized to about the same peak, so
 * these gains are what make a footstep quieter than a killing blow.
 */
const GAME_SFX = {
  'swing-light': { takes: 3, gain: 0.5, pitch: 0.08 },
  'swing-heavy': { takes: 3, gain: 0.65, pitch: 0.06 },
  'wind-heavy': { takes: 1, gain: 0.55, pitch: 0.03 },
  'bow-draw': { takes: 1, gain: 0.45, pitch: 0.03 },
  'bow-release': { takes: 1, gain: 0.6, pitch: 0.05 },
  'arrow-hit': { takes: 3, gain: 0.7, pitch: 0.07 },
  'cast-magic': { takes: 3, gain: 0.5, pitch: 0.06 },
  'magic-impact': { takes: 3, gain: 0.7, pitch: 0.07 },
  'binary-glitch': { takes: 1, gain: 0.32, pitch: 0.1 },
  'hit-flesh': { takes: 3, gain: 0.75, pitch: 0.08 },
  'hit-metal': { takes: 3, gain: 0.6, pitch: 0.07 },
  'hit-heavy': { takes: 3, gain: 0.95, pitch: 0.05 },
  'hit-player': { takes: 3, gain: 0.8, pitch: 0.05 },
  'kill-sting': { takes: 1, gain: 0.72, pitch: 0.02 },
  'kill-thud': { takes: 1, gain: 1, pitch: 0.03 },
  'dodge-roll': { takes: 1, gain: 0.55, pitch: 0.06 },
  'footstep-dirt': { takes: 3, gain: 0.22, pitch: 0.1 },
  'footstep-stone': { takes: 3, gain: 0.26, pitch: 0.1 },
  'wolf-growl': { takes: 1, gain: 0.6, pitch: 0.06 },
  'wolf-attack': { takes: 1, gain: 0.7, pitch: 0.05 },
  'wolf-yelp': { takes: 1, gain: 0.65, pitch: 0.07 },
  'wolf-death': { takes: 1, gain: 0.7, pitch: 0.05 },
  'deer-call': { takes: 1, gain: 0.4, pitch: 0.06 },
  'deer-death': { takes: 1, gain: 0.65, pitch: 0.05 },
  'chest-open': { takes: 1, gain: 0.7, pitch: 0 },
  'loot-gold': { takes: 1, gain: 0.45, pitch: 0.04 },
  'dust-collect': { takes: 1, gain: 0.35, pitch: 0.05 },
  'player-death': { takes: 1, gain: 0.85, pitch: 0 },
  respawn: { takes: 1, gain: 0.65, pitch: 0 },
  'potion-drink': { takes: 1, gain: 0.65, pitch: 0 },
} as const;

/** Loaded on entering the game, since these are heard within a second or two of the first fight. */
const GAME_PRELOAD: readonly GameSfxName[] = [
  'swing-light', 'swing-heavy', 'hit-flesh', 'hit-heavy', 'hit-metal', 'kill-sting', 'kill-thud', 'dodge-roll', 'footstep-dirt',
  'dust-collect', 'magic-impact', 'cast-magic', 'arrow-hit', 'bow-release', 'hit-player', 'potion-drink', 'respawn',
  'wind-heavy', 'binary-glitch',
];

const MAX_VOICES = 24;
const MAX_VOICES_PER_SOUND = 4;
/** Same sound twice inside this gap is one sound, or it just gets louder and phasey. */
const RETRIGGER_SECONDS = 0.035;
/** Meters at which a positional sound starts to fall off, and where it is gone. */
const NEAR_METERS = 4;
const FAR_METERS = 42;
const DUCK_RECOVER_SECONDS = 1.1;

const PLAYLIST = ['/audio/music/night-vigil.mp3', '/audio/music/ancient-rite.mp3'];

type Listener = (enabled: boolean) => void;

class SoundEngine {
  private context: AudioContext | null = null;
  private music: HTMLAudioElement | null = null;
  private musicGain: GainNode | null = null;
  private ambienceGain: GainNode | null = null;
  private ambienceSource: AudioBufferSourceNode | null = null;
  private ambienceName: AmbienceName | null = null;
  private ambiencePlaying: AmbienceName | null = null;
  private trackIndex = 0;
  private buffers = new Map<string, Promise<AudioBuffer | null>>();
  private listeners = new Set<Listener>();
  private lastHoverAt = 0;
  private masterGain: GainNode | null = null;
  private backdropFilter: BiquadFilterNode | null = null;
  private backdropDuck: GainNode | null = null;
  private gameCompressor: DynamicsCompressorNode | null = null;
  private listenerX = 0;
  private listenerZ = 0;
  private listenerYaw = 0;
  private voices = 0;
  private readonly voicesPerSound = new Map<string, number>();
  private readonly lastPlayed = new Map<string, number>();
  private readonly lastTake = new Map<string, number>();
  private userVolume = readVolume();

  enabled = readChoice() === 'on';

  constructor() {
    // A remembered "on" still needs a gesture on the new page before audio may start.
    // Only until it runs. Doing this on every key press would restart the ambience loop each time.
    const resumeOnGesture = () => {
      if (this.enabled && this.context?.state !== 'running') this.start();
    };
    window.addEventListener('pointerdown', resumeOnGesture);
    window.addEventListener('keydown', resumeOnGesture);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    try {
      localStorage.setItem(STORAGE_KEY, enabled ? 'on' : 'off');
    } catch {
      // Private browsing can refuse storage. The choice still lasts for this page.
    }
    if (enabled) this.start();
    else this.silence();
    this.listeners.forEach((listener) => listener(enabled));
  }

  /** 0 to 1, saved in the browser. Applies to everything, UI and game alike. */
  get volume(): number {
    return this.userVolume;
  }

  setVolume(volume: number): void {
    this.userVolume = Math.min(1, Math.max(0, Number.isFinite(volume) ? volume : 1));
    try {
      localStorage.setItem(VOLUME_KEY, String(this.userVolume));
    } catch {
      // Private browsing can refuse storage. The choice still lasts for this page.
    }
    if (this.masterGain) this.masterGain.gain.value = this.userVolume;
  }

  /**
   * For the game's Click to Play: turns sound on if this browser never chose. A saved "off" stays
   * off. It isn't saved as "on", so the next visit to the site still starts quiet until the next
   * Click to Play. Must run inside the click, because browsers only start audio after a gesture.
   */
  enableForGame(): void {
    if (readChoice() === null && !this.enabled) {
      this.enabled = true;
      this.listeners.forEach((listener) => listener(true));
    }
    if (this.enabled) this.start();
    this.preloadGame();
  }

  /** Starts fetching the sounds a fight needs. Safe to call at any time and more than once. */
  preloadGame(names: readonly GameSfxName[] = GAME_PRELOAD): void {
    if (!this.context) return;
    for (const name of names) {
      for (let take = 1; take <= GAME_SFX[name].takes; take += 1) void this.loadBuffer(gameUrl(name, take));
    }
  }

  /** Where the ears are. Call once a frame with the camera's or player's position and yaw. */
  setListener(x: number, z: number, yaw: number): void {
    this.listenerX = x;
    this.listenerZ = z;
    this.listenerYaw = yaw;
  }

  /** Plays one game sound, picking a take at random (never the same one twice in a row). */
  playGame(name: GameSfxName, options: GameSoundOptions = {}): void {
    const context = this.context;
    if (!this.enabled || !context || context.state !== 'running' || !this.gameCompressor) return;
    const entry = GAME_SFX[name];

    let positional = 1;
    let pan = 0;
    if (options.x !== undefined && options.z !== undefined) {
      const dx = options.x - this.listenerX;
      const dz = options.z - this.listenerZ;
      const distance = Math.hypot(dx, dz);
      if (distance >= FAR_METERS) return;
      const beyond = Math.max(0, distance - NEAR_METERS) / (FAR_METERS - NEAR_METERS);
      positional = (1 - beyond) * (1 - beyond);
      // Yaw 0 looks along +z, the same as the game: see inMeleeArc in shared/combat.ts.
      if (distance > 0.5) {
        const right = (dx * Math.cos(this.listenerYaw) - dz * Math.sin(this.listenerYaw)) / distance;
        pan = -right * Math.min(1, distance / NEAR_METERS) * 0.8;
      }
    }

    const now = context.currentTime;
    const startAt = now + Math.max(0, options.delay ?? 0);
    const since = startAt - (this.lastPlayed.get(name) ?? -1);
    const running = this.voicesPerSound.get(name) ?? 0;
    if (since < RETRIGGER_SECONDS || running >= MAX_VOICES_PER_SOUND || this.voices >= MAX_VOICES) return;
    this.lastPlayed.set(name, startAt);

    let take = 1;
    if (entry.takes > 1) {
      take = 1 + Math.floor(Math.random() * (entry.takes - 1));
      if (take >= (this.lastTake.get(name) ?? 0)) take += 1;
      this.lastTake.set(name, take);
    }
    const level = entry.gain * positional * (options.volume ?? 1);
    if (level <= 0.002) return;
    const variance = options.pitchVariance ?? entry.pitch;
    const rate = (options.pitch ?? 1) * (1 + (Math.random() * 2 - 1) * variance);
    const requested = performance.now();

    this.voices += 1;
    this.voicesPerSound.set(name, running + 1);
    const release = () => {
      this.voices -= 1;
      this.voicesPerSound.set(name, (this.voicesPerSound.get(name) ?? 1) - 1);
    };

    void this.loadBuffer(gameUrl(name, take)).then((buffer) => {
      // Too late is worse than silent: a hit sound long after the hit reads as a bug.
      if (!buffer || !this.context || !this.enabled || !this.gameCompressor || performance.now() - requested > 180) {
        release();
        return;
      }
      const source = this.context.createBufferSource();
      source.buffer = buffer;
      source.playbackRate.value = rate;
      const gain = this.context.createGain();
      gain.gain.value = level;
      source.connect(gain);
      if (pan !== 0) {
        const panner = this.context.createStereoPanner();
        panner.pan.value = pan;
        gain.connect(panner).connect(this.gameCompressor);
      } else {
        gain.connect(this.gameCompressor);
      }
      source.onended = release;
      source.start(Math.max(this.context.currentTime, startAt));
    });

    if (options.duck) this.duckBackdrop(options.duck);
  }

  /**
   * The full sound of a blow landing. A kill layers the impact, a low thud and a sting, and muffles
   * the music for a breath, which is most of why a kill sounds final. style is a weapon style name.
   */
  hitCombo(style: string, { kill = false, heavy = style === 'heavy', material = 'flesh', x, z }: HitComboOptions = {}): void {
    const at = { x, z };
    if (material === 'metal') {
      this.playGame('hit-metal', at);
      if (heavy) this.playGame('hit-heavy', { ...at, volume: 0.55 });
    } else if (style === 'magic') {
      this.playGame('magic-impact', at);
      this.playGame('binary-glitch', { ...at, volume: 0.55, delay: 0.02 });
    } else if (style === 'arrow') {
      this.playGame('arrow-hit', at);
    } else if (heavy) {
      this.playGame('hit-heavy', at);
      this.playGame('hit-flesh', { ...at, volume: 0.65, pitchVariance: 0.12 });
    } else {
      this.playGame('hit-flesh', at);
    }
    if (kill) {
      // Thud and sting belong together: the sting had its low end removed so the thud can carry it.
      this.playGame('kill-thud', { ...at, duck: heavy ? 1 : 0.8 });
      this.playGame('kill-sting', { ...at, delay: 0.03 });
    }
  }

  /*
   * The big spells have no recordings of their own. They layer existing sounds slowed well down, which
   * lowers them and stretches them at once. Nobody has listened to these yet, so the levels are a first guess.
   */

  /** A spell leaving the weapon. Bigger spells are lower and thicker. */
  spellCast(kind: 'bolt' | 'crescent' | 'meteor', at: GameSoundOptions = {}): void {
    if (kind === 'bolt') {
      this.playGame('cast-magic', { ...at, pitch: 1.12 });
    } else if (kind === 'crescent') {
      this.playGame('cast-magic', { ...at, pitch: 0.85 });
      this.playGame('swing-heavy', { ...at, pitch: 0.85, volume: 0.55 });
    } else {
      this.playGame('cast-magic', { ...at, pitch: 0.6 });
      this.playGame('swing-heavy', { ...at, pitch: 0.5, volume: 0.8, delay: 0.03 });
      this.playGame('binary-glitch', { ...at, pitch: 0.7, volume: 0.25, delay: 0.08 });
    }
  }

  /** A long rush of air that peaks as the meteor lands in the given number of seconds. */
  meteorFalling(at: GameSoundOptions, seconds: number): void {
    this.playGame('wind-heavy', { ...at, pitch: 0.62, delay: Math.max(0, seconds - 0.9) });
  }

  /** The largest sound in the game: a slowed thud under a slowed blast, with the music ducked out of its way. */
  meteorImpact(at: GameSoundOptions): void {
    this.playGame('kill-thud', { ...at, pitch: 0.62, duck: 1 });
    this.playGame('hit-heavy', { ...at, pitch: 0.7, volume: 0.9 });
    this.playGame('magic-impact', { ...at, pitch: 0.55 });
    this.playGame('kill-sting', { ...at, pitch: 0.5, volume: 0.35, delay: 0.06 });
    this.playGame('binary-glitch', { ...at, pitch: 0.6, volume: 0.3, delay: 0.1 });
  }

  /** A swing leaving the hand, picked by weapon style. */
  swing(style: string, options: GameSoundOptions = {}): void {
    if (style === 'magic') this.playGame('cast-magic', options);
    else if (style === 'arrow') this.playGame('bow-release', options);
    else this.playGame(style === 'heavy' ? 'swing-heavy' : 'swing-light', options);
  }

  /** One footfall. Running steps are a little louder. */
  footstep(surface: FootSurface = 'dirt', { x, z, running = false }: { x?: number; z?: number; running?: boolean } = {}): void {
    this.playGame(surface === 'stone' ? 'footstep-stone' : 'footstep-dirt', { x, z, volume: running ? 1 : 0.7 });
  }

  /** Muffles music and ambience, then lets them come back. 1 is the full dip used for a heavy kill. */
  private duckBackdrop(amount: number): void {
    if (!this.context || !this.backdropFilter || !this.backdropDuck) return;
    const now = this.context.currentTime;
    const depth = Math.min(1, Math.max(0, amount));
    const filter = this.backdropFilter.frequency;
    filter.cancelScheduledValues(now);
    filter.setTargetAtTime(700 - 320 * depth, now, 0.015);
    filter.setTargetAtTime(20000, now + 0.25, DUCK_RECOVER_SECONDS / 3);
    const gain = this.backdropDuck.gain;
    gain.cancelScheduledValues(now);
    gain.setTargetAtTime(1 - 0.6 * depth, now, 0.015);
    gain.setTargetAtTime(1, now + 0.25, DUCK_RECOVER_SECONDS / 3);
  }

  play(name: SfxName): void {
    if (!this.enabled || !this.context || this.context.state !== 'running') return;
    if (name === 'hover') {
      const now = performance.now();
      if (now - this.lastHoverAt < 70) return;
      this.lastHoverAt = now;
    }
    void this.loadBuffer(`/audio/sfx/${name}.mp3`).then((buffer) => {
      if (!buffer || !this.context) return;
      const source = this.context.createBufferSource();
      const gain = this.context.createGain();
      gain.gain.value = SFX_VOLUME[name];
      source.buffer = buffer;
      source.connect(gain).connect(this.masterGain ?? this.context.destination);
      source.start();
    });
  }

  /** Crossfades the looping background ambience, for example fire on the login page. */
  setAmbience(name: AmbienceName): void {
    if (this.ambienceName === name) return;
    this.ambienceName = name;
    if (this.enabled && this.context) void this.startAmbience();
  }

  private start(): void {
    if (!this.context) {
      this.context = new AudioContext();
      this.musicGain = this.context.createGain();
      this.ambienceGain = this.context.createGain();
      this.musicGain.gain.value = 0;
      this.ambienceGain.gain.value = 0;

      // music and ambience -> muffler -> duck -> master. Game sounds skip the muffler, so a kill cuts through it.
      this.masterGain = this.context.createGain();
      this.masterGain.gain.value = this.userVolume;
      this.masterGain.connect(this.context.destination);
      this.backdropDuck = this.context.createGain();
      this.backdropDuck.connect(this.masterGain);
      this.backdropFilter = this.context.createBiquadFilter();
      this.backdropFilter.type = 'lowpass';
      this.backdropFilter.frequency.value = 20000;
      this.backdropFilter.connect(this.backdropDuck);
      this.musicGain.connect(this.backdropFilter);
      this.ambienceGain.connect(this.backdropFilter);

      // Holds a pileup of hits together rather than letting it clip.
      this.gameCompressor = this.context.createDynamicsCompressor();
      this.gameCompressor.threshold.value = -12;
      this.gameCompressor.ratio.value = 6;
      this.gameCompressor.attack.value = 0.002;
      this.gameCompressor.release.value = 0.12;
      this.gameCompressor.connect(this.masterGain);
      // Decoding every effect up front means the first hover or click has no delay.
      (Object.keys(SFX_VOLUME) as SfxName[]).forEach((name) => {
        void this.loadBuffer(`/audio/sfx/${name}.mp3`);
      });
    }
    void this.context.resume();
    this.startMusic();
    void this.startAmbience();
    this.fadeTo(this.musicGain, MUSIC_VOLUME);
    this.fadeTo(this.ambienceGain, AMBIENCE_VOLUME);
  }

  private silence(): void {
    this.fadeTo(this.musicGain, 0);
    this.fadeTo(this.ambienceGain, 0);
    window.setTimeout(() => {
      if (this.enabled) return;
      this.music?.pause();
      this.ambienceSource?.stop();
      this.ambienceSource = null;
    }, FADE_SECONDS * 1000);
  }

  private fadeTo(gain: GainNode | null, value: number): void {
    if (!gain || !this.context) return;
    const now = this.context.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(gain.gain.value, now);
    gain.gain.linearRampToValueAtTime(value, now + FADE_SECONDS);
  }

  private startMusic(): void {
    if (!this.context || !this.musicGain) return;
    if (!this.music) {
      this.music = new Audio(PLAYLIST[this.trackIndex]);
      this.music.preload = 'auto';
      this.music.addEventListener('ended', () => {
        if (!this.music) return;
        this.trackIndex = (this.trackIndex + 1) % PLAYLIST.length;
        this.music.src = PLAYLIST[this.trackIndex];
        void this.music.play();
      });
      this.context.createMediaElementSource(this.music).connect(this.musicGain);
    }
    void this.music.play().catch(() => undefined);
  }

  private async startAmbience(): Promise<void> {
    const name = this.ambienceName;
    if (!name || !this.context || !this.ambienceGain) return;
    const buffer = await this.loadBuffer(`/audio/sfx/${name}.wav`);
    // The page may have changed, or sound been turned off, while this was loading.
    if (!buffer || !this.context || name !== this.ambienceName || !this.enabled) return;
    // Already looping this one, so turning sound back on doesn't jump it to the start.
    if (this.ambiencePlaying === name && this.ambienceSource) return;
    this.ambienceSource?.stop();
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(this.ambienceGain);
    source.start();
    this.ambienceSource = source;
    this.ambiencePlaying = name;
  }

  private loadBuffer(url: string): Promise<AudioBuffer | null> {
    let pending = this.buffers.get(url);
    if (!pending) {
      pending = fetch(url)
        .then((response) => {
          if (!response.ok) throw new Error(`${url} returned ${response.status}`);
          return response.arrayBuffer();
        })
        .then((data) => this.context!.decodeAudioData(data))
        .catch(() => null);
      this.buffers.set(url, pending);
    }
    return pending;
  }
}

function readChoice(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function readVolume(): number {
  try {
    const saved = Number(localStorage.getItem(VOLUME_KEY) ?? 1);
    return Number.isFinite(saved) ? Math.min(1, Math.max(0, saved)) : 1;
  } catch {
    return 1;
  }
}

function gameUrl(name: GameSfxName, take: number): string {
  return `/audio/sfx/game/${name}${GAME_SFX[name].takes > 1 ? `-${take}` : ''}.mp3`;
}

export const sound = new SoundEngine();

/** One delegated listener gives every link and button its sounds, without wiring each one. */
export function installUiSounds(): void {
  const interactive = 'a, button, [role="tab"], label[for]';
  document.addEventListener('pointerover', (event) => {
    const target = (event.target as Element).closest(interactive);
    const from = (event.relatedTarget as Element | null)?.closest?.(interactive);
    if (target && target !== from && event.pointerType === 'mouse') sound.play('hover');
  });
  document.addEventListener('click', (event) => {
    if ((event.target as Element).closest(interactive)) sound.play('click');
  });
}
