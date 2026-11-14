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
export type FootSurface = 'dirt' | 'stone' | 'grass' | 'forest';
type EchoPlace = 'open' | 'woods' | 'stone';

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
  /** Takes the top off above this frequency, to make something softer or further away. */
  lowpass?: number;
  /** Sends a share of it into the echo of a kind of place. */
  echo?: { place: EchoPlace; amount: number };
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
  'footstep-dirt': { takes: 3, gain: 0.13, pitch: 0.1 },
  'footstep-stone': { takes: 3, gain: 0.14, pitch: 0.08 },
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
  // The boss fight and the critical hit. Gains are the ones suggested when the files were made.
  'impact-frame': { takes: 3, gain: 1, pitch: 0.02 },
  'crit-charge': { takes: 1, gain: 0.7, pitch: 0 },
  'crit-heavy-slam': { takes: 1, gain: 1, pitch: 0.02 },
  'crit-debris': { takes: 2, gain: 0.6, pitch: 0.05 },
  'crit-blade-dash': { takes: 1, gain: 0.8, pitch: 0.03 },
  'crit-blade-cuts': { takes: 1, gain: 0.9, pitch: 0.02 },
  'crit-blade-sheath': { takes: 1, gain: 0.7, pitch: 0.02 },
  'crit-bow-slowmo': { takes: 1, gain: 0.8, pitch: 0 },
  'crit-bow-release': { takes: 1, gain: 0.9, pitch: 0.02 },
  'crit-arrow-fly': { takes: 1, gain: 0.7, pitch: 0.02 },
  'crit-arrow-impact': { takes: 1, gain: 1, pitch: 0.02 },
  'crit-magic-gather': { takes: 1, gain: 0.7, pitch: 0 },
  'crit-magic-blast': { takes: 1, gain: 1, pitch: 0.02 },
  'boss-stance-break': { takes: 1, gain: 1, pitch: 0.02 },
  'boss-stunned-loop': { takes: 1, gain: 0.45, pitch: 0 },
  'boss-roar': { takes: 2, gain: 1, pitch: 0.04 },
  'boss-snort': { takes: 1, gain: 0.6, pitch: 0.06 },
  'boss-hoof': { takes: 2, gain: 0.7, pitch: 0.05 },
  'boss-charge-rumble': { takes: 1, gain: 0.6, pitch: 0 },
  'boss-leap-land': { takes: 1, gain: 1, pitch: 0.03 },
  'boss-fireball-launch': { takes: 1, gain: 0.8, pitch: 0.04 },
  'boss-fireball-fly': { takes: 1, gain: 0.5, pitch: 0 },
  'boss-fireball-hit': { takes: 2, gain: 0.95, pitch: 0.05 },
  'boss-stomp': { takes: 1, gain: 0.95, pitch: 0.03 },
  'boss-death': { takes: 1, gain: 1, pitch: 0 },
} as const;

/** The sounds made to loop. startLoop plays them until told to stop. */
export type LoopName = 'boss-stunned-loop' | 'boss-charge-rumble' | 'boss-fireball-fly';

export interface LoopOptions {
  /** World position. Leave these out for a loop that belongs to you. */
  x?: number;
  z?: number;
  /** 0 to 1, on top of the sound's own level. */
  volume?: number;
}

/** A playing loop. stop fades it out; the handle does nothing after that. */
export interface LoopHandle {
  setPosition(x: number, z: number): void;
  setVolume(volume: number): void;
  stop(fadeSeconds?: number): void;
}

/** The impact-frame presets, which each have their own hit under the shared impact-frame crack. */
export type ImpactKind = 'heavy' | 'blade' | 'arrow' | 'magic' | 'light';

interface LoopVoice {
  name: LoopName;
  x: number | undefined;
  z: number | undefined;
  volume: number;
  source: AudioBufferSourceNode | null;
  gain: GainNode | null;
  panner: StereoPannerNode | null;
  loading: boolean;
  stopped: boolean;
}

/** Loaded on entering the game, since these are heard within a second or two of the first fight. */
const GAME_PRELOAD: readonly GameSfxName[] = [
  'swing-light', 'swing-heavy', 'hit-flesh', 'hit-heavy', 'hit-metal', 'kill-sting', 'kill-thud', 'dodge-roll', 'footstep-dirt',
  'dust-collect', 'magic-impact', 'cast-magic', 'arrow-hit', 'bow-release', 'hit-player', 'potion-drink', 'respawn',
  'wind-heavy', 'binary-glitch',
];

