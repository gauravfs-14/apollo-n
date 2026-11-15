"use client";
// Sound effects (Howler, pooled + cached) and mission-control voice.
// Voice: asks the API for a cached audio URL (ElevenLabs later). If the API has
// no voice provider, falls back to the browser's system speech synthesis.
import { Howl, Howler } from "howler";
import { create } from "zustand";
import { api } from "./api";

// Howler closes and re-creates its AudioContext the first time a sound plays when the
// device sample rate isn't 44.1 kHz (a Mobile Safari workaround). Most Macs run at
// 48 kHz, so that swap stranded the music on a closed context ("cannot connect to an
// AudioNode belonging to a different audio context") and opened a second output stream,
// which can click. The game is desktop-only, so keep one context for the whole session.
(Howler as unknown as { _mobileUnloaded: boolean })._mobileUnloaded = true;

const sfxCache = new Map<string, Howl>();

export function sfx(name: string, opts: { volume?: number; rate?: number } = {}) {
  const src = name.startsWith("/") ? name : `/audio/sfx/${name}.mp3`;
  let h = sfxCache.get(src);
  if (!h) {
    h = new Howl({ src: [src], preload: true, volume: 0.7 });
    sfxCache.set(src, h);
  }
  const id = h.play();
  if (opts.volume !== undefined) h.volume(opts.volume, id);
  if (opts.rate !== undefined) h.rate(opts.rate, id);
  return id;
}

/** Stop every playing sound effect (not music or voice). */
export function stopSfx() {
  sfxCache.forEach((h) => h.stop());
}

// ---- Music ----
// One looping track at a time. Each track is an <audio> element (streams, so only
// the current stage's file downloads) routed through Web Audio gain nodes, so
// fades are sample-accurate ramps (Howler's html5 fades step the volume, which
// can click). If the browser blocks playback until a gesture (Firefox/Zen,
// Safari), the track starts on the next click or key press.
interface Track { src: string; el: HTMLAudioElement; gain: GainNode }
let mctx: AudioContext | null = null;
let bus: GainNode | null = null;
let music: Track | null = null;
let musicVolume = typeof window !== "undefined" ? Number(localStorage.getItem("apollo.musicVolume") ?? 0.6) : 0.6;
let musicLevel = 0.35;
let waiting = false;

/**
 * The game's single AudioContext (Howler's), shared by sfx, music and the surface
 * synth. Each extra context opens another output stream, and opening one can pop
 * the speakers (very audible in Firefox). Connect to `out` so master volume applies.
 */
export function audioGraph(): { ctx: AudioContext; out: AudioNode } | null {
  if (typeof window === "undefined") return null;
  if (!Howler.ctx) Howler.volume(Howler.volume()); // makes Howler set up its context
  const ctx = Howler.ctx;
  if (!ctx || !Howler.masterGain) return null;
  return { ctx, out: Howler.masterGain };
}

function musicCtx() {
  const g = audioGraph();
  if (!g) return null;
  // rebuild if the context changed (e.g. Howler re-created after a hot reload): nodes can't cross contexts
  if (!bus || bus.context !== g.ctx) {
    bus = g.ctx.createGain();
    bus.gain.value = musicVolume;
    bus.connect(g.out);
    // the playing track is wired to the old context: carry it over, resuming where it was
    if (music && music.gain.context !== g.ctx) {
      const { src, el } = music;
      const at = el.currentTime;
      el.pause();
      music = null;
      mctx = g.ctx;
      playMusic(src, musicLevel);
      if (music) (music as Track).el.currentTime = at;
    }
  }
  mctx = g.ctx;
  return mctx;
}

function ramp(g: GainNode, to: number, seconds: number) {
  const t = g.context.currentTime;
  g.gain.cancelScheduledValues(t);
  g.gain.setValueAtTime(g.gain.value, t);
  g.gain.linearRampToValueAtTime(to, t + seconds);
}

function startTrack(tr: Track) {
  const ctx = musicCtx();
  if (ctx?.state === "suspended") ctx.resume().catch(() => {});
  tr.el
    .play()
    .then(() => music === tr && ramp(tr.gain, musicLevel, 0.8))
    .catch(() => waitForGesture());
}

