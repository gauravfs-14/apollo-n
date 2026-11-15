"use client";
// Points of interest ("field notes"). Facts come from GET /surface/poi (curated NASA data + cached SerpApi results,
// every fact with a source link). The short text below is the offline fallback and shows until the API answers.
// Heritage hardware is placed by its REAL bearing and distance from the landing spot; it is far over the horizon, so it is
// shown as a direction marker only, never as a model in the walk area.
import { create } from "zustand";
import { API_BASE } from "../../core/api";

export interface PoiFact {
  text: string;
  source_name: string;
  source_url: string;
  via: string; // "curated" | "SerpApi"
}
export type PoiKind = "heritage" | "environment" | "instrument";
export interface PoiInfo {
  id: string;
  title: string;
  kind: PoiKind;
  facts: PoiFact[];
  distance_m?: number;
  azimuth_deg?: number;
}

const WIKI = "https://en.wikipedia.org/wiki/List_of_artificial_objects_on_the_Moon";
const f = (text: string, source_name: string, source_url: string): PoiFact => ({ text, source_name, source_url, via: "offline" });

/** Mirror of api/data/relics.json (lat/lon on the Moon). Used to place the markers when the API is unreachable. */
export const HERITAGE = [
  { id: "mip", title: "Chandrayaan-1 Moon Impact Probe", lat: -89.76, lon: -39.4 },
  { id: "lcross", title: "LCROSS Centaur impact, Cabeus", lat: -84.678, lon: -48.6926 },
  { id: "lcross_shep", title: "LCROSS shepherding spacecraft impact", lat: -84.729, lon: -49.36 },
  { id: "athena", title: "Athena (IM-2) lander", lat: -84.79, lon: 29.2 },
  { id: "odysseus", title: "Odysseus (IM-1) lander", lat: -80.13, lon: 1.44 },
  { id: "vikram2", title: "Chandrayaan-2 Vikram crash site", lat: -70.88, lon: 22.78 },
  { id: "vikram3", title: "Chandrayaan-3 Vikram lander", lat: -69.373, lon: 32.319 },
  { id: "luna25", title: "Luna 25 crash site", lat: -57.865, lon: 61.36 },
] as const;

export const ENV_POIS = ["psr", "ice", "regolith", "boulder", "crater", "sun", "earth"] as const;
export const INSTRUMENT_POIS = ["lrrr", "station"] as const;
export const POI_TOTAL = HERITAGE.length + ENV_POIS.length + INSTRUMENT_POIS.length;

const TITLES: Record<string, [string, PoiKind]> = {
  psr: ["Permanently shadowed crater", "environment"],
  ice: ["Signs of water ice", "environment"],
  regolith: ["Lunar regolith", "environment"],
  boulder: ["Boulder with a track", "environment"],
  crater: ["Small impact crater", "environment"],
  sun: ["The low Sun", "environment"],
  earth: ["Earth on the horizon", "environment"],
  lrrr: ["Laser retroreflector", "instrument"],
  station: ["Seismometer station", "instrument"],
};

const FALLBACK: Record<string, PoiFact[]> = {
  mip: [f("India's Moon Impact Probe fell from the Chandrayaan-1 orbiter to the surface near Shackleton crater on 14 November 2008.", "Wikipedia: Moon Impact Probe", "https://en.wikipedia.org/wiki/Moon_Impact_Probe")],
  lcross: [f("NASA's LCROSS Centaur stage hit the shadowed floor of Cabeus crater on 9 October 2009. The plume contained water ice.", "NASA: LCROSS", "https://science.nasa.gov/mission/lcross/")],
  lcross_shep: [f("The LCROSS shepherding spacecraft flew through the plume four minutes later, measured it, then hit too.", "NASA: LCROSS", "https://science.nasa.gov/mission/lcross/")],
  athena: [f("Intuitive Machines' Athena landed near Mons Mouton on 6 March 2025 and ended up on its side.", "Wikipedia: IM-2", "https://en.wikipedia.org/wiki/IM-2")],
  odysseus: [f("Odysseus landed near Malapert A on 22 February 2024, the first US landing since Apollo 17, and tipped onto its side.", "NASA: LRO spots Odysseus", "https://www.nasa.gov/image-article/lro-spots-odysseus/")],
  vikram2: [f("India's Vikram lander crashed on 7 September 2019 about 2 km below where contact was lost. LRO found the debris.", "NASA: LRO spots Vikram", "https://www.nasa.gov/image-article/nasa-lro-spots-chandrayaan-2-vikram-crash-site/")],
  vikram3: [f("Chandrayaan-3 made India's first soft landing near the south pole region on 23 August 2023.", "Wikipedia: Chandrayaan-3", "https://en.wikipedia.org/wiki/Chandrayaan-3")],
  luna25: [f("Russia's Luna 25 crashed on 19 August 2023. LRO later photographed a new crater about 10 m wide.", "List of artificial objects on the Moon", WIKI)],
  psr: [f("The Sun stays at the horizon at the poles, so the floors of deep craters have been in shadow for billions of years. Some are colder than -230 C.", "NASA PGDA illumination maps", "https://pgda.gsfc.nasa.gov/products/69")],
  ice: [f("LCROSS (2009) and the Moon Mineralogy Mapper (2018) found water ice in the cold, shadowed craters near the poles.", "Li et al. 2018, PNAS", "https://doi.org/10.1073/pnas.1802345115")],
  regolith: [f("Regolith is the sharp, glassy powder made by billions of years of meteorite impacts. It clung to Apollo suits.", "Wikipedia: Lunar soil", "https://en.wikipedia.org/wiki/Lunar_soil")],
  boulder: [f("LRO photographed boulders that rolled down slopes after moonquakes and impacts, leaving long tracks in the soil.", "Wikipedia: Lunar Reconnaissance Orbiter", "https://en.wikipedia.org/wiki/Lunar_Reconnaissance_Orbiter")],
  crater: [f("With no air to stop them, meteoroids of every size reach the ground, so the Moon is covered in craters. More craters means older ground.", "Wikipedia: Impact crater", "https://en.wikipedia.org/wiki/Impact_crater")],
  sun: [f("At the lunar poles the Sun never climbs more than about 2 degrees above the horizon, so shadows are very long.", "NASA PGDA illumination maps", "https://pgda.gsfc.nasa.gov/products/69")],
  earth: [f("Earth hardly moves in the lunar sky. At the south pole it hugs the horizon and rocks up and down about 7 degrees.", "Wikipedia: Libration", "https://en.wikipedia.org/wiki/Libration")],
  lrrr: [f("Apollo 11, 14 and 15 left laser reflectors. Observatories still bounce lasers off them and show the Moon drifts away about 3.8 cm a year.", "Wikipedia: Lunar Laser Ranging experiment", "https://en.wikipedia.org/wiki/Lunar_Laser_Ranging_experiment")],
  station: [f("Apollo's seismometers recorded thousands of moonquakes between 1969 and 1977.", "Wikipedia: ALSEP", "https://en.wikipedia.org/wiki/Apollo_Lunar_Surface_Experiments_Package")],
};

