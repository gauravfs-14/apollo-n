"use client";
import { Suspense } from "react";
import { ChallengeApp } from "@/game/arcade/ChallengeApp";

export default function Page() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-ink" />}>
      <ChallengeApp />
    </Suspense>
  );
}
