"use client";
import { useEffect, useState } from "react";
import { useGame } from "../../core/useGame";
import { Button, Panel, PhaseTitle } from "../../ui/kit";
import { ROLES, type Role } from "../../types";
import { holderOf as holderIn, rolesOf, rolesText } from "../../core/roles";
import { defaultNames, hashSeed, laterFor, ROLE_INFO, type CrewData } from "./data";
import { useCrewUi } from "./hover";
import { phaseLabel } from "../../ui/phaseLabel";

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
  const holderOf = (r: Role) => holderIn(players, r);
  const pickerOf = (r: Role) => players.find((p) => p.picked === r && !p.released);
  const labels = Object.fromEntries(ROLES.map((r) => [r, ROLE_INFO[r].label])) as Record<Role, string>;

  const base = saved ?? defaultNames(seed, salt);
  const nameOf = (r: Role) => typed[r] ?? base[r];
  const shown = ROLES.map(nameOf).join("|");
  useEffect(() => {
    setUiNames(Object.fromEntries(ROLES.map((r) => [r, nameOf(r)])));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `shown` captures the names
  }, [shown, setUiNames]);
  const myRoles = rolesOf(me);

  function start() {
    const names = {} as Record<Role, string>;
    for (const r of ROLES) {
      const h = holderOf(r);
      names[r] = (multi && h ? h.name : nameOf(r).trim()) || defaultNames(seed)[r];
    }
    patch("crew", { names, ai: [] } satisfies CrewData); // every role is held by a real player in multi
    complete("crew", 100);
  }

  const pick = (role: Role | null) => send({ type: "pick_role", role });
  const myPick = me?.picked;

  return (
    <>
      <PhaseTitle
        step={phaseLabel("crew")}
        title="Meet your crew"
        subtitle={multi ? "Ask for the role you want. The rest are shared out evenly, so everyone has a job." : "Name your four astronauts. Each one has a job later in the mission."}
      />

      <div className="absolute right-5 top-14 w-72">
        <Panel className="space-y-3">
          {multi ? (
            <div className="space-y-2 text-sm">
              <div className="text-white">{players.filter((p) => !p.released).length} in the room</div>
              {myRoles.length > 0 && (
                <div className="rounded-md bg-white/5 px-2.5 py-1.5" data-testid="my-roles">
                  <span className="text-white/60">You: </span>
                  <span className="font-medium text-white">{rolesText(myRoles, labels)}</span>
                </div>
              )}
              <ul className="space-y-1 text-[13px]">
                {players.filter((p) => !p.released).map((p) => (
                  <li key={p.id} className="flex items-baseline justify-between gap-2" data-testid="crew-line">
                    <span className={`truncate ${p.connected ? "text-white/90" : "text-white/40"}`}>{p.name}{p.id === me?.id ? " (you)" : ""}</span>
                    <span className="shrink-0 text-[12px] text-dim">{rolesText(rolesOf(p), labels)}</span>
                  </li>
                ))}
              </ul>
              <div className="text-xs text-dim">Four roles, shared evenly. It updates when someone joins or leaves.</div>
            </div>
          ) : (
            <div className="text-sm text-dim">You hold every role. In a crew room, the roles are shared between friends.</div>
          )}
          {isHost ? (
            <>
              <Button className="w-full" onClick={start}>Suit up and continue</Button>
              {!multi && (
                <Button variant="ghost" className="w-full" onClick={() => { setTyped({}); saveSalt(); }}>
                  Shuffle names
                </Button>
              )}
            </>
          ) : (
            <div className="text-sm text-dim">The host starts the mission when the crew is ready.</div>
          )}
        </Panel>
      </div>

      <div className="absolute inset-x-4 bottom-4 grid gap-3 sm:inset-x-8 sm:grid-cols-4">
        {ROLES.map((role) => {
          const info = ROLE_INFO[role];
          const holder = holderOf(role);
          const mine = !!me && rolesOf(me).includes(role);
          const picker = pickerOf(role);
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
                {!multi ? (
                  <input
                    aria-label={`${info.label} name`}
                    value={nameOf(role)}
                    maxLength={24}
                    onChange={(e) => setTyped((t) => ({ ...t, [role]: e.target.value }))}
                                        className="pointer-events-auto w-full rounded-md border border-line bg-black/40 px-2.5 py-1.5 text-sm text-white outline-none focus:border-amber/70"
                  />
                ) : (
                  <div className="rounded-md bg-white/5 px-2.5 py-1.5 text-sm">
                    {holder ? (
                      <span className={holder.connected ? "text-white" : "text-white/40"}>
                        {holder.name}
                        {mine && <span className="ml-1.5 text-xs text-dim">you</span>}
                        <span className="ml-1.5 text-xs text-dim">{picker ? "picked" : "assigned"}</span>
                      </span>
                    ) : (
                      <span className="text-white/50">Open</span>
                    )}
                  </div>
                )}
                {multi && (
                  <div className="mt-2">
                    {myPick === role ? (
                      <Button variant="ghost" className="w-full py-1.5" onClick={() => pick(null)}>Drop my pick</Button>
                    ) : picker ? (
                      <div className="py-1.5 text-center text-xs text-dim">Picked by {picker.name}</div>
                    ) : (
                      <Button className="w-full py-1.5" onClick={() => pick(role)}>{mine ? "Make this my pick" : "Prefer this role"}</Button>
                    )}
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
