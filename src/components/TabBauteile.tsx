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
  aktivesModellId: string | null;
}

interface AttrItem { pset: string; name: string; key: string; }

export default function TabBauteile({ api, aktiveSim, updateSim, selektion, aktivesModellId }: Props) {
  const [aktivTaskId, setAktivTaskId] = useState<string | null>(null);
  const [allAttrs, setAllAttrs] = useState<AttrItem[]>([]);
  const [ifcQuery, setIfcQuery] = useState("");
  const [ifcWert, setIfcWert] = useState("");
  const [acOffen, setAcOffen] = useState(false);
  const [suchStatus, setSuchStatus] = useState<string | null>(null);
  const [gefundeneIds, setGefundeneIds] = useState<number[]>([]);
  const [laedt, setLaedt] = useState(false);
  const [attrLaedt, setAttrLaedt] = useState(false);
  const acRef = useRef<HTMLDivElement>(null);

  const aktivTask = aktiveSim?.tasks.find(t => t.id === aktivTaskId) ?? null;

  // Immer aktivesModellId vom Viewer nutzen
  const modellId = aktivesModellId;

  // Autocomplete schließen bei Klick außerhalb
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (acRef.current && !acRef.current.contains(e.target as Node)) setAcOffen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Attribute laden wenn Task gewechselt oder modellId verfügbar
  useEffect(() => {
    setSuchStatus(null);
    setGefundeneIds([]);
    setIfcQuery("");
    setIfcWert("");
    setAllAttrs([]);
    if (aktivTaskId && api) {
      ladeAttr();
    }
  }, [aktivTaskId, aktivesModellId]);

  // Attribute vorladen — findet automatisch das richtige Modell
  async function ladeAttr() {
    if (!api) return;
    setAttrLaedt(true);
    try {
      // Alle Modelle holen und erstes mit sichtbaren Objekten und Properties nutzen
      const alleModelle = await api.viewer.getModels() as any[];
      // Modelle priorisieren: aktivesModellId zuerst
      const sortiert = aktivesModellId
        ? [{ modelId: aktivesModellId }, ...alleModelle.filter(m => m.modelId !== aktivesModellId)]
        : alleModelle;

      for (const m of sortiert) {
        const mid = m.modelId;
        if (!mid) continue;
        try {
          // Nur sichtbare Objekte
          const rohe = await (api.viewer as any).getObjects(mid, undefined, { visible: true });
          const ids = parseObjectIds(rohe).slice(0, 60);
          if (ids.length === 0) continue;

          const props = await batchGetProperties(api, mid, ids);
          if (!props.some(p => p.properties?.length > 0)) continue;

          // Dieses Modell hat Properties!
          const attrsMap = new Map<string, AttrItem>();
          for (const obj of props) {
            for (const g of (obj?.properties ?? [])) {
              const pset = g?.name || (g as any)?.displayName || "Eigenschaften";
              for (const p of (g?.properties ?? [])) {
                if (!p?.name) continue;
                const key = `${pset}||${p.name}`;
                if (!attrsMap.has(key)) attrsMap.set(key, { pset, name: p.name, key });
              }
            }
          }
          setAllAttrs([...attrsMap.values()]);
          return; // Gefunden — fertig
        } catch { continue; }
      }
    } catch (e) {
      console.error("ladeAttr Fehler:", e);
    } finally {
      setAttrLaedt(false);
    }
  }

  // Autocomplete filtern (in Memory — kein API-Call)
  const acItems = ifcQuery.length >= 2
    ? allAttrs.filter(a =>
        `${a.name} ${a.pset}`.toLowerCase().includes(ifcQuery.toLowerCase())
      ).slice(0, 20)
    : [];

  // IFC Suche
  async function ifcSuchen() {
    if (!api || !ifcQuery || !ifcWert || !aktivTask) return;
    setSuchStatus(null);
    setGefundeneIds([]);
    setLaedt(true);

    try {
      const teile = ifcQuery.split(" › ");
      const suchAttr = teile[0]?.trim().toLowerCase();
      const suchPset = teile[1]?.trim().toLowerCase() ?? "";

      const alleModelle = await api.viewer.getModels() as any[];
      const sortiert = aktivesModellId
        ? [{ modelId: aktivesModellId }, ...alleModelle.filter(m => m.modelId !== aktivesModellId)]
        : alleModelle;

      const gefunden: number[] = [];

      for (const m of sortiert) {
        const mid = m.modelId;
        if (!mid) continue;
        try {
          const rohe = await (api.viewer as any).getObjects(mid, undefined, { visible: true });
          const ids = parseObjectIds(rohe);
          if (ids.length === 0) continue;

          for (let i = 0; i < ids.length; i += 10) {
            const batch = ids.slice(i, i + 10);
            const props = await batchGetProperties(api, mid, batch);
            for (const obj of props) {
              for (const g of (obj?.properties ?? [])) {
                const pset = (g?.name || (g as any)?.displayName || "").toLowerCase();
                const psetMatch = !suchPset || pset === suchPset || pset.includes(suchPset) || suchPset.includes(pset);
                if (!psetMatch) continue;
                for (const p of (g?.properties ?? [])) {
                  if (!p?.name || p.name.toLowerCase() !== suchAttr) continue;
                  if (p.value != null && String(p.value).toLowerCase().includes(ifcWert.toLowerCase())) {
                    gefunden.push(obj.id);
                    break;
                  }
                }
              }
            }
          }
          if (gefunden.length > 0) break;
        } catch { continue; }
      }

      if (gefunden.length === 0) {
        setSuchStatus("Keine Bauteile gefunden");
        return;
      }

      // Im Viewer markieren
      await api.viewer.setSelection(gefunden);
      setGefundeneIds(gefunden);
      setSuchStatus(`✓ ${gefunden.length} Bauteile gefunden & markiert`);
    } catch (e) {
      setSuchStatus(`Fehler: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLaedt(false);
    }
  }

  // Gefundene Bauteile hinzufügen (nach Bestätigung)
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

      {/* Gantt Liste */}
      <div className="gantt-section">
        <div className="gantt-section-header">
          <span>Gantt · {aktiveSim.tasks.length} Tasks</span>
          {totalZugewiesen > 0 && (
            <span style={{ color: "var(--tc-blue)", fontSize: 9 }}>⬡ {totalZugewiesen} gesamt</span>
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

          {/* Task Header */}
          <div className="detail-header">
            <span className={`task-row-dot ${aktivTask.typ}`} style={{ width: 8, height: 8 }} />
            <span className="detail-task-name">{aktivTask.name}</span>
            <span style={{ fontSize: 9, color: "var(--tc-blue)", fontWeight: 500 }}>
              ⬡ {aktivTask.objektGuids.length}
            </span>
          </div>

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
            <div className="detail-block-title">
              IFC-Attribut Filter
              {attrLaedt && <span style={{ color: "var(--tc-text-3)", fontWeight: 400, marginLeft: 6 }}>⟳ lädt…</span>}
              {!attrLaedt && allAttrs.length > 0 && <span style={{ color: "var(--tc-text-3)", fontWeight: 400, marginLeft: 6 }}>{allAttrs.length} Attribute</span>}
            </div>

            <div className="ac-wrap" ref={acRef}>
              <input
                className="ac-input"
                placeholder="Attribut suchen… (z.B. Material)"
                value={ifcQuery}
                onChange={e => { setIfcQuery(e.target.value); setAcOffen(true); setGefundeneIds([]); setSuchStatus(null); }}
                onFocus={() => setAcOffen(true)}
                disabled={!modellId}
              />
              {acOffen && acItems.length > 0 && (
                <div className="ac-dropdown">
                  {acItems.map((item, i) => (
                    <div key={i} className="ac-item"
                      onMouseDown={() => {
                        setIfcQuery(`${item.name} › ${item.pset}`);
                        setAcOffen(false);
                      }}>
                      <span style={{ fontWeight: 500 }}>{item.name}</span>
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
              disabled={!modellId}
            />

            <button
              className="tc-btn-primary"
              style={{ width: "100%", marginTop: 6 }}
              disabled={laedt || !ifcQuery || !ifcWert || !modellId}
              onClick={ifcSuchen}
            >
              {laedt ? "⟳ Suche…" : "🔍 Suchen & Markieren"}
            </button>

            {suchStatus && (
              <div className={`alert ${suchStatus.startsWith("✓") ? "ok" : "err"}`} style={{ marginTop: 5 }}>
                {suchStatus}
              </div>
            )}

            {gefundeneIds.length > 0 && (
              <button className="tc-btn-green" style={{ width: "100%", marginTop: 6 }}
                onClick={gefundeneHinzufuegen}>
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
                    <button className="tc-btn-ghost" onClick={() => markieren(aktivTask.objektGuids)}>
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