/** Loaded only once a boss fight begins: half a megabyte of sounds most visits never need. */
const PRELOAD_GROUPS = {
  boss: [
    'impact-frame', 'crit-charge', 'crit-heavy-slam', 'crit-debris', 'crit-blade-dash', 'crit-blade-cuts', 'crit-blade-sheath',
    'crit-bow-slowmo', 'crit-bow-release', 'crit-arrow-fly', 'crit-arrow-impact', 'crit-magic-gather', 'crit-magic-blast',
    'boss-stance-break', 'boss-stunned-loop', 'boss-roar', 'boss-snort', 'boss-hoof', 'boss-charge-rumble', 'boss-leap-land',
    'boss-fireball-launch', 'boss-fireball-fly', 'boss-fireball-hit', 'boss-stomp', 'boss-death', 'wind-heavy', 'swing-heavy',
  ],
} as const satisfies Record<string, readonly GameSfxName[]>;
export type PreloadGroup = keyof typeof PRELOAD_GROUPS;

/*
 * The boss music: three stems of one 24-bar loop (low, main, high) plus four one-shots. The numbers are
 * copied from public/audio/music/boss/boss-music.json, measured when the files were built.
 */
const BOSS_TRACK = {
  loopStart: 0.5,
  loopEnd: 51.928571,
  bar: 2.142857142857143,
  /** The first downbeat sits this far after loopStart. */
  firstBeat: 0.004399,
  /** Where the intro's big hit lands, which is where the loops' first downbeat goes. */
  introHitAt: 4.290113,
};
const BOSS_LOOP_SECONDS = BOSS_TRACK.loopEnd - BOSS_TRACK.loopStart;
/** Index order matters: 0-2 are the loop layers, the rest one-shots. */
const BOSS_FILES = ['low', 'main', 'high', 'intro', 'stinger-stun', 'outro', 'victory'] as const;
const BOSS_URLS = BOSS_FILES.map((name) => `/audio/music/boss/boss-${name}.mp3`);
const BOSS_LEVEL = [1, 0.9, 0.85, 0.9, 1, 1, 0.8];
const LOW = 0;
const MAIN = 1;
const HIGH = 2;
const INTRO = 3;
const STINGER = 4;
const OUTRO = 5;
const VICTORY = 6;
/** A touch over the playlist, since the stems were mastered about as loud and a boss should feel bigger. */
const BOSS_MUSIC_VOLUME = 0.42;
const STUN_DUCK = 0.4;
const STUN_LOWPASS = 500;
const OPEN_LOWPASS = 20000;
const PLAYLIST_OUT_SECONDS = 2;
const PLAYLIST_IN_SECONDS = 4;

