"use client";
// Keyboard state for the flight phases. Held keys are polled each frame; `take` returns a key press once.
// Keys are matched by physical position (event.code) so they work on any keyboard layout.
const down = new Set<string>();
const edge = new Set<string>();
let lastInput = 0;
let users = 0;

const typing = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
};
const GAME_KEYS = /^(Arrow(Up|Down|Left|Right)|Space|KeyW|KeyA|KeyS|KeyD|KeyX|KeyZ|KeyH|KeyP|KeyR|KeyB|ShiftLeft|ShiftRight|Enter)$/;

function onDown(e: KeyboardEvent) {
  if (typing(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
  if (!GAME_KEYS.test(e.code)) return;
  if (e.code.startsWith("Arrow") || e.code === "Space") e.preventDefault(); // the page must not scroll
  if (!e.repeat) edge.add(e.code);
  down.add(e.code);
  lastInput = performance.now();
}
function onUp(e: KeyboardEvent) {
  down.delete(e.code);
}
function onBlur() {
  down.clear();
}

/** Start listening (reference counted). Returns the cleanup. */
export function installKeys(): () => void {
  if (users++ === 0) {
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", onBlur);
  }
  return () => {
    if (--users === 0) {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", onBlur);
      down.clear();
      edge.clear();
    }
  };
}

export const held = (...codes: string[]) => codes.some((c) => down.has(c));
/** True once per key press. */
export function take(...codes: string[]) {
  let hit = false;
  for (const c of codes) if (edge.delete(c)) hit = true;
  return hit;
}
/** -1 / 0 / 1 from a pair of key sets, e.g. axis(["ArrowLeft","KeyA"],["ArrowRight","KeyD"]). */
export const axis = (neg: string[], pos: string[]) => (held(...pos) ? 1 : 0) - (held(...neg) ? 1 : 0);
export const clearEdges = () => edge.clear();
/** performance.now() of the last game key (autopilot hands over when the player touches a control). */
export const lastInputAt = () => lastInput;
/** Press a key from the screen (HUD buttons feed the same path as the keyboard). */
export const press = (code: string) => void edge.add(code);