function waitForGesture() {
  if (waiting) return;
  waiting = true;
  const go = () => {
    waiting = false;
    window.removeEventListener("pointerdown", go, true);
    window.removeEventListener("keydown", go, true);
    if (music) startTrack(music);
  };
  window.addEventListener("pointerdown", go, true);
  window.addEventListener("keydown", go, true);
}

function retire(tr: Track, seconds: number) {
  ramp(tr.gain, 0, seconds);
  setTimeout(() => {
    tr.el.pause();
    tr.el.removeAttribute("src");
    tr.el.load();
    tr.gain.disconnect();
  }, seconds * 1000 + 100);
}

export function playMusic(src: string, level = 0.35) {
  if (typeof window === "undefined" || music?.src === src) return;
  const ctx = musicCtx();
  if (!ctx) return;
  if (music) retire(music, 1.5);
  musicLevel = level;
  const el = new Audio(src);
  el.loop = true;
  el.preload = "auto";
  const gain = ctx.createGain();
  gain.gain.value = 0;
  ctx.createMediaElementSource(el).connect(gain).connect(bus!);
  music = { src, el, gain };
  startTrack(music);
}

// ---- Ambience ----
// Room tone under the action (control room, cabin hum, suit breathing). Beds are short
// loops, decoded once and crossfaded into themselves so the seam is never heard.
let amb: { src: string; gain: GainNode; timer: ReturnType<typeof setTimeout> | null } | null = null;
const AMB_XF = 1.5;

export function playAmbience(src: string | null, level = 0.25) {
  if (typeof window === "undefined" || amb?.src === src) return;
  const g = audioGraph();
  if (!g) return;
  const { ctx, out } = g;
  if (amb) {
    const old = amb;
    if (old.timer) clearTimeout(old.timer);
    ramp(old.gain, 0, 1.2);
    setTimeout(() => old.gain.disconnect(), 1400);
    amb = null;
  }
  if (!src) return;
  const gain = ctx.createGain();
  gain.gain.value = 0;
  gain.connect(out);
  const me = { src, gain, timer: null as ReturnType<typeof setTimeout> | null };
  amb = me;
  loadBuffer(ctx, src)
    .then((buf) => {
      if (amb !== me) return;
      ramp(gain, level, 2);
      // schedule overlapping copies: each fades in while the previous fades out
      let next = ctx.currentTime + 0.05;
      const step = Math.max(1, buf.duration - AMB_XF);
      const schedule = () => {
        if (amb !== me) return;
        while (next < ctx.currentTime + step + 1) {
          const s = ctx.createBufferSource();
          s.buffer = buf;
          const xg = ctx.createGain();
          xg.gain.setValueAtTime(0, next);
          xg.gain.linearRampToValueAtTime(1, next + AMB_XF);
          xg.gain.setValueAtTime(1, next + buf.duration - AMB_XF);
          xg.gain.linearRampToValueAtTime(0, next + buf.duration);
          s.connect(xg).connect(gain);
          s.start(next);
          s.stop(next + buf.duration + 0.05);
          next += step;
        }
        me.timer = setTimeout(schedule, step * 500);
      };
      schedule();
    })
    .catch(() => {});
}

if (typeof window !== "undefined") {
  (window as unknown as { __ambience: () => string | null }).__ambience = () => amb?.src.split("/").pop() ?? null;
  (window as unknown as { __music: () => object | null }).__music = () =>
    music && {
      src: music.src.split("/").pop(),
      playing: !music.el.paused,
      t: +music.el.currentTime.toFixed(2),
      ready: music.el.readyState,
      gain: +(music.gain.gain.value * (bus?.gain.value ?? 0)).toFixed(3),
      ctx: mctx?.state,
    };
}

export function stopMusic() {
  if (!music) return;
  retire(music, 1);
  music = null;
}

/** 0..1, user setting (separate from master volume). */
export function setMusicVolume(v: number) {
  musicVolume = v;
  localStorage.setItem("apollo.musicVolume", String(v));
  if (bus) ramp(bus, musicVolume, 0.1);
}
export function getMusicVolume() {
  return musicVolume;
}

