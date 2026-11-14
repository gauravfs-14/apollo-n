"use client";
/* eslint-disable react-hooks/purity, react-hooks/refs, react-hooks/set-state-in-effect, react-hooks/exhaustive-deps, react-hooks/immutability, react-hooks/preserve-manual-memoization -- timers, refs and three.js state are intentionally imperative here */
// Solar storm: drag (or click) each crew member into the water shield before the timer runs out.
import { useEffect, useMemo, useRef, useState } from "react";
import { Panel } from "../../../ui/kit";
import { ROLES, type Role } from "../../../types";
import { ROLE_INFO } from "../../crew/data";
import { lerp, mulberry, useCountdown, type HurdleCtx } from "../flow";
import { Notice, TimerBar } from "./shared";

const W = 640;
const H = 300;
type Pos = Record<Role, [number, number]>;

export function SolarStorm({ ctx }: { ctx: HurdleCtx }) {
  const total = lerp(44, 17, ctx.level) * ctx.fx.solarStormTime;
  const zoneScale = ctx.fx.solarStormTime > 1 ? 1.3 : 1; // water_shield perk: bigger shield
  const zone = useMemo(() => {
    const w = 190 * zoneScale, h = 210 * zoneScale;
    return { x: 600 - w, y: 150 - h / 2, w, h };
  }, [zoneScale]);
  const slots = useMemo(
    () => ROLES.map((_, i) => [zone.x + zone.w * (i % 2 ? 0.72 : 0.28), zone.y + zone.h * (i < 2 ? 0.3 : 0.7)] as [number, number]),
    [zone],
  );
  const start = useMemo<Pos>(() => {
    const r = mulberry(ctx.seed * 31 + ctx.idx);
    const placed: [number, number][] = [];
    for (let i = 0; i < ROLES.length; i++) {
      let p: [number, number] = [60 + r() * 260, 60 + r() * 170];
      for (let tries = 0; tries < 60 && placed.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 78); tries++) p = [60 + r() * 260, 60 + r() * 170];
      placed.push(p);
    }
    return Object.fromEntries(ROLES.map((role, i) => [role, placed[i]])) as Pos;
  }, [ctx.seed, ctx.idx]);

  const [pos, setPos] = useState<Pos>(start);
  const [done, setDone] = useState(false);
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ role: Role; moved: number; ox: number; oy: number } | null>(null);

  const inZone = (p: [number, number]) => p[0] > zone.x && p[0] < zone.x + zone.w && p[1] > zone.y && p[1] < zone.y + zone.h;
  const safeCount = (p: Pos) => ROLES.filter((r) => inZone(p[r])).length;

  const left = useCountdown(total, ctx.actor && !done, () => {
    if (done) return;
    setDone(true);
    const n = safeCount(pos);
    ctx.finish(Math.round((70 * n) / 4), `The storm hit with ${4 - n} crew outside the shield.`);
  });

  // actor: broadcast, and finish once everyone is sheltered
  useEffect(() => {
    if (!ctx.actor) return;
    ctx.push({ pos, left, total });
    if (!done && safeCount(pos) === 4) {
      setDone(true);
      const t = setTimeout(() => ctx.finish(Math.round(70 + 30 * Math.min(1, left / total)), "Everyone was behind the shield in time."), 700);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pos, left, ctx.actor]);

  const shown: Pos = ctx.actor ? pos : ((ctx.live.pos as Pos | undefined) ?? start);
  const shownLeft = ctx.actor ? left : (ctx.live.left as number | undefined) ?? total;
  const intensity = 1 - Math.max(0, Math.min(1, shownLeft / total));

  const toSvg = (e: React.PointerEvent): [number, number] => {
    const pt = svg.current!.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const p = pt.matrixTransform(svg.current!.getScreenCTM()!.inverse());
    return [Math.max(26, Math.min(W - 26, p.x)), Math.max(26, Math.min(H - 26, p.y))];
  };

  const sendToShield = (role: Role) => {
    const taken = ROLES.filter((r) => r !== role && inZone(pos[r]));
    const free = slots.find((s) => !taken.some((r) => Math.hypot(pos[r][0] - s[0], pos[r][1] - s[1]) < 30)) ?? slots[0];
    setPos((p) => ({ ...p, [role]: free }));
  };

  return (
    <>
      <style>{`@keyframes storm{from{transform:translateX(-120px)}to{transform:translateX(${W + 120}px)}}`}</style>
      {/* red edge glow as the storm nears */}
      <div className="pointer-events-none absolute inset-0 transition-opacity" style={{ boxShadow: "inset 0 0 160px 40px rgb(255 70 50 / 0.55)", opacity: intensity > 0.6 ? (intensity - 0.6) * 2.2 : 0 }} />
      <div className="absolute inset-x-0 bottom-24 flex justify-center px-4">
        <Panel className="w-full max-w-3xl space-y-3">
          <div className="grid gap-3 sm:grid-cols-[1fr_16rem] sm:items-end">
            <Notice>{ctx.actor ? "Drag each crew member into the blue water shield, or click one to send it there." : "Watching the crew take cover."}</Notice>
            <TimerBar left={shownLeft} total={total} />
          </div>
          <svg ref={svg} viewBox={`0 0 ${W} ${H}`} className="w-full touch-none select-none rounded-lg bg-[#07090d]">
            {/* hull */}
            <rect x="14" y="14" width={W - 28} height={H - 28} rx="38" fill="#0d1218" stroke="rgb(255 255 255 / 0.2)" strokeWidth="3" />
            {/* radiation streaks coming from the Sun side (left) */}
            {Array.from({ length: 9 }, (_, i) => (
              <line key={i} x1={0} x2={70} y1={30 + i * 30} y2={30 + i * 30} stroke="#ffb547" strokeWidth="3" strokeLinecap="round" opacity={0.15 + intensity * 0.6} style={{ animation: `storm ${2.4 - intensity * 1.3}s linear ${-i * 0.37}s infinite` }} />
            ))}
            {/* water shield */}
            <rect x={zone.x} y={zone.y} width={zone.w} height={zone.h} rx="18" fill="rgb(70 150 255 / 0.22)" stroke="#6fd3ff" strokeWidth="3" strokeDasharray="8 6" />
            <text x={zone.x + zone.w / 2} y={zone.y + 20} textAnchor="middle" fill="#6fd3ff" fontSize="14">Water shield</text>
            {slots.map((s, i) => <circle key={i} cx={s[0]} cy={s[1]} r="25" fill="none" stroke="rgb(111 211 255 / 0.3)" strokeDasharray="3 4" />)}
            {/* crew */}
            {ROLES.map((role) => {
              const [x, y] = shown[role];
              const safe = inZone(shown[role]);
              const info = ROLE_INFO[role];
              return (
                <g
                  key={role}
                  transform={`translate(${x} ${y})`}
                  style={{ transition: drag.current?.role === role ? "none" : "transform 0.35s ease", cursor: ctx.actor ? "grab" : "default", touchAction: "none" }}
                  className="pointer-events-auto"
                  onPointerDown={(e) => {
                    if (!ctx.actor || done) return;
                    (e.currentTarget as SVGGElement).setPointerCapture(e.pointerId);
                    const [px, py] = toSvg(e);
                    drag.current = { role, moved: 0, ox: x - px, oy: y - py };
                  }}
                  onPointerMove={(e) => {
                    const d = drag.current;
                    if (!d || d.role !== role) return;
                    const [px, py] = toSvg(e);
                    d.moved += 1;
                    setPos((p) => ({ ...p, [role]: [Math.max(26, Math.min(W - 26, px + d.ox)), Math.max(26, Math.min(H - 26, py + d.oy))] }));
                  }}
                  onPointerUp={() => {
                    const d = drag.current;
                    drag.current = null;
                    if (d && d.moved < 3) sendToShield(role);
                  }}
                >
                  <circle r="24" fill={safe ? "#0f2a1a" : "#1a1210"} stroke={safe ? "#4ade80" : info.color} strokeWidth="4" />
                  <text textAnchor="middle" y="6" fill="#fff" fontSize="17" fontWeight="600">{info.label[0]}</text>
                  <text textAnchor="middle" y="42" fill={info.color} fontSize="12">{info.label}</text>
                  {safe && <circle r="30" fill="none" stroke="#4ade80" strokeOpacity="0.5" strokeWidth="2" />}
                </g>
              );
            })}
          </svg>
          <div className="num text-sm text-white/80">{safeCount(shown)} of 4 crew sheltered</div>
        </Panel>
      </div>
    </>
  );
}
