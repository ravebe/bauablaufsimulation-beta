// useAusgeschlosseneAusblenden.ts — aus der aktiven Simulation entfernte Bauteile im Modell ausblenden:
// beim Aktivieren einer Simulation, sobald (weitere) Modelle geladen sind und wann immer sich die Liste
// ändert. Wieder aufgenommene Bauteile werden eingeblendet. Die Wiedergabe (Tab Abspielen) zeigt nur
// Bauteile von Tasks — ausgeschlossene bleiben dort also von selbst ausgeblendet.
import { useEffect, useRef } from "react";
import type { SimProjekt } from "../types";
import type { ApiInstance } from "./useApi";
import { guidsZuBatch } from "../components/modelHelpers";
import { mitTimeout } from "./mitTimeout";

async function setzeSichtbar(api: ApiInstance, guids: string[], visible: boolean) {
  const batch = guidsZuBatch(guids);
  if (batch.length === 0) return;
  try {
    await mitTimeout(api.viewer.setObjectState({ modelObjectIds: batch }, { visible }), 30000, "Ausblenden");
  } catch (e) { console.warn("[Ausschluss] Ein-/Ausblenden fehlgeschlagen:", e); }
}

export function useAusgeschlosseneAusblenden(api: ApiInstance | null, aktiveSim: SimProjekt | null, geladeneModelle: { id: string }[]) {
  const vorher = useRef<{ simId: string | null; guids: Set<string> }>({ simId: null, guids: new Set() });
  const schluessel = (aktiveSim?.ausgeschlossen ?? []).map(a => a.guid).sort().join("|");
  const modelle = geladeneModelle.map(m => m.id).sort().join("|");

  useEffect(() => {
    if (!api) return;
    const jetzt = new Set((aktiveSim?.ausgeschlossen ?? []).map(a => a.guid));
    const simGewechselt = vorher.current.simId !== (aktiveSim?.id ?? null);
    // Wieder aufgenommen (nur innerhalb derselben Sim — beim Wechsel bleibt der Modellzustand der neuen Sim überlassen)
    const wiederDa = simGewechselt ? [] : [...vorher.current.guids].filter(g => !jetzt.has(g));
    vorher.current = { simId: aktiveSim?.id ?? null, guids: jetzt };
    if (wiederDa.length) void setzeSichtbar(api, wiederDa, true);
    if (jetzt.size) void setzeSichtbar(api, [...jetzt], false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, aktiveSim?.id, schluessel, modelle]);
}
