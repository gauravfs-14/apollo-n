"use client";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";
import { devJump } from "@/game/core/devJump";
import { connect, disconnect } from "@/game/core/net";
import { PhaseRunner } from "@/game/core/PhaseRunner";
import { LoadingScreen } from "@/game/ui/LoadingScreen";
import { GameShell } from "@/game/ui/GameShell";
import { useApplyVolume } from "@/game/ui/Settings";

function Play() {
  const { room } = useParams<{ room: string }>();
  const params = useSearchParams();
  const mode = params.get("mode") === "multi" ? "multi" : "solo";
  const jump = params.get("phase");
  useApplyVolume();

  useEffect(() => {
    const unsub = devJump(jump);
    connect(room, mode, localStorage.getItem("apollo.name") || "Astronaut");
    return () => {
      unsub();
      disconnect();
    };
  }, [room, mode, jump]);

  return (
    <>
      <PhaseRunner />
      <GameShell />
    </>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<LoadingScreen visible phase="select" status="Contacting Houston…" progress={null} />}>
      <Play />
    </Suspense>
  );
}
