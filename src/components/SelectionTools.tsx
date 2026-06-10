// SelectionTools.tsx — Mausklick-Zuweisung (ganz unten)
import { useState, useEffect, useRef } from "react";
import type { SimProjekt, Task } from "../types";
import type { ApiInstance } from "../hooks/useApi";
import { filterEchteBauteile } from "./modelHelpers";

interface Konflikt { details: { name: string; anzahl: number }[]; guids: string[]; }

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
  const [konflikt, setKonflikt] = useState<Konflikt | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!api) return;
    async function check() {
      try {
        const sel = await (api!.viewer as any).getSelection();
        let count = 0;
        if (Array.isArray(sel)) {
          for (const s of sel) count += s?.objectRuntimeIds?.length ?? s?.objects?.length ?? 0;
        }
        setSelCount(count);
      } catch { setSelCount(0); }
    }
    check();
    intervalRef.current = setInterval(check, 1500);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [api]);

  // Status bei nächstem Klick irgendwo löschen
  useEffect(() => {
    if (!status) return;
    const handler = () => { setStatus(null); };
    const timer = setTimeout(() => document.addEventListener("click", handler, { once: true }), 300);
    return () => { clearTimeout(timer); document.removeEventListener("click", handler); };
  }, [status]);

  function zuweisen(guids: string[]) {
    if (!aktivTask || !aktiveSim) return;
    const bereinigteTasks = aktiveSim.tasks.map(t =>
      t.id === aktivTask.id
        ? { ...t, objektGuids: [...new Set([...t.objektGuids, ...guids])] }
        : { ...t, objektGuids: t.objektGuids.filter(g => !guids.includes(g)) }
    );
    updateSim({ ...aktiveSim, tasks: bereinigteTasks });
    setStatus(`✓ ${guids.length} Bauteile hinzugefügt`);
    setSelCount(0);
    setKonflikt(null);
  }

  async function hinzufuegen() {
    if (!aktivTask || !aktiveSim || !api) return;
    setLaedt(true); setStatus(null); setKonflikt(null);
    try {
      const result = await (api.viewer as any).getObjects({ selected: true }) as any[];
      if (!Array.isArray(result) || result.length === 0) { setStatus("Keine Objekte ausgewählt"); return; }
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
        for (const rId of echte) { const key = `${mid}:::${rId}`; if (!bereitsImTask.has(key)) neueGuids.push(key); }
      }
      if (neueGuids.length === 0) { setStatus("Keine neuen Bauteile in Selektion"); return; }

      // Konflikte prüfen
      const details: { name: string; anzahl: number }[] = [];
      for (const t of aktiveSim.tasks) {
        if (t.id === aktivTask.id) continue;
        const overlap = t.objektGuids.filter(g => neueGuids.includes(g)).length;
        if (overlap > 0) details.push({ name: t.name, anzahl: overlap });
      }
      if (details.length > 0) {
        setKonflikt({ details, guids: neueGuids });
      } else {
        zuweisen(neueGuids);
      }
    } catch (e) {
      setStatus(`Fehler: ${e instanceof Error ? e.message : String(e)}`);
    } finally { setLaedt(false); }
  }

  return (
    <div className="detail-block">
      <div className="detail-block-title">Mausklick Zuweisung</div>

      {konflikt ? (
        <div style={{ background: "#FFF7ED", border: "1px solid #FB923C", borderRadius: 6, padding: 8, fontSize: 11 }}>
          <div style={{ fontWeight: 600, color: "#C2410C", marginBottom: 4 }}>⚠ Objekte in anderen Tasks:</div>
          {konflikt.details.map((k, i) => (
            <div key={i} style={{ color: "#9A3412" }}>• {k.anzahl} aus „{k.name}"</div>
          ))}
          <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
            <button className="tc-btn-primary" style={{ flex: 1, background: "#16a34a", borderColor: "#16a34a", fontSize: 11 }}
              onClick={() => zuweisen(konflikt.guids)}>Verschieben</button>
            <button className="tc-btn-ghost" style={{ flex: 1, fontSize: 11 }}
              onClick={() => { setKonflikt(null); setStatus("Abgebrochen"); }}>Abbrechen</button>
          </div>
        </div>
      ) : (
        <button
          className="tc-btn-primary"
          style={{ width: "100%", background: selCount > 0 ? "#16a34a" : undefined, borderColor: selCount > 0 ? "#16a34a" : undefined }}
          disabled={laedt || !aktivTask || selCount === 0}
          onClick={hinzufuegen}
        >
          {laedt ? "⟳ Lese Selektion…"
            : selCount > 0 ? `${selCount} Objekt${selCount > 1 ? "e" : ""} hinzufügen`
            : "Bauteil(e) im Viewer anklicken…"}
        </button>
      )}

      {status && (
        <div className={`alert ${status.startsWith("✓") ? "ok" : "err"}`} style={{ marginTop: 5 }}>
          {status}
        </div>
      )}
    </div>
  );
}