export function fallbackInfo(id: string): PoiInfo {
  const h = HERITAGE.find((x) => x.id === id);
  if (h) return { id, title: h.title, kind: "heritage", facts: FALLBACK[id] ?? [] };
  const [title, kind] = TITLES[id] ?? [id, "environment"];
  return { id, title, kind, facts: FALLBACK[id] ?? [] };
}

interface PoiStore {
  info: Record<string, PoiInfo>;
  web: boolean;
  key: string;
  sites: Heritage[]; // heritage markers (real bearing and distance), shared with the HUD
  load: (siteId: string, x: number, z: number) => void;
}

export const usePoi = create<PoiStore>((set, get) => ({
  info: {},
  web: false,
  key: "",
  sites: [],
  load: (siteId, x, z) => {
    const key = `${siteId}|${Math.round(x)}|${Math.round(z)}`;
    if (get().key === key) return;
    set({ key });
    const q = `${API_BASE}/surface/poi?site_id=${encodeURIComponent(siteId)}&x=${x}&z=${z}`;
    const apply = () => (d: { pois?: PoiInfo[]; web?: boolean }) => {
      if (get().key !== key || !d.pois) return;
      const info = { ...get().info };
      for (const p of d.pois) info[p.id] = p;
      set({ info, web: !!d.web || get().web });
    };
    // curated facts first (instant), then the web-enriched bundle (the first call of a topic can take ~15 s)
    fetch(`${q}&web=false`).then((r) => (r.ok ? r.json() : Promise.reject())).then(apply()).catch(() => {});
    fetch(`${q}&web=true`).then((r) => (r.ok ? r.json() : Promise.reject())).then(apply()).catch(() => {});
  },
}));

export function poiInfo(id: string): PoiInfo {
  return usePoi.getState().info[id] ?? fallbackInfo(id);
}

// ---- real bearing and distance of the heritage hardware from the landing spot (when the API is unreachable too)
const R_MOON = 1_737_400;
const rad = (d: number) => (d * Math.PI) / 180;
function plane(lat: number, lon: number) {
  const r = 2 * R_MOON * Math.tan(rad(lat + 90) / 2);
  return { x: r * Math.sin(rad(lon)), y: r * Math.cos(rad(lon)) };
}
export interface Heritage {
  id: string;
  title: string;
  dist: number; // m
  az: number; // radians, world frame (sin, cos)
}
/** `center` = tile centre in the polar plane (meta.json center.plane_x_m / plane_y_m); (x, z) = lander in tile metres. */
export function heritageFrom(center: { px: number; py: number }, x: number, z: number): Heritage[] {
  const hx = center.px + x;
  const hy = center.py - z;
  // great-circle distance needs the lander's lat/lon: invert the projection
  const rr = Math.hypot(hx, hy);
  const hlat = -90 + 2 * (Math.atan(rr / (2 * R_MOON)) * 180) / Math.PI;
  const hlon = (Math.atan2(hx, hy) * 180) / Math.PI;
  return HERITAGE.map((h) => {
    const p = plane(h.lat, h.lon);
    const a = Math.sin(rad(h.lat - hlat) / 2) ** 2 + Math.cos(rad(hlat)) * Math.cos(rad(h.lat)) * Math.sin(rad(h.lon - hlon) / 2) ** 2;
    return { id: h.id, title: h.title, dist: 2 * R_MOON * Math.asin(Math.min(1, Math.sqrt(a))), az: Math.atan2(p.x - hx, -(p.y - hy)) };
  });
}

export const fmtDist = (m: number) => (m >= 10000 ? `${Math.round(m / 1000)} km` : m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`);