export function setMasterVolume(v: number) {
  Howler.volume(v); // music and synth run through Howler's master gain too
}

// ---- Voice ----
// Browsers only allow speech after a user gesture, and Chrome/Safari have a few
// speechSynthesis quirks we work around here:
// - unlock: speak a silent utterance inside the first click/keypress (Safari needs this)
// - no network round trip before speaking when the API uses the system voice
//   (an await can lose the gesture); the provider is fetched once and cached
// - utterances are kept referenced (Chrome drops GC'd ones) and split into
//   sentences (Chrome cuts off utterances longer than ~15 s)
// - cancel() then speak() in the same tick is sometimes swallowed by Chrome
let preferredVoice: SpeechSynthesisVoice | null = null;
let provider: "system" | "remote" | null = null;
let providerReq: Promise<void> | null = null;
let unlocked = false;
let token = 0;
const live = new Set<SpeechSynthesisUtterance>();
const hasTTS = () => typeof window !== "undefined" && "speechSynthesis" in window;

function pickSystemVoice() {
  if (preferredVoice || !hasTTS()) return preferredVoice;
  const voices = speechSynthesis.getVoices();
  const en = voices.filter((v) => v.lang.toLowerCase().startsWith("en"));
  preferredVoice =
    en.find((v) => /Samantha|Daniel|Alex|Google US English/i.test(v.name)) ??
    en.find((v) => v.localService) ??
    en[0] ??
    null;
  return preferredVoice;
}

function loadProvider() {
  providerReq ??= api<{ voice?: string }>("/health")
    .then((h) => void (provider = h.voice === "elevenlabs" ? "remote" : "system"))
    .catch(() => void (provider = "system"));
  return providerReq;
}

if (typeof window !== "undefined") {
  loadProvider();
  if (hasTTS()) {
    pickSystemVoice();
    speechSynthesis.addEventListener?.("voiceschanged", () => {
      preferredVoice = null;
      pickSystemVoice();
    });
  }
  const unlock = () => {
    if (unlocked) return;
    unlocked = true;
    if (hasTTS()) {
      const u = new SpeechSynthesisUtterance(" ");
      u.volume = 0;
      speechSynthesis.speak(u);
    }
    window.removeEventListener("pointerdown", unlock, true);
    window.removeEventListener("keydown", unlock, true);
  };
  window.addEventListener("pointerdown", unlock, true);
  window.addEventListener("keydown", unlock, true);
}

function sentences(text: string): string[] {
  const parts = text.match(/[^.!?]+[.!?]*\s*/g)?.map((s) => s.trim()).filter(Boolean) ?? [text];
  return parts.length ? parts : [text];
}

function speakSystem(text: string, my: number): Promise<void> {
  return new Promise<void>((resolve) => {
    if (!hasTTS() || !text.trim()) return resolve();
    const busy = speechSynthesis.speaking || speechSynthesis.pending;
    if (busy) speechSynthesis.cancel();
    const start = () => {
      if (my !== token) return resolve();
      speechSynthesis.resume(); // Chrome can get stuck paused
      const chunks = sentences(text);
      const volume = Howler.volume();
      chunks.forEach((chunk, i) => {
        const u = new SpeechSynthesisUtterance(chunk);
        const v = pickSystemVoice();
        if (v) u.voice = v;
        u.lang = v?.lang ?? "en-US";
        u.rate = 1.02;
        u.pitch = 0.95;
        u.volume = volume;
        live.add(u);
        const done = () => {
          live.delete(u);
          if (i === chunks.length - 1) resolve();
        };
        u.onend = done;
        u.onerror = done;
        speechSynthesis.speak(u);
      });
    };
    if (busy) setTimeout(start, 60);
    else start();
  });
}

// ---- Mission radio (ElevenLabs lines) ----
// Lines are played through a radio chain on the shared AudioContext. Each speaker
// has a profile: Houston (capcom) is a clean-ish ground line bracketed by Quindar
// tones (2525 Hz in, 2475 Hz out), as on Apollo; the crew talk from space, so their
// lines are narrower and noisier; the PAO commentator is a broadcast feed. Voice and
// static share one AGC compressor, so the static ducks while someone talks and swells
// in the pauses, the "pumping" heard on real air-to-ground recordings.
export type Speaker = "capcom" | "crew" | "crew2" | "pao";

