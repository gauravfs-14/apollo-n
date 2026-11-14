"use client";
// Small 3D stand-ins for each perk, shown floating out of the opened crate.
import { useMemo } from "react";
import * as THREE from "three";
import { dishGeo } from "../../three/ship/geo";
import type { PerkId } from "../../data/perks";

const metal = (c: string, r = 0.35) => new THREE.MeshStandardMaterial({ color: c, metalness: 0.9, roughness: r });
const paint = (c: string, r = 0.5) => new THREE.MeshStandardMaterial({ color: c, metalness: 0.15, roughness: r });

export function Perk3D({ id }: { id: PerkId | undefined }) {
  const m = useMemo(
    () => ({
      steel: metal("#aab0b6"), dark: metal("#2a2d31", 0.5), orange: paint("#e0651c"), white: paint("#e6e8ea"),
      water: new THREE.MeshPhysicalMaterial({ color: "#6fb8ff", transparent: true, opacity: 0.55, roughness: 0.05, metalness: 0, transmission: 0.4, thickness: 0.2 }),
      red: paint("#c22a22"), laser: new THREE.MeshBasicMaterial({ color: "#ff3b30", transparent: true, opacity: 0.8, side: THREE.DoubleSide }),
      glass: metal("#04070a", 0.05),
    }),
    [],
  );
  const dish = useMemo(() => dishGeo(0.4, 0.14, 28), []);
  switch (id) {
    case "extra_fuel":
      return (
        <group rotation-z={Math.PI / 2}>
          <mesh material={m.orange} castShadow><capsuleGeometry args={[0.2, 0.55, 8, 24]} /></mesh>
          {[-0.25, 0, 0.25].map((y) => <mesh key={y} material={m.steel} position-y={y} rotation-x={Math.PI / 2}><torusGeometry args={[0.205, 0.015, 8, 28]} /></mesh>)}
          <mesh material={m.steel} position-y={0.52}><cylinderGeometry args={[0.04, 0.05, 0.1, 12]} /></mesh>
        </group>
      );
    case "water_shield":
      return (
        <group>
          <mesh material={m.water}><cylinderGeometry args={[0.28, 0.28, 0.6, 28]} /></mesh>
          <mesh material={m.steel} position-y={0.32}><cylinderGeometry args={[0.3, 0.3, 0.05, 28]} /></mesh>
          <mesh material={m.steel} position-y={-0.32}><cylinderGeometry args={[0.3, 0.3, 0.05, 28]} /></mesh>
          <mesh material={m.white} position-y={0.05} rotation-x={Math.PI / 2}><torusGeometry args={[0.285, 0.01, 6, 28]} /></mesh>
        </group>
      );
    case "high_gain_antenna":
      return (
        <group rotation-x={-0.6}>
          <mesh geometry={dish} material={m.white} rotation-x={Math.PI / 2} position-z={0.0} castShadow />
          <mesh material={m.steel} rotation-x={Math.PI / 2} position-z={0.25}><cylinderGeometry args={[0.012, 0.012, 0.5, 6]} /></mesh>
          <mesh material={m.dark} position-z={0.5}><sphereGeometry args={[0.04, 10, 8]} /></mesh>
        </group>
      );
    case "spare_parts":
      return (
        <group>
          <mesh material={m.red} castShadow><boxGeometry args={[0.6, 0.28, 0.36]} /></mesh>
          <mesh material={m.steel} position={[0, 0.16, 0]}><boxGeometry args={[0.62, 0.02, 0.38]} /></mesh>
          <mesh material={m.dark} position={[0, 0.25, 0]} rotation-z={Math.PI / 2}><torusGeometry args={[0.08, 0.016, 8, 20, Math.PI]} /></mesh>
          {[-0.18, 0.18].map((x) => <mesh key={x} material={m.steel} position={[x, 0.0, 0.19]}><boxGeometry args={[0.07, 0.07, 0.02]} /></mesh>)}
        </group>
      );
    case "better_lidar":
    default:
      return (
        <group>
          <mesh material={m.dark} castShadow><cylinderGeometry args={[0.2, 0.22, 0.28, 28]} /></mesh>
          <mesh material={m.steel} position-y={0.16}><cylinderGeometry args={[0.14, 0.2, 0.04, 28]} /></mesh>
          <mesh material={m.glass} position-y={0.24}><sphereGeometry args={[0.12, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2]} /></mesh>
          <mesh material={m.laser} position-y={0.0} rotation-x={Math.PI / 2}><ringGeometry args={[0.215, 0.23, 40]} /></mesh>
        </group>
      );
  }
}
