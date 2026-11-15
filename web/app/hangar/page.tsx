"use client";
// Hangar / collection opened from the main menu (the journey map opens the same screen as an overlay).
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { ProgressScreen, type Tab } from "@/game/progress/ProgressScreen";

const MenuScene = dynamic(() => import("@/game/ui/MenuScene"), { ssr: false });

function Inner() {
  const router = useRouter();
  const params = useSearchParams();
  const tab: Tab = params.get("tab") === "collection" ? "collection" : "hangar";
  return (
    <main className="fixed inset-0 overflow-hidden bg-black text-white">
      <MenuScene />
      <ProgressScreen tab={tab} onTab={(t) => router.replace(`/hangar?tab=${t}`)} onClose={() => router.push("/")} />
    </main>
  );
}

export default function HangarPage() {
  return (
    <Suspense fallback={null}>
      <Inner />
    </Suspense>
  );
}