interface RadioProfile {
  hp: number; // band edges, Hz
  lp: number;
  drive: number; // saturation
  lead: number; // channel open (key-up, Quindar) before the voice, s
  quindar: boolean;
  squelch: number; // squelch tail level (0 = none)
  waver: number; // lowest voice level while fading (1 = steady)
  dropouts: boolean;
  hiss: number; // static level
  hissBand: number;
  drift: number; // how far the static drifts up
  keyUp: number; // key-up rush level
  pops: number; // crackles per second
  pop: number; // crackle level
}

const PROFILES: Record<Speaker, RadioProfile> = {
  // Kept subtle: texture under the voice, not effects on top of it.
  capcom: { hp: 300, lp: 3400, drive: 1.5, lead: 0.38, quindar: true, squelch: 0.18, waver: 0.93, dropouts: false, hiss: 0.04, hissBand: 2400, drift: 1.4, keyUp: 0.15, pops: 0.2, pop: 0.08 },
  crew: { hp: 400, lp: 2900, drive: 2.0, lead: 0.18, quindar: false, squelch: 0.3, waver: 0.88, dropouts: false, hiss: 0.07, hissBand: 1800, drift: 1.7, keyUp: 0.25, pops: 0.6, pop: 0.14 },
  crew2: { hp: 400, lp: 2900, drive: 2.0, lead: 0.18, quindar: false, squelch: 0.3, waver: 0.88, dropouts: false, hiss: 0.07, hissBand: 1900, drift: 1.7, keyUp: 0.25, pops: 0.6, pop: 0.14 },
  pao: { hp: 140, lp: 5600, drive: 1.2, lead: 0.06, quindar: false, squelch: 0, waver: 1, dropouts: false, hiss: 0.015, hissBand: 3200, drift: 1.1, keyUp: 0, pops: 0, pop: 0 },
};

const bufCache = new Map<string, Promise<AudioBuffer>>();
let radio: { stop: () => void } | null = null;
let noiseBuf: AudioBuffer | null = null;
let whiteBuf: AudioBuffer | null = null;
const shaperCurves = new Map<number, Float32Array<ArrayBuffer>>();

function loadBuffer(ctx: AudioContext, url: string): Promise<AudioBuffer> {
  let p = bufCache.get(url);
  if (!p) {
    p = fetch(url)
      .then((r) => r.arrayBuffer())
      .then((b) => ctx.decodeAudioData(b))
      .then((b) => trimSilence(ctx, b));
    p.catch(() => bufCache.delete(url));
    bufCache.set(url, p);
    if (bufCache.size > 60) bufCache.delete(bufCache.keys().next().value!);
  }
  return p;
}

/** TTS clips carry silence at both ends; trim it so lines (and countdown numbers) start on cue. */
function trimSilence(ctx: BaseAudioContext, b: AudioBuffer): AudioBuffer {
  const d = b.getChannelData(0);
  const th = 0.012;
  let s = 0;
  while (s < d.length && Math.abs(d[s]) < th) s++;
  let e = d.length - 1;
  while (e > s && Math.abs(d[e]) < th) e--;
  s = Math.max(0, s - Math.round(b.sampleRate * 0.03)); // keep a breath of lead-in
  e = Math.min(d.length - 1, e + Math.round(b.sampleRate * 0.08)); // and the word's decay
  if (e - s < b.sampleRate * 0.1 || (s === 0 && e === d.length - 1)) return b;
  const out = ctx.createBuffer(b.numberOfChannels, e - s + 1, b.sampleRate);
  for (let c = 0; c < b.numberOfChannels; c++) out.copyToChannel(b.getChannelData(c).subarray(s, e + 1), c);
  return out;
}

