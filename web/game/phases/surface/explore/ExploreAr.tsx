"use client";
/* eslint-disable react-hooks/immutability */
// AR overlay projector. Lives in the Canvas, owns no React state: each frame it projects the target points and writes
// transform/opacity straight onto the DOM tags that ArLayer rendered over the canvas (so tags are never hidden by
// geometry and cost no re-renders). Tags show near or in view, fade with distance, and the one you look at expands.
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useGame } from "../../../core/useGame";
import { EARTH_DIR, SUN_DIR, type Ground } from "../ground";
import { layoutTasks } from "../layout";
import { rt, useSurface } from "../store";
import { colliders } from "../world";
import { arEls, arGaze, useAr } from "./arStore";
import { enrich } from "./heritage";

type Kind = "point" | "sky" | "bearing";
interface Tgt {
  id: string;
  info: string;
  kind: Kind;
  pos: THREE.Vector3; // world point (point) or unit direction (sky, bearing)
  range: number; // metres at which the tag has fully faded
  bias: number; // added to the gaze score: higher shows later
  max?: number; // gaze limit (NDC) before the tag is hidden
  sub?: string; // fixed second line (otherwise the distance)
  // frame state
  vis: boolean;
  focus: boolean;
  text: string;
  x: number; // NDC
  y: number;
  a: number; // distance fade
  d: number; // metres
  score: number; // lower = nearer the view centre
}

const mk = (id: string, info: string, kind: Kind, pos: THREE.Vector3, range: number, bias = 0, sub?: string, max?: number): Tgt =>
  ({ id, info, kind, pos, range, bias, sub, max, vis: false, focus: false, text: "", x: 0, y: 0, a: 0, d: 0, score: 9 });

const v = new THREE.Vector3();
const dirV = new THREE.Vector3();
const SKY_D = 900;
const MAX_SHOWN = 6;
const MAX_FAR = 1; // bearing markers share the horizon, so only the one you face is drawn
const fmtKm = (km: number) => (km >= 100 ? Math.round(km).toLocaleString("en-US") : km.toFixed(1)) + " km";

