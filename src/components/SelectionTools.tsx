// SelectionTools.tsx — Mausklick-Zuweisung (ganz unten im Layout)
import { useState, useEffect, useRef } from "react";
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
  const [selCount, setSelCount] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Selektion alle 1.5s abfragen um Anzahl anzuzeigen
  useEffect(() => {
    if (!api) return;
    async function check() {
      try {
        const sel = await (api!.viewer as any).getSelection();
        let count = 0;
        if (Array.isArray(sel)) {
          for (const s of sel) {
            count += s?.objectRuntimeIds?.length ?? s?.objects?.length ?? 0;
          }
        }
        setSelCount(count);
      } catch { setSelCount(0); }
    }
    check();
    intervalRef.current = setInterval(check, 1500);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [api]);

  async function hinzufuegen() {
    if (!aktivTask || !aktiveSim || !api) return;
    setLaedt(true);
    setStatus(null);
    try {
      const result = await (api.viewer as any).getObjects({ selected: true }) as any[];
      if (!Array.isArray(result) || result.length === 0) {
        setStatus("Keine Objekte ausgewählt");
        return;
      }
      const neueGuids: string[] = [];
      const bereitsImTask = new Set(aktivTask.objektGuids);
      const fallbackMid = aktiveSim.modelle[0]?.id ?? "";
      for (const r of result) {
        const mid: string = r?.modelId ?? r?.id ?? fallbackMid;
        if (!mid) continue;
        const rIds: number[] = [];
        for (const rId of r?.objectRuntimeIds ?? []) { const n = Number(rId); if (!isNaN(n)) rIds.push(n); }
        for (const o of r?.objects ?? []) { const n = Number(o?.id ?? o); if (!isNaN(n)) rIds.push(n); }
        if (rIds.length === 0) continue;
        const echte = await filterEchteBauteile(api, mid, rIds);
        for (const rId of echte) {
          const key = `${mid}:::${rId}`;
          if (!bereitsImTask.has(key)) neueGuids.push(key);
        }
      }
      if (neueGuids.length === 0) {
        setStatus("Keine neuen Bauteile in Selektion");
        return;
      }

      // Konflikte prüfen: welche GUIDs sind bereits in anderen Tasks?
      const konflikte = new Map<string, number>();
      for (const t of aktiveSim.tasks) {
        if (t.id === aktivTask.id) continue;
        const overlap = t.objektGuids.filter(g => neueGuids.includes(g)).length;
        if (overlap > 0) konflikte.set(t.name, overlap);
      }
      if (konflikte.size > 0) {
        const details = [...konflikte.entries()].map(([name, n]) => `  • ${n} aus „${name}"`).join("\n");
        if (!window.confirm(`Objekte werden von anderen Tasks entfernt:\n${details}\n\nFortfahren?`)) {
          setStatus("Abgebrochen");
          return;
        }
      }

      // Exklusive Zuweisung: aus anderen Tasks entfernen
      const bereinigteTasks = aktiveSim.tasks.map(t =>
        t.id === aktivTask.id
          ? { ...t, objektGuids: [...new Set([...t.objektGuids, ...neueGuids])] }
          : { ...t, objektGuids: t.objektGuids.filter(g => !neueGuids.includes(g)) }
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
      <button
        className="tc-btn-primary"
        style={{ width: "100%", background: selCount > 0 ? "#16a34a" : undefined, borderColor: selCount > 0 ? "#16a34a" : undefined }}
        disabled={laedt || !aktivTask || selCount === 0}
        onClick={hinzufuegen}
      >
        {laedt
          ? "⟳ Lese Selektion…"
          : selCount > 0
            ? `${selCount} Objekt${selCount > 1 ? "e" : ""} hinzufügen`
            : "Bauteil(e) im Viewer anklicken…"
        }
      </button>
      {status && (
        <div className={`alert ${status.startsWith("✓") ? "ok" : status === "Abgebrochen" ? "info" : "err"}`} style={{ marginTop: 5 }}>
          {status}
        </div>
      )}
    </div>
  );
}
