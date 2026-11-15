// Heritage hardware and facts for the AR overlay: from the API (/surface/explore, NASA pictures + SerpApi extras), or the
// bundled copy of the same data with locally computed bearings when the API cannot be reached.
import { api } from "../../../core/api";
import bundled from "../../../data/heritage-fallback.json";
import { LOCAL } from "./arInfo";
import { useAr, type ArFact, type ArImage, type ArInfo, type Site } from "./arStore";

const R = 1737.4; // km

interface RawSite {
  id: string;
  title: string;
  agency?: string | null;
  year?: number | null;
  kind: string;
  lat: number;
  lon: number;
  approx?: boolean;
  left: string[];
  facts: ArFact[];
  image?: ArImage | null;
  distance_km?: number;
  bearing_deg?: number;
}
interface Explore {
  web: boolean;
  sites: RawSite[];
  env: { id: string; title: string; facts: ArFact[] }[];
}

const rad = (d: number) => (d * Math.PI) / 180;
const plane = (lat: number, lon: number) => {
  const r = 2 * R * Math.tan(rad(lat + 90) / 2);
  return [r * Math.sin(rad(lon)), r * Math.cos(rad(lon))] as const;
};
/** Great-circle distance (km) and game-frame heading (0 = +Z, clockwise toward +X) between two lat/lon points. */
export function range(lat: number, lon: number, lat2: number, lon2: number) {
  const a = Math.sin(rad(lat2 - lat) / 2) ** 2 + Math.cos(rad(lat)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon) / 2) ** 2;
  const distKm = 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
  const [ax, ay] = plane(lat, lon);
  const [bx, by] = plane(lat2, lon2);
  const bearing = ((Math.atan2(bx - ax, -(by - ay)) * 180) / Math.PI + 360) % 360;
  return { distKm, bearing };
}

const info = (s: RawSite): ArInfo => ({
  id: s.id,
  kind: "heritage",
  title: s.title,
  blurb: [s.agency, s.year].filter(Boolean).join(" ") + (s.left?.length ? ` - ${s.left.slice(0, 2).join(", ")}` : ""),
  facts: s.facts,
  left: s.left,
  image: s.image ?? null,
  agency: s.agency,
  year: s.year,
});

function apply(sites: RawSite[], lat: number, lon: number, env: Explore["env"], online: boolean) {
  const list: Site[] = sites
    .map((s) => {
      const r = s.distance_km != null && s.bearing_deg != null ? { distKm: s.distance_km, bearing: s.bearing_deg } : range(lat, lon, s.lat, s.lon);
      return { id: s.id, distKm: r.distKm, bearing: r.bearing };
    })
    .sort((a, b) => a.distKm - b.distKm);
  // env facts from the API extend the local tags that name them
  const envBy = new Map(env.map((e) => [e.id, e]));
  const local = LOCAL.map((i) => {
    const e = i.env ? envBy.get(i.env) : undefined;
    return e ? { ...i, facts: [...i.facts, ...e.facts.filter((x) => !i.facts.some((y) => y.text === x.text))] } : i;
  });
  useAr.getState().setInfos([...local, ...sites.map(info)]);
  useAr.setState({ sites: list, online });
}

/** Fetch once per explore session. The bundled data is applied first so tags work immediately and offline. */
export async function loadHeritage(lat: number, lon: number) {
  apply(bundled.sites as RawSite[], lat, lon, [], false);
  try {
    const d = await api<Explore>(`/surface/explore?lat=${lat}&lon=${lon}`);
    apply(d.sites, lat, lon, d.env, true);
  } catch {
    useAr.setState({ online: false });
  }
}

/** Lazy SerpApi/NASA extras for one tag the first time it is opened. */
export async function enrich(id: string) {
  const cur = useAr.getState().infos[id];
  if (!cur || cur.enriched || useAr.getState().online === false) return;
  const key = cur.kind === "heritage" ? id : cur.env;
  useAr.getState().merge(id, { enriched: true });
  if (!key) return;
  try {
    const d = await api<{ web: ArFact[]; image: ArImage | null }>(`/surface/explore/item?id=${encodeURIComponent(key)}`);
    const have = useAr.getState().infos[id];
    if (!have) return;
    const facts = [...have.facts, ...d.web.filter((w) => !have.facts.some((x) => x.text === w.text))];
    useAr.getState().merge(id, { facts, image: have.image ?? d.image });
  } catch {
    /* the curated facts stay */
  }
}
