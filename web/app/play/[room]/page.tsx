"use client";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";
import { connect, disconnect } from "@/game/core/net";
import { PhaseRunner } from "@/game/core/PhaseRunner";

function Play() {
  const { room } = useParams<{ room: string }>();
  const mode = useSearchParams().get("mode") === "multi" ? "multi" : "solo";

  useEffect(() => {
    connect(room, mode, localStorage.getItem("apollo.name") || "Astronaut");
    return () => disconnect();
  }, [room, mode]);

  return <PhaseRunner />;
}

export default function Page() {
  return (
    <Suspense>
      <Play />
    </Suspense>
  );
}