function radioCurve(drive: number) {
  let c = shaperCurves.get(drive);
  if (!c) {
    const n = 1024;
    c = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      c[i] = Math.tanh(drive * x) / Math.tanh(drive);
    }
    shaperCurves.set(drive, c);
  }
  return c;
}

function noise(ctx: BaseAudioContext) {
  if (!noiseBuf) {
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    let b = 0;
    for (let i = 0; i < d.length; i++) {
      b = 0.97 * b + 0.03 * (Math.random() * 2 - 1); // soft, slightly pink hiss
      d[i] = b * 6 + (Math.random() * 2 - 1) * 0.15;
    }
  }
  return noiseBuf;
}

function white(ctx: BaseAudioContext) {
  if (!whiteBuf) {
    whiteBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = whiteBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return whiteBuf;
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);

/** Schedule one radio transmission on `ctx` (realtime or offline). */
function scheduleRadio(ctx: BaseAudioContext, out: AudioNode, buf: AudioBuffer, speaker: Speaker) {
  const P = PROFILES[speaker];
  const t0 = ctx.currentTime + 0.05;
  const vStart = t0 + P.lead;
  const vEnd = vStart + buf.duration;
  const squelchAt = P.quindar ? vEnd + 0.42 : vEnd + 0.08; // Houston's squelch comes after the closing Quindar tone
  const squelchLen = speaker === "capcom" ? 0.16 : 0.26;
  const end = (P.squelch ? squelchAt + squelchLen : vEnd + 0.1) + 0.04;

  const bus = ctx.createGain();
  bus.connect(out);
  const nodes: AudioScheduledSourceNode[] = [];

  /** Band-limited noise burst with a soft attack (a bare step would sound like a speaker click). */
  const burst = (at: number, len: number, level: number, freq: number, q: number, attack = 0.003) => {
    const n = ctx.createBufferSource();
    n.buffer = white(ctx);
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(level, at + attack);
    g.gain.exponentialRampToValueAtTime(level * 0.05, at + len);
    g.gain.linearRampToValueAtTime(0, at + len + 0.01);
    n.connect(f).connect(g).connect(bus);
    n.start(at, rand(0, 0.8));
    n.stop(at + len + 0.02);
    nodes.push(n);
  };

  // AGC: voice and static share one compressor, so the static ducks under speech
  const agc = ctx.createDynamicsCompressor();
  agc.threshold.value = -30;
  agc.ratio.value = 6;
  agc.knee.value = 6;
  agc.attack.value = 0.008;
  agc.release.value = 0.25;
  const makeup = ctx.createGain();
  makeup.gain.value = 1.35;
  agc.connect(makeup).connect(bus);

  // voice through the comms band: two filters per edge for the steep skirts of a real radio channel
  const src = ctx.createBufferSource();
  src.buffer = buf;
  let node: AudioNode = src;
  for (const [type, f] of [
    ["highpass", P.hp],
    ["highpass", P.hp],
    ["lowpass", P.lp],
    ["lowpass", P.lp],
  ] as const) {
    const bq = ctx.createBiquadFilter();
    bq.type = type;
    bq.frequency.value = f;
    bq.Q.value = 0.6;
    node = node.connect(bq);
  }
  const shaper = ctx.createWaveShaper();
  shaper.curve = radioCurve(P.drive);
  shaper.oversample = "2x";
  const vox = ctx.createGain();
  // signal fading: the voice level wavers a little; crew lines also drop out briefly
  const base = 0.8;
  vox.gain.setValueAtTime(base, vStart);
  if (P.waver < 1) for (let t = vStart + 0.15; t < vEnd; t += rand(0.12, 0.22)) vox.gain.linearRampToValueAtTime(base * rand(P.waver, 1.04), t);
  if (P.dropouts && buf.duration > 2) {
    for (let i = 0; i < (buf.duration > 4 ? 2 : 1); i++) {
      const d = rand(vStart + 0.5, vEnd - 0.4);
      vox.gain.setValueAtTime(base, d);
      vox.gain.linearRampToValueAtTime(base * 0.3, d + 0.03);
      vox.gain.setValueAtTime(base * 0.3, d + rand(0.06, 0.12));
      vox.gain.linearRampToValueAtTime(base, d + 0.16);
    }
  }
  vox.gain.linearRampToValueAtTime(base, vEnd);
  node.connect(shaper).connect(vox).connect(agc);
  src.start(vStart);
  nodes.push(src);

  // static bed while the channel is open (through the AGC)
  const hiss = ctx.createBufferSource();
  hiss.buffer = noise(ctx);
  hiss.loop = true;
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = P.hissBand;
  bp.Q.value = 0.6;
  const hg = ctx.createGain();
  const level = P.hiss;
  const closeAt = P.squelch ? squelchAt : vEnd;
  hg.gain.setValueAtTime(0, t0);
  hg.gain.linearRampToValueAtTime(level, t0 + 0.04);
  for (let t = t0 + 0.2; t < closeAt - 0.1; t += rand(0.15, 0.35)) hg.gain.linearRampToValueAtTime(level * rand(0.5, P.drift), t);
  hg.gain.linearRampToValueAtTime(level, closeAt);
  hg.gain.setValueAtTime(level, end - 0.05);
  hg.gain.linearRampToValueAtTime(0, end);
  hiss.connect(bp).connect(hg).connect(agc);
  hiss.start(t0);
  hiss.stop(end + 0.05);
  nodes.push(hiss);

  // mic key-up: a short rush of noise as the channel opens
  if (P.keyUp) burst(t0, speaker === "capcom" ? 0.08 : 0.12, P.keyUp, 2200, 0.7, 0.004);

  // crackle: short filtered pops while the line is open
  const pops = Math.round(buf.duration * P.pops);
  for (let i = 0; i < pops; i++) burst(rand(vStart, vEnd), rand(0.004, 0.018), rand(P.pop * 0.5, P.pop * 1.4), rand(1800, 4200), 1.2, 0.0015);

  // squelch tail: the "kssh" when the transmitter unkeys
  if (P.squelch) burst(squelchAt, squelchLen, P.squelch, 2800, 0.8, 0.004);

  // Quindar tones on Houston's transmissions
  if (P.quindar) {
    for (const [f, at] of [
      [2525, t0],
      [2475, vEnd + 0.12],
    ] as const) {
      const o = ctx.createOscillator();
      o.frequency.value = f;
      const og = ctx.createGain();
      og.gain.setValueAtTime(0, at);
      og.gain.linearRampToValueAtTime(0.09, at + 0.006);
      og.gain.setValueAtTime(0.09, at + 0.244);
      og.gain.linearRampToValueAtTime(0, at + 0.25);
      o.connect(og).connect(bus);
      o.start(at);
      o.stop(at + 0.26);
      nodes.push(o);
    }
  }

  return { bus, nodes, end };
}

function playRadio(buf: AudioBuffer, speaker: Speaker): Promise<void> {
  const g = audioGraph();
  if (!g) return Promise.resolve();
  const { ctx, out } = g;
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  radio?.stop();
  const { bus, nodes, end } = scheduleRadio(ctx, out, buf, speaker);
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (radio === handle) radio = null;
      setTimeout(() => bus.disconnect(), 100);
      resolve();
    };
    const timer = setTimeout(finish, (end - ctx.currentTime) * 1000 + 50);
    const handle = {
      stop: () => {
        const t = ctx.currentTime;
        bus.gain.cancelScheduledValues(t);
        bus.gain.setValueAtTime(bus.gain.value, t);
        bus.gain.linearRampToValueAtTime(0, t + 0.04); // no click on interrupt
        nodes.forEach((n) => {
          try {
            n.stop(t + 0.05);
          } catch {}
        });
        finish();
      },
    };
    radio = handle;
  });
}

