"use client";
// Shared HUD primitives. Use these so every phase looks like one product.
import type { ButtonHTMLAttributes, ReactNode } from "react";

export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`pointer-events-auto rounded-xl border border-line bg-panel p-4 shadow-2xl shadow-black/40 backdrop-blur-md ${className}`}>
      {children}
    </div>
  );
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "danger" };
export function Button({ variant = "primary", className = "", ...p }: BtnProps) {
  const v = {
    primary: "bg-amber text-black hover:brightness-110",
    ghost: "border border-line bg-white/5 text-white hover:bg-white/10",
    danger: "bg-nogo text-white hover:brightness-110",
  }[variant];
  return (
    <button
      {...p}
      className={`pointer-events-auto rounded-lg px-4 py-2 text-sm font-medium transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 ${v} ${className}`}
    />
  );
}

/** Small label above a value, e.g. "Δv" / "2,410 m/s". */
export function Stat({ label, value, tone = "default" }: { label: string; value: ReactNode; tone?: "default" | "go" | "nogo" | "data" }) {
  const t = { default: "text-white", go: "text-go", nogo: "text-nogo", data: "text-cyan" }[tone];
  return (
    <div>
      <div className="text-[11px] text-dim">{label}</div>
      <div className={`num text-lg ${t}`}>{value}</div>
    </div>
  );
}

/** 0..1 bar with an optional target marker. */
export function Meter({ value, target, tone = "data" }: { value: number; target?: number; tone?: "data" | "go" | "nogo" | "amber" }) {
  const c = { data: "bg-cyan", go: "bg-go", nogo: "bg-nogo", amber: "bg-amber" }[tone];
  return (
    <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-white/10">
      <div className={`h-full ${c} transition-[width] duration-300`} style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
      {target !== undefined && <div className="absolute top-0 h-full w-0.5 bg-white" style={{ left: `${target * 100}%` }} />}
    </div>
  );
}

/** Top-left mission caption shared by all phases. */
export function PhaseTitle({ step, title, subtitle }: { step: string; title: string; subtitle?: string }) {
  return (
    <div className="pointer-events-none absolute left-6 top-5 max-w-md">
      <div className="num text-[11px] text-amber">{step}</div>
      <h2 className="text-2xl font-semibold leading-tight">{title}</h2>
      {subtitle && <p className="mt-1 text-sm text-dim">{subtitle}</p>}
    </div>
  );
}
