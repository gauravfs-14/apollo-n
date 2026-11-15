"use client";
// Sound effects (Howler, pooled + cached) and mission-control voice.
// Voice: asks the API for a cached audio URL (ElevenLabs later). If the API has
// no voice provider, falls back to the browser's system speech synthesis.
import { Howl, Howler } from "howler";
import { api } from "./api";

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
    if (music && music.gain.context !== g.ctx) {
      music.el.pause();
      music = null;
    }
    bus = g.ctx.createGain();
    bus.gain.value = musicVolume;
    bus.connect(g.out);
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

if (typeof window !== "undefined") {
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
// Lines are played through a radio chain on the shared AudioContext: comms-band
// filters, mild saturation, compression and a static bed. Houston (capcom) lines
// are bracketed by Quindar tones (2525 Hz in, 2475 Hz out), as on Apollo; crew
// lines come from the Moon, so they sound narrower and noisier.
export type Speaker = "capcom" | "crew";

const bufCache = new Map<string, Promise<AudioBuffer>>();
let radio: { stop: () => void } | null = null;
let noiseBuf: AudioBuffer | null = null;
let whiteBuf: AudioBuffer | null = null;
let shaperCurves: Record<Speaker, Float32Array<ArrayBuffer>> | null = null;

function loadBuffer(ctx: AudioContext, url: string): Promise<AudioBuffer> {
  let p = bufCache.get(url);
  if (!p) {
    p = fetch(url)
      .then((r) => r.arrayBuffer())
      .then((b) => ctx.decodeAudioData(b));
    p.catch(() => bufCache.delete(url));
    bufCache.set(url, p);
    if (bufCache.size > 24) bufCache.delete(bufCache.keys().next().value!);
  }
  return p;
}

function radioCurve(drive: number) {
  const n = 1024;
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(drive * x) / Math.tanh(drive);
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
  shaperCurves ??= { capcom: radioCurve(1.6), crew: radioCurve(2.6) };
  const crew = speaker === "crew";
  const t0 = ctx.currentTime + 0.05;
  const lead = crew ? 0.18 : 0.38; // Quindar tone + gap before the voice
  const vStart = t0 + lead;
  const vEnd = vStart + buf.duration;
  const squelchAt = crew ? vEnd + 0.08 : vEnd + 0.42; // after Houston's closing Quindar tone
  const squelchLen = crew ? 0.26 : 0.16;
  const end = squelchAt + squelchLen + 0.04;

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

  // voice through the comms chain
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const hp = ctx.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = crew ? 450 : 300;
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = crew ? 2700 : 3400;
  const shaper = ctx.createWaveShaper();
  shaper.curve = shaperCurves[speaker];
  shaper.oversample = "2x";
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -26;
  comp.ratio.value = 4;
  comp.attack.value = 0.004;
  comp.release.value = 0.12;
  const vox = ctx.createGain();
  // signal fading: the voice level wavers a little; crew lines also drop out briefly
  const base = 0.95;
  vox.gain.setValueAtTime(base, vStart);
  for (let t = vStart + 0.15; t < vEnd; t += rand(0.12, 0.22)) vox.gain.linearRampToValueAtTime(base * rand(crew ? 0.82 : 0.9, 1.04), t);
  if (crew && buf.duration > 2) {
    for (let i = 0; i < (buf.duration > 4 ? 2 : 1); i++) {
      const d = rand(vStart + 0.5, vEnd - 0.4);
      vox.gain.setValueAtTime(base, d);
      vox.gain.linearRampToValueAtTime(base * 0.3, d + 0.03);
      vox.gain.setValueAtTime(base * 0.3, d + rand(0.06, 0.12));
      vox.gain.linearRampToValueAtTime(base, d + 0.16);
    }
  }
  vox.gain.linearRampToValueAtTime(base, vEnd);
  src.connect(hp).connect(lp).connect(shaper).connect(comp).connect(vox).connect(bus);
  src.start(vStart);
  nodes.push(src);

  // static bed while the channel is open
  const hiss = ctx.createBufferSource();
  hiss.buffer = noise(ctx);
  hiss.loop = true;
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = crew ? 1800 : 2400;
  bp.Q.value = 0.6;
  const hg = ctx.createGain();
  const level = crew ? 0.11 : 0.06;
  hg.gain.setValueAtTime(0, t0);
  hg.gain.linearRampToValueAtTime(level, t0 + 0.04);
  // the static drifts up and down like a fading signal
  for (let t = t0 + 0.2; t < squelchAt - 0.1; t += rand(0.15, 0.35)) hg.gain.linearRampToValueAtTime(level * rand(0.5, crew ? 2.2 : 1.6), t);
  hg.gain.linearRampToValueAtTime(level, squelchAt);
  hg.gain.setValueAtTime(level, end - 0.05);
  hg.gain.linearRampToValueAtTime(0, end);
  hiss.connect(bp).connect(hg).connect(bus);
  hiss.start(t0);
  hiss.stop(end + 0.05);
  nodes.push(hiss);

  // mic key-up: a short rush of noise as the channel opens
  burst(t0, crew ? 0.12 : 0.08, crew ? 0.5 : 0.3, 2200, 0.7, 0.004);

  // crackle: short filtered pops while the line is open, more of it from the Moon
  const pops = Math.round(buf.duration * (crew ? 3 : 0.9));
  for (let i = 0; i < pops; i++) {
    const at = rand(vStart, vEnd);
    burst(at, rand(0.004, 0.018), crew ? rand(0.15, 0.4) : rand(0.08, 0.2), rand(1800, 4200), 1.2, 0.0015);
  }

  // squelch tail: the "kssh" when the transmitter unkeys
  burst(squelchAt, squelchLen, crew ? 0.6 : 0.35, 2800, 0.8, 0.004);

  // Quindar tones on Houston's transmissions
  if (!crew) {
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

/** Ask the API to synthesize lines ahead of time (no-op with the system voice). */
export function prefetchVoice(lines: { text: string; speaker?: Speaker }[]) {
  loadProvider().then(() => {
    if (provider !== "remote" || !lines.length) return;
    api("/voice/prefetch", { lines: lines.map((l) => ({ text: l.text, speaker: l.speaker ?? inferSpeaker(l.text) })) }).catch(() => {});
  });
}

/** Speak a mission-control line. Resolves when finished. */
export async function speak(text: string, lineId?: string, opts: { speaker?: Speaker } = {}): Promise<void> {
  const my = ++token;
  radio?.stop();
  if (provider === null) await loadProvider();
  if (my !== token) return;
  if (provider === "remote") {
    const speaker = opts.speaker ?? inferSpeaker(text);
    const url = await fetchLine(text, speaker, lineId);
    const g = audioGraph();
    if (my !== token) return;
    if (url && g) {
      try {
        const buf = await loadBuffer(g.ctx, url);
        if (my !== token) return;
        return playRadio(buf, speaker);
      } catch {
        /* fall through to the system voice */
      }
    }
  }
  return speakSystem(text, my);
}

export function stopVoice() {
  token++;
  radio?.stop();
  if (hasTTS() && (speechSynthesis.speaking || speechSynthesis.pending)) speechSynthesis.cancel();
}