export function ExploreAr({ ground }: { ground: Ground }) {
  const { plan } = useGame();
  const sites = useAr((s) => s.sites);
  const flag = useAr((s) => s.flag);
  const explore = useSurface((s) => s.explore);

  const fixed = useMemo(() => {
    const out: Tgt[] = [];
    if (!plan) return out;
    const y0 = ground.heightAt(0, 0);
    const P = (x: number, y: number, z: number) => new THREE.Vector3(x, y0 + y, z);
    out.push(mk("lander", "lander", "point", P(0, 5.3, 0), 90, 0.1));
    out.push(mk("descent", "descent", "point", P(0, 1.9, -1.1), 15));
    out.push(mk("ladder", "ladder", "point", P(0, 1.5, 3.1), 13));
    out.push(mk("pad", "pad", "point", P(2.45, 0.4, 2.45), 13));
    out.push(mk("antenna", "antenna", "point", P(0.6, 6.0, -0.5), 16));
    const spots = layoutTasks(plan, ground);
    plan.surface.tasks.forEach((t) => {
      const sp = spots[t.id];
      if (!sp) return;
      const info = `task:${t.type}`;
      const y = ground.heightAt(sp.main.x, sp.main.z);
      out.push(mk(`t-${t.id}`, info, "point", new THREE.Vector3(sp.main.x, y + (t.type === "collect_sample" ? 1.2 : 2.2), sp.main.z), 110, 0.05));
    });
    const c = ground.crater;
    out.push(mk("crater", "crater", "point", new THREE.Vector3(c.x, ground.heightAt(c.x, c.z) + 4, c.z), 260, 0.1));
    for (let i = 0; i < 3; i++) out.push(mk(`boulder${i}`, "boulder", "point", new THREE.Vector3(0, -1e4, 0), 38));
    out.push(mk("earth", "earth", "sky", EARTH_DIR.clone(), Infinity, 0, "384,400 km", 0.7));
    out.push(mk("sun", "sun", "sky", SUN_DIR.clone(), Infinity, 0, "149.6 million km", 0.7));
    return out;
  }, [plan, ground]);

  const all = useMemo(() => {
    const out = [...fixed];
    if (flag) out.push(mk("flag", "flag", "point", new THREE.Vector3(flag[0], flag[1] + 2.6, flag[2]), 90, 0));
    sites.forEach((s) => {
      const a = (s.bearing * Math.PI) / 180;
      // beyond ~1 km the site is shown as a bearing marker on the horizon
      out.push(mk(s.id, s.id, "bearing", new THREE.Vector3(Math.sin(a), 0.045, Math.cos(a)).normalize(), Infinity, 0.3, `${fmtKm(s.distKm)} - bearing ${String(Math.round(s.bearing) % 360).padStart(3, "0")}`, 0.5));
    });
    return out;
  }, [fixed, flag, sites]);

  useEffect(() => {
    useAr.getState().setTargets(all.map((t) => ({ id: t.id, info: t.info })));
  }, [all]);

  const st = useRef({ boulderT: 0, order: [] as Tgt[], focusId: null as string | null });

  useFrame(({ camera }) => {
    if (!explore) return;
    const s = st.current;
    // nearest sizeable boulders around the player, refreshed twice a second
    s.boulderT -= 1;
    if (s.boulderT <= 0) {
      s.boulderT = 30;
      const near: { x: number; z: number; r: number; d: number }[] = [];
      for (let i = 1; i < colliders.length; i++) {
        const c = colliders[i];
        if (c.r < 1.5) continue;
        const d = Math.hypot(c.x - rt.pos.x, c.z - rt.pos.z);
        if (d < 40) near.push({ ...c, d });
      }
      near.sort((a, b) => a.d - b.d);
      for (let i = 0; i < 3; i++) {
        const t = fixed.find((x) => x.id === `boulder${i}`);
        if (!t) continue;
        const b = near[i];
        if (b) t.pos.set(b.x, ground.heightAt(b.x, b.z) + b.r * 0.9, b.z);
        else t.pos.set(0, -1e4, 0);
      }
    }

    camera.updateMatrixWorld();
    const now = performance.now();
    const cands = s.order;
    cands.length = 0;
    const cam = camera.position;
    for (const t of all) {
      t.vis = false;
      t.d = t.kind === "point" ? v.copy(t.pos).sub(rt.pos).length() : 0;
      t.a = t.range === Infinity ? 1 : Math.min(1, Math.max(0, (t.range - t.d) / (t.range * 0.4)));
      if (t.a < 0.01) continue;
      if (t.kind === "point") v.copy(t.pos);
      else v.copy(t.pos).multiplyScalar(SKY_D).add(cam);
      dirV.copy(v).applyMatrix4(camera.matrixWorldInverse);
      if (dirV.z > -0.1) continue;
      v.project(camera);
      if (Math.abs(v.x) > 0.94 || Math.abs(v.y) > 0.86) continue;
      const gaze = Math.hypot(v.x, v.y * 0.8);
      if (t.max !== undefined && gaze > t.max) continue;
      t.x = v.x;
      t.y = v.y;
      // the focused tag is sticky so it does not flicker between two close ones
      t.score = gaze + t.bias - (t.id === s.focusId ? 0.12 : 0) - (t.id === arGaze.pin && now < arGaze.until ? 2 : 0);
      cands.push(t);
    }
    cands.sort((a, b) => a.score - b.score);
    let shown = 0;
    let far = 0;
    let focus: string | null = null;
    const w = window.innerWidth;
    const h = window.innerHeight;
    for (const t of cands) {
      if (shown >= MAX_SHOWN || (t.kind === "bearing" && far >= MAX_FAR)) continue;
      shown++;
      if (t.kind === "bearing") far++;
      t.vis = true;
      t.focus = focus === null && t.score - t.bias < (t.kind === "bearing" ? 0.4 : 0.3) + (t.id === arGaze.pin && now < arGaze.until ? 2 : 0);
      if (t.focus) focus = t.id;
    }
    s.focusId = focus;
    arGaze.id = focus;

    for (const t of all) {
      const el = arEls.get(t.id);
      if (!el) continue;
      const root = el.root;
      if (!t.vis) {
        if (root.dataset.on === "1") {
          root.dataset.on = "0";
          root.style.opacity = "0";
          root.style.visibility = "hidden";
          root.dataset.focus = "0";
        }
        continue;
      }
      if (root.dataset.on !== "1") {
        root.dataset.on = "1";
        root.style.visibility = "visible";
      }
      root.style.transform = `translate3d(${((t.x + 1) * 0.5 * w).toFixed(1)}px,${((1 - t.y) * 0.5 * h).toFixed(1)}px,0)`;
      root.style.opacity = (t.a * (t.focus ? 1 : 0.82)).toFixed(2);
      const f = t.focus ? "1" : "0";
      if (root.dataset.focus !== f) root.dataset.focus = f;
      const text = t.sub ?? `${Math.round(t.d)} m`;
      if (text !== t.text) {
        t.text = text;
        el.sub.textContent = text;
      }
    }
  });

  // E opens (or closes) the tag you are looking at
  useEffect(() => {
    if (!explore) return;
    const key = (e: KeyboardEvent) => {
      if (e.code !== "KeyE" || e.repeat) return;
      const ar = useAr.getState();
      if (ar.open) return void useAr.setState({ open: null });
      const id = arGaze.id && all.find((t) => t.id === arGaze.id)?.info;
      if (!id) return;
      useAr.setState({ open: id });
      void enrich(id);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [explore, all]);

  // leaving explore mode hides everything
  useEffect(
    () => () => {
      arGaze.id = null;
      arEls.forEach((el) => {
        el.root.dataset.on = "0";
        el.root.style.visibility = "hidden";
      });
    },
    [],
  );
  return null;
}
