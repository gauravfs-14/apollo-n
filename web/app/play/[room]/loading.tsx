import { LoadingScreen } from "@/game/ui/LoadingScreen";

// Shown while the play route itself loads (navigating from the menu).
export default function Loading() {
  return <LoadingScreen visible phase="select" status="Contacting Houston…" progress={null} />;
}
