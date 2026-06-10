// SelectionTools.tsx — Mausklick-Zuweisung
// Nutzt getObjects({selected: true}) direkt statt selektion-Prop (App.tsx gibt selektion nicht weiter)
import { useState } from "react";
import type { SimProjekt, Task } from "../types";
import type { ApiInstance } from "../hooks/useApi";
import { filterEchteBauteile } from "./modelHelpers";

interface Props {
  aktivTask: Task | null;
  aktiveSim: SimProjekt | null;
  api: ApiInstance | null;
  updateSim: (sim: SimProjekt) => void;
}

export default function SelectionTools({ aktivTask, aktiveSim, api, updateSim }: Props) {
  const [status, setStatus] = useState<string | null>(null);
  const [laedt, setLaedt] = useState(false);

  async function hinzufuegen() {
    if (!aktivTask || !aktiveSim || !api) return;
    setLaedt(true);
    setStatus(null);
    try {
      const result = await (api.viewer as any).getObjects({ selected: true }) as any[];
      console.log("[SelectionTools] result:", JSON.stringify(result?.slice?.(0, 2)));

      if (!Array.isArray(result) || result.length === 0) {
        setStatus("Keine Objekte ausgewählt");
        return;
      }

      const neueGuids: string[] = [];
      const bereitsImTask = new Set(aktivTask.objektGuids);
      // Fallback: erstes Modell der Sim wenn response kein modelId hat
      const fallbackMid = aktiveSim.modelle[0]?.id ?? "";

      for (const r of result) {
        // Beide mögliche Felder für modelId probieren
        const mid: string = r?.modelId ?? r?.id ?? fallbackMid;
        if (!mid) { console.log("[SelectionTools] kein mid in:", JSON.stringify(r)); continue; }

        // Beide response-Formate: {objectRuntimeIds:[N]} und {objects:[{id:N}]}
        const rIds: number[] = [];
        for (const rId of r?.objectRuntimeIds ?? []) { const n = Number(rId); if (!isNaN(n)) rIds.push(n); }
        for (const o of r?.objects ?? []) { const n = Number(o?.id ?? o); if (!isNaN(n)) rIds.push(n); }

        console.log("[SelectionTools] mid:", mid, "rIds:", rIds);
        if (rIds.length === 0) continue;

        const echte = await filterEchteBauteile(api, mid, rIds);
        console.log("[SelectionTools] echte:", echte);
        for (const rId of echte) {
          const key = `${mid}:::${rId}`;
          if (!bereitsImTask.has(key)) neueGuids.push(key);
        }
      }

      if (neueGuids.length === 0) {
        setStatus("Keine neuen Bauteile in Selektion");
        return;
      }

      const bereinigteTasks = aktiveSim.tasks.map(t =>
        t.id === aktivTask.id
          ? { ...t, objektGuids: [...new Set([...t.objektGuids, ...neueGuids])] }
          : t
      );
      updateSim({ ...aktiveSim, tasks: bereinigteTasks });
      setStatus(`✓ ${neueGuids.length} Bauteile hinzugefügt`);
    } catch (e) {
      setStatus(`Fehler: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLaedt(false);
    }
  }

  return (
    <div className="detail-block">
      <div className="detail-block-title">Mausklick Zuweisung</div>
      <div style={{ fontSize: 10, color: "var(--tc-text-3)", marginBottom: 5 }}>
        Objekte im 3D-Viewer anklicken, dann hinzufügen:
      </div>
      <button
        className="tc-btn-primary"
        style={{ width: "100%", background: "#16a34a", borderColor: "#16a34a" }}
        disabled={laedt || !aktivTask}
        onClick={hinzufuegen}
      >
        {laedt ? "⟳ Lese Selektion…" : "➕ Ausgewählte Bauteile hinzufügen"}
      </button>
      {status && (
        <div className={`alert ${status.startsWith("✓") ? "ok" : "err"}`} style={{ marginTop: 5 }}>
          {status}
        </div>
      )}
    </div>
  );
}