/** How footsteps change with the ground. Soft ground is duller and quieter. */
const FOOT_FEEL: Record<FootSurface, { volume: number; pitch: number; lowpass: number; place: EchoPlace; echo: number }> = {
  dirt: { volume: 1, pitch: 0.95, lowpass: 2400, place: 'open', echo: 1.1 },
  grass: { volume: 0.8, pitch: 0.88, lowpass: 1500, place: 'open', echo: 1 },
  forest: { volume: 0.85, pitch: 0.82, lowpass: 1100, place: 'woods', echo: 1.3 },
  stone: { volume: 1, pitch: 0.92, lowpass: 4200, place: 'stone', echo: 1.6 },
};
const ECHO_PLACES: Record<EchoPlace, { seconds: number; darkness: number; bounces: number[] }> = {
  open: { seconds: 1.5, darkness: 0.6, bounces: [0.11, 0.23] },
  woods: { seconds: 1.1, darkness: 0.82, bounces: [0.06, 0.13, 0.21] },
  stone: { seconds: 2.6, darkness: 0.35, bounces: [0.09, 0.17, 0.29, 0.43] },
};

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
  private readonly echoes = new Map<EchoPlace, ConvolverNode>();
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
  private readonly loops: LoopVoice[] = [];
  /** Side result of place(): the stereo position of the sound it last placed. */
  private placePan = 0;
  /** True while boss music has the playlist faded out. */
  private playlistHeld = false;

  enabled = readChoice() === 'on';

  /** The layered boss music. It shares this engine's context, on/off switch and volume. */
  readonly bossMusic: BossMusic = new BossMusic({
    context: () => this.context,
    output: () => this.backdropFilter,
    enabled: () => this.enabled,
    load: (url) => this.loadBuffer(url),
    forget: (url) => this.buffers.delete(url),
    holdPlaylist: (held, at) => this.holdPlaylist(held, at),
    preload: () => this.preloadGroup('boss'),
  });

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

  /** Fetches a group of sounds ahead of need. 'boss' is the boss fight, its critical hits and its music. */
  preloadGroup(group: PreloadGroup): void {
    if (!this.context) return;
    this.preloadGame(PRELOAD_GROUPS[group]);
    if (group === 'boss') BOSS_URLS.forEach((url) => void this.loadBuffer(url));
  }

  /** Where the ears are. Call once a frame with the camera's or player's position and yaw. */
  setListener(x: number, z: number, yaw: number): void {
    this.listenerX = x;
    this.listenerZ = z;
    this.listenerYaw = yaw;
    for (let i = 0; i < this.loops.length; i += 1) {
      if (this.loops[i].x !== undefined) this.placeLoop(this.loops[i]);
    }
  }

  /**
   * How loud a sound at x, z is for the ears, from 1 near to 0 out of hearing, and where it sits left
   * to right (left in placePan, which saves allocating a result every frame). No position is 1, centered.
   */
  private place(x: number | undefined, z: number | undefined): number {
    this.placePan = 0;
    if (x === undefined || z === undefined) return 1;
    const dx = x - this.listenerX;
    const dz = z - this.listenerZ;
    const distance = Math.hypot(dx, dz);
    if (distance >= FAR_METERS) return 0;
    const beyond = Math.max(0, distance - NEAR_METERS) / (FAR_METERS - NEAR_METERS);
    // Yaw 0 looks along +z, the same as the game: see inMeleeArc in shared/combat.ts.
    if (distance > 0.5) {
      const right = (dx * Math.cos(this.listenerYaw) - dz * Math.sin(this.listenerYaw)) / distance;
      this.placePan = -right * Math.min(1, distance / NEAR_METERS) * 0.8;
    }
    return (1 - beyond) * (1 - beyond);
  }

  /**
   * Starts one of the looping sounds, faded in. It keeps going, following setPosition, until stop. Sound
   * turned off stops the audio but keeps the handle, and turning sound back on picks the loop up again.
   */
  startLoop(name: LoopName, options: LoopOptions = {}): LoopHandle {
    const voice: LoopVoice = {
      name,
      x: Number.isFinite(options.x) ? options.x : undefined,
      z: Number.isFinite(options.z) ? options.z : undefined,
      volume: clamp01(options.volume ?? 1),
      source: null,
      gain: null,
      panner: null,
      loading: false,
      stopped: false,
    };
    this.loops.push(voice);
    this.runLoop(voice);
    return {
      setPosition: (x, z) => {
        if (voice.stopped || !Number.isFinite(x) || !Number.isFinite(z)) return;
        voice.x = x;
        voice.z = z;
        this.placeLoop(voice);
      },
      setVolume: (volume) => {
        if (voice.stopped) return;
        voice.volume = clamp01(volume);
        this.placeLoop(voice);
      },
      stop: (fadeSeconds = 0.3) => {
        if (voice.stopped) return;
        voice.stopped = true;
        const index = this.loops.indexOf(voice);
        if (index >= 0) this.loops.splice(index, 1);
        this.releaseLoop(voice, fadeSeconds);
      },
    };
  }

  /** Stops every loop, for leaving the game. */
  stopLoops(): void {
    for (const voice of this.loops) {
      voice.stopped = true;
      this.releaseLoop(voice, 0.1);
    }
    this.loops.length = 0;
  }

  private runLoop(voice: LoopVoice): void {
    if (voice.stopped || voice.source || voice.loading || !this.enabled || !this.context) return;
    voice.loading = true;
    void this.loadBuffer(gameUrl(voice.name, 1)).then((buffer) => {
      voice.loading = false;
      const context = this.context;
      if (!buffer || !context || voice.stopped || voice.source || !this.enabled || !this.gameCompressor) return;
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      const gain = context.createGain();
      gain.gain.value = 0;
      const panner = context.createStereoPanner();
      source.connect(gain).connect(panner).connect(this.gameCompressor);
      source.start();
      voice.source = source;
      voice.gain = gain;
      voice.panner = panner;
      // From silence, so it fades in rather than clicking on.
      this.placeLoop(voice, 0.1);
    });
  }

  private placeLoop(voice: LoopVoice, smoothing = 0.05): void {
    if (!voice.gain || !voice.panner || !this.context) return;
    const level = GAME_SFX[voice.name].gain * voice.volume * this.place(voice.x, voice.z);
    const now = this.context.currentTime;
    voice.gain.gain.setTargetAtTime(level, now, smoothing);
    voice.panner.pan.setTargetAtTime(this.placePan, now, smoothing);
  }

  /** Fades a loop's audio out and frees its nodes. The voice itself may start again later. */
  private releaseLoop(voice: LoopVoice, fadeSeconds: number): void {
    const { source, gain, panner } = voice;
    voice.source = null;
    voice.gain = null;
    voice.panner = null;
    if (!source || !gain || !panner || !this.context) return;
    const now = this.context.currentTime;
    const fade = Math.max(0.02, Number.isFinite(fadeSeconds) ? fadeSeconds : 0.3);
    hold(gain.gain, now);
    gain.gain.linearRampToValueAtTime(0, now + fade);
    source.onended = () => {
      source.disconnect();
      gain.disconnect();
      panner.disconnect();
    };
    safeStop(source, now + fade + 0.02);
  }

  /**
   * The sound of an impact frame: the shared crack and sub drop, plus the hit that belongs to the kind,
   * with the music ducked out of the way for a breath.
   */
  impactSound(kind: ImpactKind, at: GameSoundOptions = {}): void {
    this.playGame('impact-frame', { ...at, volume: kind === 'light' ? 0.7 : 1, duck: kind === 'light' ? 0.6 : 1 });
    if (kind === 'heavy') {
      this.playGame('crit-heavy-slam', at);
      this.playGame('crit-debris', { ...at, delay: 0.25 });
    } else if (kind === 'blade') {
      this.playGame('crit-blade-cuts', at);
    } else if (kind === 'arrow') {
      this.playGame('crit-arrow-impact', at);
    } else if (kind === 'magic') {
      this.playGame('crit-magic-blast', at);
    }
  }

  /** Plays one game sound, picking a take at random (never the same one twice in a row). */
  playGame(name: GameSfxName, options: GameSoundOptions = {}): void {
    const context = this.context;
    if (!this.enabled || !context || context.state !== 'running' || !this.gameCompressor) return;
    const entry: { takes: number; gain: number; pitch: number } = GAME_SFX[name];

    const positional = this.place(options.x, options.z);
    if (positional <= 0) return;
    const pan = this.placePan;

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
      if (options.lowpass) {
        const filter = this.context.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = options.lowpass;
        source.connect(filter).connect(gain);
      } else {
        source.connect(gain);
      }
      if (options.echo) {
        const send = this.context.createGain();
        send.gain.value = options.echo.amount;
        gain.connect(send).connect(this.echoFor(options.echo.place));
      }
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

  /*
   * The Great Bull. Its own recordings are layered with a few of the general sounds slowed down. Nobody has
   * listened to the mix yet, so the levels are the suggested ones and a first guess.
   */

  /** Its first sight of someone: loads its sounds so the first roar isn't dropped for arriving late. */
  preloadBoss(): void {
    this.preloadGroup('boss');
  }

  /** A windup starting: a roar before the big moves, a snort before the quick ones, over a breath of air. */
  bossTell(move: string, at: GameSoundOptions): void {
    if (move === 'charge' || move === 'leap' || move === 'fireballs') this.playGame('boss-roar', { ...at, duck: 0.4 });
    else this.playGame('boss-snort', at);
    this.playGame('wind-heavy', { ...at, pitch: 0.55, volume: 0.6, delay: 0.05 });
    if (move === 'leap' || move === 'stomp') this.playGame('swing-heavy', { ...at, pitch: 0.45, volume: 0.6, delay: 0.25 });
  }

  /** One hoof coming down: low and dull, felt more than heard. */
  bossStep(at: GameSoundOptions, running: boolean): void {
    this.playGame('boss-hoof', { ...at, volume: running ? 0.6 : 0.38 });
  }

  /** The horns sweeping round. */
  bossSwipe(at: GameSoundOptions): void {
    this.playGame('swing-heavy', { ...at, pitch: 0.55 });
    this.playGame('wind-heavy', { ...at, pitch: 0.8, volume: 0.5 });
  }

  /** Breaking into a charge: a rumble of hooves and air. */
  bossCharge(at: GameSoundOptions): void {
    this.playGame('wind-heavy', { ...at, pitch: 0.5, volume: 1 });
    this.playGame('boss-charge-rumble', at);
  }

  /** It came down from a leap (power 1), or slammed its hooves for the stomp. The music ducks out of the way. */
  bossLand(at: GameSoundOptions, power = 1): void {
    if (power >= 0.95) {
      this.playGame('boss-leap-land', { ...at, duck: 1 });
      this.playGame('crit-debris', { ...at, volume: 0.7, delay: 0.12 });
    } else {
      this.playGame('boss-stomp', { ...at, volume: power + 0.2, duck: power * 0.8 });
    }
  }

  bossFireLaunch(at: GameSoundOptions): void {
    this.playGame('boss-fireball-launch', at);
  }

  bossFireImpact(at: GameSoundOptions): void {
    this.playGame('boss-fireball-hit', at);
  }

  /** The long collapse, which has its own knees and body thud in it. */
  bossDeath(at: GameSoundOptions): void {
    this.playGame('boss-death', { ...at, duck: 1 });
  }

  /** A swing leaving the hand, picked by weapon style. */
  swing(style: string, options: GameSoundOptions = {}): void {
    if (style === 'magic') this.playGame('cast-magic', options);
    else if (style === 'arrow') this.playGame('bow-release', options);
    else this.playGame(style === 'heavy' ? 'swing-heavy' : 'swing-light', options);
  }

  /** One footfall, sounding like the ground and the place it's in. Running steps are a little louder. */
  footstep(surface: FootSurface = 'dirt', { x, z, running = false }: { x?: number; z?: number; running?: boolean } = {}): void {
    const feel = FOOT_FEEL[surface];
    this.playGame(surface === 'stone' ? 'footstep-stone' : 'footstep-dirt', {
      x,
      z,
      volume: (running ? 1 : 0.72) * feel.volume,
      pitch: feel.pitch,
      lowpass: feel.lowpass,
      echo: { place: feel.place, amount: feel.echo },
    });
  }

  /** A reverb made once per kind of place: a burst of noise that dies away, with a few early bounces. */
  private echoFor(place: EchoPlace): ConvolverNode {
    const context = this.context!;
    const existing = this.echoes.get(place);
    if (existing) return existing;
    const { seconds, darkness, bounces } = ECHO_PLACES[place];
    const length = Math.ceil(context.sampleRate * seconds);
    const impulse = context.createBuffer(2, length, context.sampleRate);
    for (let channel = 0; channel < 2; channel += 1) {
      const data = impulse.getChannelData(channel);
      let smooth = 0;
      for (let i = 0; i < length; i += 1) {
        const left = 1 - i / length;
        smooth += (Math.random() * 2 - 1 - smooth) * (1 - darkness);
        data[i] = smooth * left * left * left;
      }
      // Slightly different per ear, which is what makes it sound like a space around you.
      bounces.forEach((at, index) => {
        const sample = Math.floor(context.sampleRate * at * (channel === 0 ? 1 : 1.07));
        if (sample < length) data[sample] += 0.55 / (index + 1);
      });
    }
    const echo = context.createConvolver();
    echo.buffer = impulse;
    // Past the compressor, so that a tail isn't squeezed by whatever is hitting at the time.
    echo.connect(this.masterGain ?? context.destination);
    this.echoes.set(place, echo);
    return echo;
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
    this.fadeTo(this.musicGain, this.playlistHeld ? 0 : MUSIC_VOLUME);
    this.fadeTo(this.ambienceGain, AMBIENCE_VOLUME);
    this.bossMusic.unmute();
    this.loops.forEach((voice) => this.runLoop(voice));
  }

  private silence(): void {
    this.fadeTo(this.musicGain, 0);
    this.fadeTo(this.ambienceGain, 0);
    this.bossMusic.mute();
    this.loops.forEach((voice) => this.releaseLoop(voice, 0.2));
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

  /** Boss music takes the playlist out over 2 seconds, and gives it back over 4 starting at the given time. */
  private holdPlaylist(held: boolean, at: number): void {
    if (!held && !this.playlistHeld) return;
    this.playlistHeld = held;
    const context = this.context;
    const gain = this.musicGain?.gain;
    if (!context || !gain || !this.enabled) return;
    const now = context.currentTime;
    hold(gain, now);
    if (held) {
      gain.linearRampToValueAtTime(0, now + PLAYLIST_OUT_SECONDS);
    } else {
      const from = Math.max(now, at);
      gain.setValueAtTime(gain.value, from);
      gain.linearRampToValueAtTime(MUSIC_VOLUME, from + PLAYLIST_IN_SECONDS);
    }
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

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 1;
}

/** Freezes a param where it is now, so a new ramp starts from what is heard rather than jumping. */
function hold(param: AudioParam, now: number): void {
  param.cancelScheduledValues(now);
  param.setValueAtTime(param.value, now);
}

function safeStop(source: AudioBufferSourceNode, when: number): void {
  try {
    source.stop(when);
  } catch {
    // Already stopped.
  }
}

interface BossMusicHost {
  context(): AudioContext | null;
  output(): AudioNode | null;
  enabled(): boolean;
  load(url: string): Promise<AudioBuffer | null>;
  forget(url: string): void;
  holdPlaylist(held: boolean, at: number): void;
  preload(): void;
}

/** The nodes of one fight's music. Each fight gets new ones, so an old fight can fade out under a new one. */
interface FightNodes {
  /** layers -> filter -> duck -> fade -> out -> the site's music muffler. The intro joins at fade, the other one-shots at out. */
  layers: GainNode[];
  filter: BiquadFilterNode;
  duck: GainNode;
  fade: GainNode;
  out: GainNode;
  sources: AudioBufferSourceNode[];
  live: number;
  ending: boolean;
}

/**
 * The boss fight's music. Three stems of the same loop play sample-locked, started at one context time, and
 * the fight is mixed by fading them. Every change is an AudioParam ramp on the context clock, and every call is
 * safe in any order or twice.
 */
class BossMusic {
  private fighting = false;
  /** The fight being heard. Null while sound is off or the files are loading. */
  private nodes: FightNodes | null = null;
  private readonly fading: FightNodes[] = [];
  private buffers: (AudioBuffer | null)[] | null = null;
  private loading = false;
  private failed = false;
  /** Bumped by dispose, so a load that finishes afterwards is dropped. */
  private generation = 0;
  /** Context time at which the loops play loopStart. It stays fixed for the fight, so the bar grid survives sound off and on. */
  private anchor: number | null = null;
  private introAt = 0;
  private highOn = false;
  private highFrom: number | null = null;
  private stunned = false;
  private critical = false;
  private criticalAt = -Infinity;

  constructor(private readonly host: BossMusicHost) {}

  /** The fight starts: the intro plays and its hit lands on the loops' first downbeat. */
  begin(): void {
    if (this.fighting) return;
    this.fighting = true;
    this.anchor = null;
    this.highOn = false;
    this.highFrom = null;
    this.stunned = false;
    this.critical = false;
    this.failed = false;
    this.host.preload();
    this.host.holdPlaylist(true, 0);
    this.ensure();
  }

  /** 0 calm to 1 desperate, for example 1 minus the boss's health share. From 0.5 the high layer comes in and stays. */
  setIntensity(value: number): void {
    if (!this.fighting || this.highOn || !Number.isFinite(value) || value < 0.5) return;
    this.highOn = true;
    const context = this.host.context();
    // Before the clock is known, build() puts the entrance on the first bar it can.
    if (!context || this.anchor === null) return;
    this.highFrom = this.nextBar(Math.max(context.currentTime + 0.05, this.anchor));
    if (!this.nodes) return;
    const gain = this.nodes.layers[HIGH].gain;
    gain.setValueAtTime(0, this.highFrom);
    gain.linearRampToValueAtTime(BOSS_LEVEL[HIGH], this.highFrom + 2 * BOSS_TRACK.bar);
  }

  /** The boss's stance broke: the music drops away and muffles under the stinger, and holds there. */
  stanceBroken(): void {
    if (!this.fighting || this.stunned) return;
    this.stunned = true;
    this.critical = false;
    const nodes = this.nodes;
    if (!nodes) return;
    const now = nodes.out.context.currentTime;
    hold(nodes.duck.gain, now);
    nodes.duck.gain.linearRampToValueAtTime(STUN_DUCK, now + 0.3);
    hold(nodes.filter.frequency, now);
    nodes.filter.frequency.exponentialRampToValueAtTime(STUN_LOWPASS, now + 0.3);
    this.shot(nodes, STINGER, now, 0, nodes.out);
  }

  /** The critical lands: a beat of silence, then everything swells back over a bar with the filter open. */
  criticalImpact(): void {
    const nodes = this.nodes;
    if (!this.fighting) return;
    this.critical = true;
    if (!nodes) return;
    const now = nodes.out.context.currentTime;
    if (now - this.criticalAt < 1) return;
    this.criticalAt = now;
    const back = now + 0.15;
    const full = back + BOSS_TRACK.bar;
    const duck = nodes.duck.gain;
    hold(duck, now);
    duck.linearRampToValueAtTime(0, now + 0.02);
    duck.setValueAtTime(0, back);
    // A slight overshoot, so it arrives as a swell rather than just returning.
    duck.linearRampToValueAtTime(1.1, full);
    duck.linearRampToValueAtTime(1, full + 0.3);
    const filter = nodes.filter.frequency;
    hold(filter, now);
    filter.setValueAtTime(filter.value, back);
    filter.exponentialRampToValueAtTime(OPEN_LOWPASS, full);
  }

  /** The stun ended. Without a critical the music comes back over a second; after one it already has. */
  stunOver(): void {
    if (!this.stunned) return;
    const hadCritical = this.critical;
    this.stunned = false;
    this.critical = false;
    const nodes = this.nodes;
    if (hadCritical || !nodes) return;
    const now = nodes.out.context.currentTime;
    hold(nodes.duck.gain, now);
    nodes.duck.gain.linearRampToValueAtTime(1, now + 1);
    hold(nodes.filter.frequency, now);
    nodes.filter.frequency.exponentialRampToValueAtTime(OPEN_LOWPASS, now + 1);
  }

  /** The boss died: the loops end on the next bar line with the outro on it, then the victory theme, then the playlist. */
  victory(): void {
    if (!this.fighting) return;
    const nodes = this.end();
    const context = this.host.context();
    if (!nodes || !context) {
      this.host.holdPlaylist(false, context?.currentTime ?? 0);
      return;
    }
    const now = context.currentTime;
    const bar = this.nextBar(Math.max(now + 0.1, this.anchor ?? now));
    const fade = nodes.fade.gain;
    hold(fade, now);
    // 60 ms, which is too short to hear as a fade and long enough not to click.
    fade.setValueAtTime(fade.value, bar - 0.06);
    fade.linearRampToValueAtTime(0, bar);
    nodes.sources.forEach((source) => safeStop(source, bar + 0.05));
    this.shot(nodes, OUTRO, bar, 0, nodes.out);
    this.shot(nodes, VICTORY, bar + 5.5, 0, nodes.out);
    this.retire(nodes);
    this.host.holdPlaylist(false, bar + 9);
  }

  /** Everyone left the arena or died: the music fades out over 3 seconds and the playlist comes back. */
  abandon(): void {
    if (!this.fighting) return;
    const nodes = this.end();
    const context = this.host.context();
    const now = context?.currentTime ?? 0;
    if (nodes) this.fadeOut(nodes, now, 3);
    this.host.holdPlaylist(false, now + 1);
  }

  /** Stops everything at once and frees the decoded music, for leaving the game. */
  dispose(): void {
    this.end();
    this.generation += 1;
    const now = this.host.context()?.currentTime ?? 0;
    // A copy, since fadeOut can remove a fight from the list.
    [...this.fading].forEach((nodes) => this.fadeOut(nodes, now, 0.05));
    this.buffers = null;
    this.loading = false;
    BOSS_URLS.forEach((url) => this.host.forget(url));
    this.host.holdPlaylist(false, now);
  }

  /** Sound was turned off: fade with the rest of the site and stop. The fight's clock carries on. */
  mute(): void {
    const now = this.host.context()?.currentTime ?? 0;
    [...this.fading].forEach((nodes) => this.fadeOut(nodes, now, FADE_SECONDS));
    if (this.nodes) this.fadeOut(this.nodes, now, FADE_SECONDS);
    this.nodes = null;
  }

  /** Sound was turned back on: rejoin the loops where they would be by now. */
  unmute(): void {
    this.ensure();
  }

  private end(): FightNodes | null {
    const nodes = this.nodes;
    this.fighting = false;
    this.nodes = null;
    this.stunned = false;
    this.critical = false;
    return nodes;
  }

  private ensure(): void {
    const context = this.host.context();
    const output = this.host.output();
    if (!this.fighting || this.nodes || !this.host.enabled() || !context || !output) return;
    if (!this.buffers) {
      if (this.loading || this.failed) return;
      this.loading = true;
      const generation = this.generation;
      void Promise.all(BOSS_URLS.map((url) => this.host.load(url))).then((buffers) => {
        if (generation !== this.generation) return;
        this.loading = false;
        if (!buffers[LOW] || !buffers[MAIN] || !buffers[HIGH]) {
          this.failed = true;
          return;
        }
        this.buffers = buffers;
        this.ensure();
      });
      return;
    }
    this.build(context, output, this.buffers);
  }

  private build(context: AudioContext, output: AudioNode, buffers: (AudioBuffer | null)[]): void {
    const now = context.currentTime;
    const fresh = this.anchor === null;
    if (fresh) {
      this.introAt = now + 0.05;
      this.anchor = this.introAt + BOSS_TRACK.introHitAt - BOSS_TRACK.firstBeat;
    }
    const anchor = this.anchor as number;
    const bar = BOSS_TRACK.bar;

    const out = context.createGain();
    const fade = context.createGain();
    const duck = context.createGain();
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    const playingStun = this.stunned && !this.critical;
    filter.frequency.value = playingStun ? STUN_LOWPASS : OPEN_LOWPASS;
    duck.gain.value = playingStun ? STUN_DUCK : 1;
    filter.connect(duck).connect(fade).connect(out).connect(output);
    const nodes: FightNodes = { layers: [], filter, duck, fade, out, sources: [], live: 0, ending: false };

    // Rejoining mid-fight starts each layer at the point the fight's clock has reached.
    const startAt = Math.max(now + 0.05, anchor);
    const into = startAt - anchor;
    const offset = BOSS_TRACK.loopStart + (((into % BOSS_LOOP_SECONDS) + BOSS_LOOP_SECONDS) % BOSS_LOOP_SECONDS);
    if (this.highOn && this.highFrom === null) this.highFrom = this.nextBar(startAt);

    for (let layer = LOW; layer <= HIGH; layer += 1) {
      const gain = context.createGain();
      gain.connect(filter);
      nodes.layers.push(gain);
      const level = BOSS_LEVEL[layer];
      const param = gain.gain;
      param.setValueAtTime(0, now);
      if (layer === HIGH) {
        // High always runs, at 0 when out, so fading it in never has to find its place in the loop.
        if (this.highOn && this.highFrom !== null) {
          param.setValueAtTime(0, Math.max(now, this.highFrom));
          param.linearRampToValueAtTime(level, Math.max(startAt + 0.03, this.highFrom + 2 * bar));
        }
      } else if (layer === MAIN && fresh) {
        param.setValueAtTime(0, anchor);
        param.linearRampToValueAtTime(level, anchor + bar);
      } else {
        param.setValueAtTime(0, startAt);
        param.linearRampToValueAtTime(level, startAt + 0.03);
      }
      const source = context.createBufferSource();
      source.buffer = buffers[layer];
      source.loop = true;
      source.loopStart = BOSS_TRACK.loopStart;
      source.loopEnd = BOSS_TRACK.loopEnd;
      source.connect(gain);
      this.track(nodes, source, null);
      source.start(startAt, offset);
    }

    const intro = buffers[INTRO];
    const introInto = now + 0.05 - this.introAt;
    if (intro && introInto < intro.duration) this.shot(nodes, INTRO, Math.max(now + 0.05, this.introAt), Math.max(0, introInto), fade);

    // A first start comes in on the intro. Coming back from sound off fades in like the rest of the site.
    out.gain.setValueAtTime(fresh ? BOSS_MUSIC_VOLUME : 0, now);
    if (!fresh) out.gain.linearRampToValueAtTime(BOSS_MUSIC_VOLUME, now + FADE_SECONDS);
    this.nodes = nodes;
  }

  /** The first downbeat at or after a context time. */
  private nextBar(time: number): number {
    if (this.anchor === null) return time;
    const downbeat = this.anchor + BOSS_TRACK.firstBeat;
    if (time <= downbeat) return downbeat;
    return downbeat + Math.ceil((time - downbeat) / BOSS_TRACK.bar - 1e-6) * BOSS_TRACK.bar;
  }

  private shot(nodes: FightNodes, index: number, when: number, offset: number, into: AudioNode): void {
    const buffer = this.buffers?.[index];
    if (!buffer) return;
    const context = nodes.out.context;
    const source = context.createBufferSource();
    source.buffer = buffer;
    const gain = context.createGain();
    gain.gain.value = BOSS_LEVEL[index];
    source.connect(gain).connect(into);
    this.track(nodes, source, gain);
    source.start(when, offset);
  }

  /** Frees a source's nodes when it ends, and the whole fight's once the last one has. */
  private track(nodes: FightNodes, source: AudioBufferSourceNode, gain: GainNode | null): void {
    nodes.sources.push(source);
    nodes.live += 1;
    source.onended = () => {
      source.disconnect();
      gain?.disconnect();
      nodes.live -= 1;
      if (nodes.live <= 0 && nodes.ending) this.release(nodes);
    };
  }

  private fadeOut(nodes: FightNodes, now: number, seconds: number): void {
    hold(nodes.out.gain, now);
    nodes.out.gain.linearRampToValueAtTime(0, now + seconds);
    nodes.sources.forEach((source) => safeStop(source, now + seconds + 0.05));
    this.retire(nodes);
  }

  private retire(nodes: FightNodes): void {
    if (!nodes.ending) {
      nodes.ending = true;
      this.fading.push(nodes);
    }
    if (nodes.live <= 0) this.release(nodes);
  }

  private release(nodes: FightNodes): void {
    nodes.layers.forEach((gain) => gain.disconnect());
    nodes.filter.disconnect();
    nodes.duck.disconnect();
    nodes.fade.disconnect();
    nodes.out.disconnect();
    nodes.sources.length = 0;
    const index = this.fading.indexOf(nodes);
    if (index >= 0) this.fading.splice(index, 1);
  }
}

export const sound = new SoundEngine();
export const bossMusic = sound.bossMusic;

/** The impact-frame sound for a kind of hit. See SoundEngine.impactSound. */
export function impactSound(kind: ImpactKind, at?: GameSoundOptions): void {
  sound.impactSound(kind, at);
}

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
