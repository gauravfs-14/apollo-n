"use client";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";
import { devJump } from "@/game/core/devJump";
import { connect, disconnect } from "@/game/core/net";
import { PhaseRunner } from "@/game/core/PhaseRunner";

function Play() {
  const { room } = useParams<{ room: string }>();
  const params = useSearchParams();
  const mode = params.get("mode") === "multi" ? "multi" : "solo";
  const jump = params.get("phase");

  useEffect(() => {
    const unsub = devJump(jump);
    connect(room, mode, localStorage.getItem("apollo.name") || "Astronaut");
    return () => {
      unsub();
      disconnect();
    };
  }, [room, mode, jump]);

  return <PhaseRunner />;
}

export default function Page() {
  return (
    <Suspense>
      <Play />
    </Suspense>
  );
}
