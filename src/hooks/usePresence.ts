// usePresence.ts — "wer bearbeitet gerade mit": leichter Heartbeat alle 25 s, nur wenn ich die aktive
// Simulation bearbeiten darf UND sie mit Bearbeitungsrechten geteilt ist. Liefert den Namen der anderen
// Person, falls sie gerade in derselben Simulation ist. Kein Dauer-Polling nebenher.
import { useEffect, useRef, useState } from "react";
import type { SimProjekt } from "../types";
import type { ApiInstance } from "./useApi";
import { sendPresence } from "./useApi";
import { darfBearbeiten, mitBearbeitungGeteilt } from "../zugriff";

export function usePresence(api: ApiInstance | null, aktiveSim: SimProjekt | null, userId: string | null, userName: string): string | null {
  const [andererBearbeiter, setAndererBearbeiter] = useState<string | null>(null);
  const aktiveSimRef = useRef(aktiveSim);
  useEffect(() => { aktiveSimRef.current = aktiveSim; });

  useEffect(() => {
    if (!api || !userId) return;
    let abgebrochen = false;
    const heartbeat = async () => {
      const sim = aktiveSimRef.current;
      if (!sim || !darfBearbeiten(sim, userId) || !mitBearbeitungGeteilt(sim, userId)) {
        if (!abgebrochen) setAndererBearbeiter(null);
        return;
      }
      const presence = await sendPresence(api, sim.id, userId, userName || "Kollege");
      if (abgebrochen) return;
      const andere = Object.entries(presence).find(([uid, e]) => uid !== userId && e.simId === sim.id);
      setAndererBearbeiter(andere ? andere[1].name : null);
    };
    heartbeat();
    const interval = setInterval(heartbeat, 25000);
    return () => { abgebrochen = true; clearInterval(interval); };
  }, [api, userId, userName]);

  return api && userId ? andererBearbeiter : null;
}
