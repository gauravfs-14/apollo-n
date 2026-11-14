"use client";
import { useEffect, useRef, useState } from "react";
import { useGame } from "../../core/useGame";
import { Button, Panel, PhaseTitle } from "../../ui/kit";
import { ROLES, type Role } from "../../types";
import { defaultNames, hashSeed, laterFor, ROLE_INFO, type CrewData } from "./data";
import { useCrewUi } from "./hover";
import { phaseLabel } from "../../ui/phaseLabel";

const WAIT_BEFORE_FORCE_MS = 15000;

export function CrewHud() {
  const { state, plan, me, isHost, patch, complete, send } = useGame();
  const setHover = useCrewUi((s) => s.setHover);
  const setUiNames = useCrewUi((s) => s.setNames);
  const multi = state?.mode === "multi";
  const seed = plan?.seed ?? hashSeed(state?.room ?? "apollo");
  const saved = (state?.phaseData.crew as Partial<CrewData> | undefined)?.names;
  const [salt, setSalt] = useState(0);
  const [typed, setTyped] = useState<Partial<Record<Role, string>>>({});
  const players = state?.players ?? [];
  const holderOf = (r: Role) => players.find((p) => p.role === r);

  const base = saved ?? defaultNames(seed, salt);
  const nameOf = (r: Role) => typed[r] ?? base[r];
  const shown = ROLES.map(nameOf).join("|");
  useEffect(() => {
    setUiNames(Object.fromEntries(ROLES.map((r) => [r, nameOf(r)])));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `shown` captures the names
  }, [shown, setUiNames]);
  const connected = players.filter((p) => p.connected);
  const waitingOn = connected.filter((p) => !p.role);
  const ready = !multi || waitingOn.length === 0;

  // never soft-lock: after a while the host may start without the stragglers
  const [canForce, setCanForce] = useState(false);
  const blockedSince = useRef<number | null>(null);
  useEffect(() => {
    if (ready) {
      blockedSince.current = null;
      setCanForce(false); // eslint-disable-line react-hooks/set-state-in-effect -- timer-driven UI flag
      return;
    }
    blockedSince.current ??= Date.now();
    const t = setTimeout(() => setCanForce(true), Math.max(0, WAIT_BEFORE_FORCE_MS - (Date.now() - blockedSince.current)));
    return () => clearTimeout(t);
  }, [ready, waitingOn.length]);

  function start() {
    const names = {} as Record<Role, string>;
    const ai: Role[] = [];
    for (const r of ROLES) {
      const h = holderOf(r);
      names[r] = (multi && h ? h.name : nameOf(r).trim()) || defaultNames(seed)[r];
      if (multi && !h) ai.push(r);
    }
    patch("crew", { names, ai } satisfies CrewData);
    complete("crew", 100);
  }

  const pick = (role: Role | null) => send({ type: "pick_role", role });
  const myRole = me?.role;

  return (
    <>
      <PhaseTitle
        step={phaseLabel("crew")}
        title="Meet your crew"
        subtitle={multi ? "Pick your role. Roles nobody picks are flown by AI crew, run by the host." : "Name your four astronauts. Each one has a job later in the mission."}
      />

      <div className="absolute right-5 top-14 w-72">
        <Panel className="space-y-3">
          {multi ? (
            <div className="text-sm">
              <div className="text-white">{players.length} in the room</div>
              <div className="mt-0.5 text-dim">
                {ready
                  ? `Everyone has a role. ${ROLES.filter((r) => !holderOf(r)).length} open role(s) will be AI crew.`
                  : `Waiting for ${waitingOn.map((p) => p.name).join(", ")} to pick a role.`}
              </div>
            </div>
          ) : (
            <div className="text-sm text-dim">You hold every role. In a crew room, friends pick one each.</div>
          )}
          {isHost ? (
            <>
              <Button className="w-full" onClick={start} disabled={!ready && !canForce}>
                {ready ? "Suit up and continue" : canForce ? "Start without them" : "Waiting for crew..."}
              </Button>
              {!multi && (
                <Button variant="ghost" className="w-full" onClick={() => { setTyped({}); saveSalt(); }}>
                  Shuffle names
                </Button>
              )}
            </>
          ) : (
            <div className="text-sm text-dim">The host starts the mission when everyone has picked.</div>
          )}
        </Panel>
      </div>

      <div className="absolute inset-x-4 bottom-4 grid gap-3 sm:inset-x-8 sm:grid-cols-4">
        {ROLES.map((role) => {
          const info = ROLE_INFO[role];
          const holder = holderOf(role);
          const mine = holder?.id === me?.id;
          const later = laterFor(role, plan);
          return (
            <div
              key={role}
              onMouseEnter={() => setHover(role)}
              onMouseLeave={() => setHover(null)}
              className="pointer-events-auto rounded-xl border bg-panel p-3.5 backdrop-blur-md"
              style={{ borderColor: mine ? info.color : "rgb(255 255 255 / 0.1)" }}
            >
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: info.color }} />
                <span className="text-base font-semibold" style={{ color: info.color }}>{info.label}</span>
              </div>
              <p className="mt-1.5 min-h-[3.2rem] text-[13px] leading-snug text-white/75">{info.job}</p>
              {later && <p className="mt-1 text-[12px] text-dim">Later: <span className="text-white/80">{later}</span></p>}

              <div className="mt-3">
                {!multi || (!holder && isHost) ? (
                  <input
                    aria-label={`${info.label} name`}
                    value={nameOf(role)}
                    maxLength={24}
                    onChange={(e) => setTyped((t) => ({ ...t, [role]: e.target.value }))}
                    disabled={!!multi && !isHost}
                    className="pointer-events-auto w-full rounded-md border border-line bg-black/40 px-2.5 py-1.5 text-sm text-white outline-none focus:border-amber/70"
                  />
                ) : (
                  <div className="rounded-md bg-white/5 px-2.5 py-1.5 text-sm">
                    {holder ? (
                      <span className={holder.connected ? "text-white" : "text-white/40"}>
                        {holder.name}
                        {mine && <span className="ml-1.5 text-xs text-dim">you</span>}
                      </span>
                    ) : (
                      <span className="text-white/50">AI crew: {nameOf(role)}</span>
                    )}
                  </div>
                )}
                {multi && (
                  <div className="mt-2">
                    {mine ? (
                      <Button variant="ghost" className="w-full py-1.5" onClick={() => pick(null)}>Free this role</Button>
                    ) : !holder ? (
                      <Button className="w-full py-1.5" onClick={() => pick(role)}>{myRole ? "Switch to this role" : "Take this role"}</Button>
                    ) : null}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );

  function saveSalt() {
    setSalt((s) => s + 1);
  }
}