/** Dev/test: render a voice file through the radio chain offline; returns mono samples. */
export async function renderRadio(url: string, speaker: Speaker, sampleRate = 44100) {
  const tmp = new OfflineAudioContext(1, sampleRate, sampleRate);
  const buf = await tmp.decodeAudioData(await (await fetch(url)).arrayBuffer());
  const off = new OfflineAudioContext(1, Math.ceil((buf.duration + 1.2) * sampleRate), sampleRate);
  scheduleRadio(off, off.destination, buf, speaker);
  return (await off.startRendering()).getChannelData(0);
}
if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") {
  (window as unknown as { __renderRadio: typeof renderRadio }).__renderRadio = renderRadio;
}

/** Lines that address Houston ("Houston, we are down") are the crew talking. */
function inferSpeaker(text: string): Speaker {
  return /^Houston,/.test(text.trim()) ? "crew" : "capcom";
}

async function fetchLine(text: string, speaker: Speaker, lineId?: string): Promise<string | null> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 12000);
  try {
    const r = await api<{ url: string | null }>("/voice", { line_id: lineId ?? null, text, speaker }, { signal: ctl.signal });
    return r.url;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

// text+speaker → cached audio URL, so a line already fetched starts with no network round trip
const urlCache = new Map<string, Promise<string | null>>();
function lineUrl(text: string, speaker: Speaker): Promise<string | null> {
  const key = `${speaker}|${text}`;
  let p = urlCache.get(key);
  if (!p) {
    p = fetchLine(text, speaker);
    p.then((u) => u || urlCache.delete(key));
    urlCache.set(key, p);
  }
  return p;
}

/** Fetch and decode a line ahead of time so it starts on cue (countdowns, callouts). */
export function preloadLine(text: string, speaker: Speaker) {
  loadProvider().then(() => {
    const g = audioGraph();
    if (provider !== "remote" || !g) return;
    lineUrl(text, speaker)
      .then((u) => (u ? loadBuffer(g.ctx, u) : null))
      .catch(() => {});
  });
}

/** Ask the API to synthesize lines ahead of time (no-op with the system voice). */
export function prefetchVoice(lines: { text: string; speaker?: Speaker }[]) {
  loadProvider().then(() => {
    if (provider !== "remote" || !lines.length) return;
    api("/voice/prefetch", { lines: lines.map((l) => ({ text: l.text, speaker: l.speaker ?? inferSpeaker(l.text) })) }).catch(() => {});
  });
}

/** Who is on the loop right now: drives the on-screen transmission caption. */
export const useTransmission = create<{ label: string | null; text: string | null; speaker: Speaker | null }>(() => ({
  label: null,
  text: null,
  speaker: null,
}));

const DEFAULT_LABEL: Record<Speaker, string> = { capcom: "Houston", crew: "Commander", crew2: "Lunar Module Pilot", pao: "Mission Control" };

export interface SpeakOpts {
  speaker?: Speaker;
  /** Caption label, e.g. "Launch Control". */
  label?: string;
}

/** Speak a mission-control line. Resolves when finished. */
export async function speak(text: string, lineId?: string, opts: SpeakOpts = {}): Promise<void> {
  const my = ++token;
  radio?.stop();
  const speaker = opts.speaker ?? inferSpeaker(text);
  const showCaption = () => my === token && useTransmission.setState({ label: opts.label ?? DEFAULT_LABEL[speaker], text, speaker });
  const clearCaption = () => my === token && useTransmission.setState({ label: null, text: null, speaker: null });
  try {
    await speakInner(text, lineId, speaker, my, showCaption);
  } finally {
    clearCaption();
  }
}

async function speakInner(text: string, lineId: string | undefined, speaker: Speaker, my: number, onStart: () => void): Promise<void> {
  if (provider === null) await loadProvider();
  if (my !== token) return;
  if (provider === "remote") {
    void lineId;
    const url = await lineUrl(text, speaker);
    const g = audioGraph();
    if (my !== token) return;
    if (url && g) {
      try {
        const buf = await loadBuffer(g.ctx, url);
        if (my !== token) return;
        onStart();
        return playRadio(buf, speaker);
      } catch {
        /* fall through to the system voice */
      }
    }
  }
  onStart();
  return speakSystem(text.replace(/\[[^\]]*\]\s*/g, ""), my); // drop ElevenLabs v3 audio tags like [excited]
}

export function stopVoice() {
  token++;
  useTransmission.setState({ label: null, text: null, speaker: null });
  radio?.stop();
  if (hasTTS() && (speechSynthesis.speaking || speechSynthesis.pending)) speechSynthesis.cancel();
}
