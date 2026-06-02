import { useState, useEffect, useRef } from "react";
import type { SimProjekt, TaskTyp } from "../types";
import { parseObjectIds } from "../types";
import type { ApiInstance } from "../hooks/useApi";
import { batchGetProperties } from "../hooks/useApi";

interface Props {
  api: ApiInstance | null;
  aktiveSim: SimProjekt | null;
  updateSim: (sim: SimProjekt) => void;
  selektion: number[];
}

interface AcItem { pset: string; attr: string; label: string; }

export default function TabBauteile({ api, aktiveSim, updateSim, selektion }: Props) {
  const [aktivTaskId, setAktivTaskId] = useState<string | null>(null);
  const [ifcQuery, setIfcQuery] = useState("");
  const [ifcWert, setIfcWert] = useState("");
  const [acItems, setAcItems] = useState<AcItem[]>([]);
  const [acOffen, setAcOffen] = useState(false);
  const [suchStatus, setSuchStatus] = useState<string | null>(null);
  const [gefundeneIds, setGefundeneIds] = useState<number[]>([]);
  const [laedt, setLaedt] = useState(false);
  const acRef = useRef<HTMLDivElement>(null);

  const aktivTask = aktiveSim?.tasks.find(t => t.id === aktivTaskId) ?? null;

  // Alle Modell-IDs der aktiven Simulation
  const simModellIds = aktiveSim?.modelle.map(m => m.id) ?? [];
  // Erstes verfügbares Modell (Simulation zuerst, dann Viewer-Fallback)
  
  // Autocomplete schließen bei Klick außerhalb
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (acRef.current && !acRef.current.contains(e.target as Node)) setAcOffen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Task wechsel → Filter zurücksetzen
  useEffect(() => {
    setSuchStatus(null);
    setGefundeneIds([]);
  }, [aktivTaskId]);

  // IFC Autocomplete — durchsucht alle Modelle der Simulation
  async function ladeAutocomplete(q: string) {
    if (!api || simModellIds.length === 0 || q.length < 2) { setAcItems([]); return; }
    try {
      const items: AcItem[] = [];
      const seen = new Set<string>();

      for (const mid of simModellIds) {
        const allIds = await api.viewer.getObjects(mid);
        const ids = parseObjectIds(allIds).slice(0, 30);
        if (ids.length === 0) continue;
        const props = await batchGetProperties(api, mid, ids);
        for (const obj of props) {
          for (const pset of obj.properties ?? []) {
            for (const attr of pset.properties ?? []) {
              // Format: Attributname › Pset_Name
              const label = `${attr.name} › ${pset.name}`;
              if (!seen.has(label) && label.toLowerCase().includes(q.toLowerCase())) {
                seen.add(label);
                items.push({ pset: pset.name, attr: attr.name, label });
              }
            }
          }
        }
        if (items.length >= 20) break;
      }

      setAcItems(items.slice(0, 20));
      setAcOffen(items.length > 0);
    } catch { setAcItems([]); }
  }

  // IFC Filter Suche — alle Modelle der Simulation
  async function ifcSuchen() {
    if (!api || simModellIds.length === 0 || !ifcQuery || !ifcWert || !aktivTask) return;
    setSuchStatus(null);
    setGefundeneIds([]);
    setLaedt(true);

    try {
      // Format: "Attributname › Pset_Name"
      const teile = ifcQuery.split(" › ");
      const attrName = teile[0]?.trim();
      const psetName = teile[1]?.trim();

      const alleGefunden: number[] = [];

      for (const mid of simModellIds) {
        const allIds = await api.viewer.getObjects(mid);
        const ids = parseObjectIds(allIds);
        if (ids.length === 0) continue;

        for (let i = 0; i < ids.length; i += 10) {
          const batch = ids.slice(i, i + 10);
          const props = await batchGetProperties(api, mid, batch);
          for (const obj of props) {
            for (const pset of obj.properties ?? []) {
              if (psetName && pset.name !== psetName) continue;
              const attr = pset.properties?.find(a => a.name === attrName);
              if (attr && attr.value?.toLowerCase().includes(ifcWert.toLowerCase())) {
                alleGefunden.push(obj.id);
                break;
              }
            }
          }
        }
      }

      if (alleGefunden.length === 0) {
        setSuchStatus("Keine Bauteile gefunden");
        return;
      }

      // Im Viewer markieren
      await api.viewer.setSelection(alleGefunden);
      setGefundeneIds(alleGefunden);
      setSuchStatus(`✓ ${alleGefunden.length} Bauteile gefunden & markiert`);
    } catch (e) {
      setSuchStatus(`Fehler: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLaedt(false);
    }
  }

  // Gefundene Bauteile zum Task hinzufügen (nach Bestätigung)
  function gefundeneHinzufuegen() {
    if (!aktivTask || gefundeneIds.length === 0) return;
    const neu = [...new Set([...aktivTask.objektGuids, ...gefundeneIds.map(String)])];
    speichereGuids(aktivTask.id, neu);
    setGefundeneIds([]);
    setSuchStatus(`✓ ${gefundeneIds.length} Bauteile hinzugefügt`);
  }

  // Mausklick-Selektion hinzufügen
  function selektionHinzufuegen() {
    if (!aktivTask || selektion.length === 0) return;
    const neu = [...new Set([...aktivTask.objektGuids, ...selektion.map(String)])];
    speichereGuids(aktivTask.id, neu);
  }

  function speichereGuids(taskId: string, guids: string[]) {
    if (!aktiveSim) return;
    updateSim({
      ...aktiveSim,
      tasks: aktiveSim.tasks.map(t => t.id === taskId ? { ...t, objektGuids: guids } : t),
    });
  }

  function guidEntfernen(taskId: string, guid: string) {
    if (!aktiveSim) return;
    updateSim({
      ...aktiveSim,
      tasks: aktiveSim.tasks.map(t =>
        t.id === taskId ? { ...t, objektGuids: t.objektGuids.filter(g => g !== guid) } : t
      ),
    });
  }

  function alleGuidsLoeschen(taskId: string) {
    speichereGuids(taskId, []);
  }

  function typAendern(taskId: string, typ: TaskTyp) {
    if (!aktiveSim) return;
    updateSim({
      ...aktiveSim,
      tasks: aktiveSim.tasks.map(t => t.id === taskId ? { ...t, typ } : t),
    });
  }

  async function markieren(guids: string[]) {
    if (!api) return;
    await api.viewer.setSelection(guids.map(Number));
  }

  // Zähler: total zugewiesene Bauteile über alle Tasks
  const totalZugewiesen = aktiveSim?.tasks.reduce((s, t) => s + t.objektGuids.length, 0) ?? 0;

  if (!aktiveSim) {
    return (
      <div className="tc-empty">
        <div className="tc-empty-icon">🔧</div>
        <div className="tc-empty-title">Keine aktive Simulation</div>
        <div className="tc-empty-sub">Bitte zuerst im Tab „Projekte" eine Simulation aktivieren</div>
      </div>
    );
  }

  return (
    <div className="tasklist-wrap">

      {/* Gantt Liste oben */}
      <div className="gantt-section">
        <div className="gantt-section-header">
          <span>Gantt · {aktiveSim.tasks.length} Tasks</span>
          {totalZugewiesen > 0 && (
            <span style={{ color: "var(--tc-blue)", fontSize: 9 }}>
              ⬡ {totalZugewiesen} gesamt
            </span>
          )}
        </div>

        {aktiveSim.tasks.length === 0 ? (
          <div style={{ padding: "10px", fontSize: 11, color: "var(--tc-text-3)", textAlign: "center" }}>
            Noch keine Tasks — Gantt in Tab „Projekte" importieren
          </div>
        ) : (
          aktiveSim.tasks.map(task => (
            <div
              key={task.id}
              className={`task-row ${task.id === aktivTaskId ? "active" : ""}`}
              onClick={() => setAktivTaskId(task.id === aktivTaskId ? null : task.id)}
            >
              <span className={`task-row-dot ${task.typ}`} />
              <span className="task-row-name">{task.name}</span>
              <span className="task-row-date">{task.start}</span>
              <span className="task-row-count">
                {task.objektGuids.length > 0
                  ? <span style={{ color: "var(--tc-blue)" }}>⬡ {task.objektGuids.length}</span>
                  : <span style={{ color: "var(--tc-border)" }}>∅</span>}
              </span>
            </div>
          ))
        )}
      </div>

      {/* Detail Panel */}
      {aktivTask ? (
        <div className="detail-section">

          {/* Task Header mit Zähler */}
          <div className="detail-header">
            <span className={`task-row-dot ${aktivTask.typ}`} style={{ width: 8, height: 8 }} />
            <span className="detail-task-name">{aktivTask.name}</span>
            <span style={{ fontSize: 9, color: "var(--tc-blue)", fontWeight: 500 }}>
              ⬡ {aktivTask.objektGuids.length}
            </span>
          </div>

          {/* Kein Modell Warnung */}
          {simModellIds.length === 0 && (
            <div className="alert err" style={{ marginBottom: 6 }}>
              ! Kein Modell in der Simulation — Tab „Projekte" → Modelle übernehmen
            </div>
          )}

          {/* Task-Typ */}
          <div className="detail-block">
            <div className="detail-block-title">Task-Typ</div>
            <div className="typ-btns">
              {(["neubau", "bestand", "abbruch"] as TaskTyp[]).map(typ => (
                <button
                  key={typ}
                  className={`typ-btn ${aktivTask.typ === typ ? `aktiv-${typ}` : ""}`}
                  onClick={() => typAendern(aktivTask.id, typ)}
                >
                  {typ === "neubau" ? "🟢" : typ === "bestand" ? "🟡" : "🔴"} {typ}
                </button>
              ))}
            </div>
          </div>

          {/* IFC Filter */}
          <div className="detail-block">
            <div className="detail-block-title">IFC-Attribut Filter</div>
            <div className="ac-wrap" ref={acRef}>
              <input
                className="ac-input"
                placeholder="Attribut › PSet suchen…"
                value={ifcQuery}
                onChange={e => { setIfcQuery(e.target.value); ladeAutocomplete(e.target.value); setGefundeneIds([]); setSuchStatus(null); }}
                onFocus={() => ifcQuery.length >= 2 && setAcOffen(acItems.length > 0)}
              />
              {acOffen && acItems.length > 0 && (
                <div className="ac-dropdown">
                  {acItems.map((item, i) => (
                    <div key={i} className="ac-item"
                      onMouseDown={() => { setIfcQuery(item.label); setAcOffen(false); }}>
                      <span style={{ fontWeight: 500 }}>{item.attr}</span>
                      <span style={{ color: "var(--tc-text-3)" }}> › {item.pset}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <input
              className="ac-input"
              placeholder="Wert (z.B. Beton NPK C)…"
              value={ifcWert}
              onChange={e => { setIfcWert(e.target.value); setGefundeneIds([]); setSuchStatus(null); }}
              style={{ marginTop: 4 }}
            />
            <button
              className="tc-btn-primary"
              style={{ width: "100%", marginTop: 6 }}
              disabled={laedt || !ifcQuery || !ifcWert || simModellIds.length === 0}
              onClick={ifcSuchen}
            >
              {laedt ? "⟳ Suche…" : "🔍 Suchen & Markieren"}
            </button>

            {suchStatus && (
              <div className={`alert ${suchStatus.startsWith("✓") ? "ok" : "err"}`} style={{ marginTop: 5 }}>
                {suchStatus}
              </div>
            )}

            {/* Bestätigungs-Button nach Suche */}
            {gefundeneIds.length > 0 && (
              <button
                className="tc-btn-green"
                style={{ width: "100%", marginTop: 6 }}
                onClick={gefundeneHinzufuegen}
              >
                + Gefundene hinzufügen ({gefundeneIds.length})
              </button>
            )}
          </div>

          {/* Mausklick */}
          <div className="detail-block">
            <div className="detail-block-title">Mausklick Zuweisung</div>
            <div className={`sel-status ${selektion.length > 0 ? "aktiv" : ""}`}>
              {selektion.length > 0
                ? `✓ ${selektion.length} Bauteil(e) im Viewer ausgewählt`
                : "Bauteil(e) im Viewer anklicken…"}
            </div>
            {selektion.length > 0 && (
              <button className="tc-btn-secondary" style={{ width: "100%", marginTop: 5 }}
                onClick={selektionHinzufuegen}>
                + Ausgewählte Bauteile hinzufügen ({selektion.length})
              </button>
            )}
          </div>

          {/* Zugewiesene Bauteile */}
          <div className="detail-block">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
              <div className="detail-block-title" style={{ margin: 0 }}>
                {aktivTask.objektGuids.length > 0
                  ? `${aktivTask.objektGuids.length} Bauteile zugewiesen`
                  : "Noch keine Bauteile zugewiesen"}
              </div>
              <div style={{ display: "flex", gap: 4 }}>
                {aktivTask.objektGuids.length > 0 && (
                  <>
                    <button className="tc-btn-ghost"
                      onClick={() => markieren(aktivTask.objektGuids)}>
                      👁 Markieren
                    </button>
                    <button className="tc-btn-ghost" style={{ color: "var(--tc-red)" }}
                      onClick={() => alleGuidsLoeschen(aktivTask.id)}>
                      🗑 Alle
                    </button>
                  </>
                )}
              </div>
            </div>

            {aktivTask.objektGuids.length > 0 && (
              <div className="guid-list">
                {aktivTask.objektGuids.map((g, i) => (
                  <div key={i} className="guid-row">
                    <span className="guid-row-id">{g}</span>
                    <button className="guid-row-x"
                      onClick={() => guidEntfernen(aktivTask.id, g)}>✕</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="detail-empty">↑ Task anklicken</div>
      )}
    </div>
  );
}
