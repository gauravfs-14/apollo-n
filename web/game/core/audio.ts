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
let masterVolume = 1;
let musicLevel = 0.35;
let waiting = false;

function musicCtx() {
  if (!mctx) {
    mctx = new AudioContext();
    bus = mctx.createGain();
    bus.gain.value = masterVolume * musicVolume;
    bus.connect(mctx.destination);
  }
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
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  tr.el
    .play()
    .then(() => music === tr && ramp(tr.gain, musicLevel, 2))
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
  if (bus) ramp(bus, masterVolume * musicVolume, 0.1);
}
export function getMusicVolume() {
  return musicVolume;
}

export function setMasterVolume(v: number) {
  masterVolume = v;
  Howler.volume(v);
  if (bus) ramp(bus, masterVolume * musicVolume, 0.1);
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
let voiceHowl: Howl | null = null;
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

/** Speak a mission-control line. Resolves when finished. */
export async function speak(text: string, lineId?: string): Promise<void> {
  const my = ++token;
  voiceHowl?.stop();
  if (provider === null) await loadProvider();
  if (my !== token) return;
  if (provider === "remote") {
    try {
      const { url } = await api<{ url: string | null }>("/voice", { line_id: lineId ?? null, text });
      if (my !== token) return;
      if (url) {
          return new Promise<void>((resolve) => {
          voiceHowl = new Howl({ src: [url], html5: true, volume: 1, onend: () => resolve(), onloaderror: () => resolve() });
          voiceHowl.play();
        });
      }
    } catch {
      /* fall through to the system voice */
    }
  }
  return speakSystem(text, my);
}

export function stopVoice() {
  token++;
  voiceHowl?.stop();
  if (hasTTS() && (speechSynthesis.speaking || speechSynthesis.pending)) speechSynthesis.cancel();
}
