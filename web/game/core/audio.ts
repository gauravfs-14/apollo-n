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

let music: Howl | null = null;
export function playMusic(src: string, volume = 0.35) {
  if (music && (music as unknown as { _src: string })._src === src) return;
  const prev = music;
  prev?.fade(prev.volume(), 0, 1200);
  setTimeout(() => prev?.unload(), 1300);
  music = new Howl({ src: [src], loop: true, volume: 0, html5: true });
  music.play();
  music.fade(0, volume, 1500);
}
export function stopMusic() {
  music?.fade(music.volume(), 0, 800);
}

export function setMasterVolume(v: number) {
  Howler.volume(v);
}

// ---- Voice ----
let voiceHowl: Howl | null = null;
let preferredVoice: SpeechSynthesisVoice | null = null;

function pickSystemVoice() {
  if (preferredVoice || typeof speechSynthesis === "undefined") return preferredVoice;
  const voices = speechSynthesis.getVoices();
  preferredVoice =
    voices.find((v) => /Samantha|Daniel|Alex|Google US English/i.test(v.name) && v.lang.startsWith("en")) ??
    voices.find((v) => v.lang.startsWith("en")) ??
    null;
  return preferredVoice;
}

function speakSystem(text: string): Promise<void> {
  return new Promise((resolve) => {
    if (typeof speechSynthesis === "undefined") return resolve();
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const v = pickSystemVoice();
    if (v) u.voice = v;
    u.rate = 1.02;
    u.pitch = 0.95;
    u.onend = () => resolve();
    u.onerror = () => resolve();
    speechSynthesis.speak(u);
  });
}

/** Speak a mission-control line. Resolves when finished. */
export async function speak(text: string, lineId?: string): Promise<void> {
  voiceHowl?.stop();
  try {
    const { url } = await api<{ url: string | null }>("/voice", { line_id: lineId ?? null, text });
    if (url) {
      return new Promise((resolve) => {
        voiceHowl = new Howl({ src: [url], html5: true, volume: 1, onend: () => resolve(), onloaderror: () => resolve() });
        voiceHowl.play();
      });
    }
  } catch {
    /* API down → system voice */
  }
  return speakSystem(text);
}

export function stopVoice() {
  voiceHowl?.stop();
  if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
}
