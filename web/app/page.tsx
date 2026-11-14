"use client";
// Main menu (placeholder; P3 owns the final design).
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/game/core/api";

function randomCode() {
  const a = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return "APOLLO-" + Array.from({ length: 3 }, () => a[Math.floor(Math.random() * a.length)]).join("");
}

export default function Home() {
  const router = useRouter();
  const [name, setName] = useState(() => (typeof window !== "undefined" && localStorage.getItem("apollo.name")) || "");
  const [code, setCode] = useState("");

  async function start(mode: "solo" | "multi") {
    localStorage.setItem("apollo.name", name || "Astronaut");
    let room = randomCode();
    try {
      room = (await api<{ room: string }>("/rooms", { mode })).room;
    } catch {
      /* offline solo still works */
    }
    router.push(`/play/${room}?mode=${mode}`);
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-black text-white">
      <div className="w-80 space-y-3">
        <h1 className="text-4xl font-semibold">Apollo N</h1>
        <input className="w-full rounded bg-white/10 px-3 py-2" placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} />
        <button className="w-full rounded bg-white px-3 py-2 text-black" onClick={() => start("solo")}>Solo mission</button>
        <button className="w-full rounded bg-white/15 px-3 py-2" onClick={() => start("multi")}>Host crew room</button>
        <div className="flex gap-2">
          <input className="flex-1 rounded bg-white/10 px-3 py-2 uppercase" placeholder="APOLLO-7K3" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
          <button className="rounded bg-white/15 px-3" onClick={() => { localStorage.setItem("apollo.name", name || "Astronaut"); router.push(`/play/${code.trim()}?mode=multi`); }}>Join</button>
        </div>
      </div>
    </main>
  );
}
