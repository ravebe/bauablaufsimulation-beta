// SelectionTools.tsx — Mausklick-Zuweisung + Entfernen-Button
import { useState } from "react";
import type { SimProjekt, Task } from "../types";
import type { ApiInstance } from "../hooks/useApi";
import { filterEchteBauteile } from "./modelHelpers";

interface Props {
  aktivTask: Task | null;
  aktiveSim: SimProjekt | null;
  api: ApiInstance | null;
  updateSim: (sim: SimProjekt) => void;
  selGuids: Set<string>;
}

export default function SelectionTools({ aktivTask, aktiveSim, api, updateSim, selGuids }: Props) {
  const [status, setStatus] = useState<string | null>(null);
  const [laedt, setLaedt] = useState(false);
  const [entfernenBestaetigen, setEntfernenBestaetigen] = useState(false);

  const selCount = selGuids.size;

  // Status bei Klick löschen
  function clearStatus() {
    if (status) {
      const handler = () => setStatus(null);
      setTimeout(() => document.addEventListener("click", handler, { once: true }), 300);
    }
  }

  async function hinzufuegen() {
    if (!aktivTask || !aktiveSim || !api) return;
    setLaedt(true); setStatus(null);
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
      if (neueGuids.length === 0) { setStatus("Keine neuen Bauteile"); return; }

      // Konflikte prüfen
      const details: { name: string; anzahl: number }[] = [];
      for (const t of aktiveSim.tasks) {
        if (t.id === aktivTask.id) continue;
        const overlap = t.objektGuids.filter(g => neueGuids.includes(g)).length;
        if (overlap > 0) details.push({ name: t.name, anzahl: overlap });
      }
      if (details.length > 0) {
        const msg = details.map(d => `• ${d.anzahl} aus „${d.name}"`).join("\n");
        if (!window.confirm(`Objekte werden von anderen Tasks entfernt:\n${msg}\n\nFortfahren?`)) { setStatus("Abgebrochen"); return; }
      }

      const bereinigteTasks = aktiveSim.tasks.map(t =>
        t.id === aktivTask.id
          ? { ...t, objektGuids: [...new Set([...t.objektGuids, ...neueGuids])] }
          : { ...t, objektGuids: t.objektGuids.filter(g => !neueGuids.includes(g)) }
      );
      updateSim({ ...aktiveSim, tasks: bereinigteTasks });
      setStatus(`✓ ${neueGuids.length} hinzugefügt`);
    } catch (e) { setStatus(`Fehler: ${e instanceof Error ? e.message : String(e)}`); }
    finally { setLaedt(false); clearStatus(); }
  }

  function entfernenAusfuehren() {
    if (!aktiveSim) return;
    // Alle selektierten Guids aus ALLEN Tasks entfernen
    const zuEntfernen = selGuids;
    const betroffene: { name: string; anzahl: number }[] = [];
    for (const t of aktiveSim.tasks) {
      const overlap = t.objektGuids.filter(g => zuEntfernen.has(g)).length;
      if (overlap > 0) betroffene.push({ name: t.name, anzahl: overlap });
    }
    const bereinigteTasks = aktiveSim.tasks.map(t => ({
      ...t, objektGuids: t.objektGuids.filter(g => !zuEntfernen.has(g))
    }));
    updateSim({ ...aktiveSim, tasks: bereinigteTasks });
    setEntfernenBestaetigen(false);
    const total = betroffene.reduce((s, b) => s + b.anzahl, 0);
    setStatus(`✓ ${total} Bauteile aus ${betroffene.length} Tasks entfernt`);
    clearStatus();
  }

  return (
    <div className="detail-block">

      {entfernenBestaetigen ? (
        <div style={{ background: "#FEF2F2", border: "1px solid #FCA5A5", borderRadius: 0, padding: 8, fontSize: 11 }}>
          <div style={{ fontWeight: 600, color: "#DC2626", marginBottom: 4 }}>
            ⚠ {selCount} markierte Bauteile aus allen Tasks entfernen?
          </div>
          <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
            <button className="tc-btn-primary" style={{ flex: 1, background: "#DC2626", borderColor: "#DC2626", fontSize: 11 }}
              onClick={entfernenAusfuehren}>Ja, entfernen</button>
            <button className="tc-btn-ghost" style={{ flex: 1, fontSize: 11 }}
              onClick={() => setEntfernenBestaetigen(false)}>Abbrechen</button>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 4 }}>
          <button
            className="tc-btn-primary"
            style={{ flex: 1, background: selCount > 0 ? "#6cc07a" : undefined, borderColor: selCount > 0 ? "#6cc07a" : undefined }}
            disabled={laedt || !aktivTask || selCount === 0}
            onClick={hinzufuegen}
          >
            {laedt ? "⟳ …" : selCount > 0 ? `${selCount} Objekte hinzufügen` : "Bauteil(e) anklicken…"}
          </button>
          {selCount > 0 && (
            <button className="tc-btn-ghost" style={{ padding: "4px 8px", fontSize: 13 }}
              title="Markierte aus allen Tasks entfernen"
              onClick={() => setEntfernenBestaetigen(true)}>🗑</button>
          )}
        </div>
      )}

      {status && (
        <div className={`alert ${status.startsWith("✓") ? "ok" : "err"}`} style={{ marginTop: 5 }}>{status}</div>
      )}
    </div>
  );
}
