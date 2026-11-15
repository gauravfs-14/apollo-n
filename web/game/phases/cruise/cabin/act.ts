// Dispatching actions: the actor applies them directly; helpers send them to the actor as events.
import { send } from "../../../core/net";
import { sfx } from "../../../core/audio";
import { applyAct, H } from "./model";

const acc = new Map<string, { at: number; dt: number }>();

/** Do something at a station. `dt` > 0 for hold-style actions (accumulated and sent ~10 Hz when not the actor). */
export function act(kind: string, p: Record<string, unknown> = {}, dt = 0) {
  if (H.actor) {
    applyAct(kind, { ...p, dt }, H.me);
    return;
  }
  const key = kind + JSON.stringify(p);
  const now = performance.now();
  const a = acc.get(key) ?? { at: 0, dt: 0 };
  a.dt += dt;
  if (dt === 0 || now - a.at > 100) {
    send({ type: "emit", kind: "cruise_help", data: { idx: H.idx, kind, p: { ...p, dt: a.dt } } });
    a.at = now;
    a.dt = 0;
  }
  acc.set(key, a);
}

export const click = () => sfx("click", { volume: 0.5 });
export const thunk = () => sfx("thunk", { volume: 0.6 });
