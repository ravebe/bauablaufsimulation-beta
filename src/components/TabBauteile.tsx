import { useState, useEffect, useRef } from "react";
import type { SimProjekt, TaskTyp } from "../types";
import { parseObjectIds } from "../types";
import type { ApiInstance } from "../hooks/useApi";

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
  const [attrMap, setAttrMap] = useState<Record<string, Set<string>>>({});
  const [selectedAttr, setSelectedAttr] = useState<AttrItem | null>(null);
  const [ifcQuery, setIfcQuery] = useState("");
  const [ifcWert, setIfcWert] = useState("");
  const [acOffen, setAcOffen] = useState(false);
  const [suchStatus, setSuchStatus] = useState<string | null>(null);
  const [gefundeneIds, setGefundeneIds] = useState<number[]>([]);
  const [laedt, setLaedt] = useState(false);
  const [attrLaedt, setAttrLaedt] = useState(false);
  const [totalObjekte, setTotalObjekte] = useState<number | null>(null);
  const acRef = useRef<HTMLDivElement>(null);

  const aktivTask = aktiveSim?.tasks.find(t => t.id === aktivTaskId) ?? null;

  // Modell-ID: gespeicherte Sim-Modelle zuerst (korrekte Modelle!), dann Fallback
  const modellId = aktiveSim?.modelle[0]?.id ?? aktivesModellId ?? null;

  // Autocomplete schließen bei Klick außerhalb
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (acRef.current && !acRef.current.contains(e.target as Node)) setAcOffen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Sim oder Modell wechselt → Attribute sofort neu laden
  useEffect(() => {
    setAllAttrs([]);
    setAttrMap({});
    setSelectedAttr(null);
    if (api) ladeAttr();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aktiveSim?.id, aktivesModellId]);

  // Task wechselt → Suche zurücksetzen
  useEffect(() => {
    setSuchStatus(null);
    setGefundeneIds([]);
    setIfcQuery("");
    setIfcWert("");
    setSelectedAttr(null);
  }, [aktivTaskId]);

  // Total Objekte laden (für Zähler)
  useEffect(() => {
    if (!api || !modellId) return;
    (async () => {
      try {
        const rohe = await api.viewer.getObjects(modellId);
        setTotalObjekte(parseObjectIds(rohe).length);
      } catch { setTotalObjekte(null); }
    })();
  }, [modellId]);

  // Attribute vorladen — parallele Einzelabfragen (10 gleichzeitig), keine Batch-Kontamination
  async function ladeAttr() {
    if (!api) return;

    const modelIds = [...new Set([
      ...(aktiveSim?.modelle.map(m => m.id).filter(Boolean) ?? []),
      ...(aktivesModellId ? [aktivesModellId] : [])
    ])].filter(Boolean) as string[];

    if (modelIds.length === 0) return;
    setAttrLaedt(true);

    const map: Record<string, Set<string>> = {};
    const attrsMap = new Map<string, AttrItem>();

    const verarbeiteObj = (obj: any) => {
      for (const g of (obj?.properties ?? [])) {
        const pset = g?.name || (g as any)?.displayName || "Eigenschaften";
        for (const p of (g?.properties ?? [])) {
          if (!p?.name) continue;
          const key = `${pset}||${p.name}`;
          if (!attrsMap.has(key)) attrsMap.set(key, { pset, name: p.name, key });
          if (p.value != null) {
            if (!map[key]) map[key] = new Set();
            map[key].add(String(p.value));
          }
        }
      }
    };

    for (const mid of modelIds) {
      try {
        const rohe = await api.viewer.getObjects(mid);
        const allIds = parseObjectIds(rohe);
        if (allIds.length === 0) continue;

        // 10 parallele Einzelabfragen → keine Batch-Kontamination, volle Abdeckung
        const CONCURRENCY = 10;
        for (let i = 0; i < allIds.length; i += CONCURRENCY) {
          const chunk = allIds.slice(i, i + CONCURRENCY);
          const resultate = await Promise.allSettled(
            chunk.map(rId => api!.viewer.getObjectProperties(mid, [rId]))
          );
          for (const r of resultate) {
            if (r.status === 'fulfilled' && Array.isArray(r.value)) {
              for (const obj of r.value) verarbeiteObj(obj);
            }
          }
        }
      } catch { /* Modell überspringen */ }
    }

    setAttrMap(map);
    setAllAttrs([...attrsMap.values()]);
    setAttrLaedt(false);
  }

  // Autocomplete filtern (in Memory)
  const acItems = ifcQuery.length >= 1
    ? allAttrs.filter(a =>
        a.name.toLowerCase().startsWith(ifcQuery.toLowerCase()) ||
        a.pset.toLowerCase().startsWith(ifcQuery.toLowerCase())
      ).slice(0, 40)
    : [];

  // IFC Suche — batch=1 garantiert korrekte Runtime-ID (obj.id ist IFC-GUID, nicht Runtime-ID!)
  async function ifcSuchen() {
    if (!api || !selectedAttr || !ifcWert || !aktivTask) return;
    setSuchStatus(null);
    setGefundeneIds([]);
    setLaedt(true);

    const modelIds = [...new Set([
      ...(aktiveSim?.modelle.map(m => m.id).filter(Boolean) ?? []),
      ...(aktivesModellId ? [aktivesModellId] : [])
    ])].filter(Boolean) as string[];

    if (modelIds.length === 0) { setSuchStatus("Kein Modell gefunden"); setLaedt(false); return; }

    try {
      const treffenByModel = new Map<string, number[]>();
      const alleTreffer: number[] = [];

      for (const mid of modelIds) {
        try {
          const rohe = await api.viewer.getObjects(mid);
          const allIds = parseObjectIds(rohe);
          if (allIds.length === 0) continue;

          // batch=1: jede Runtime-ID einzeln → Input-ID ist immer die korrekte Runtime-ID
          for (const rId of allIds) {
            try {
              const res = await api.viewer.getObjectProperties(mid, [rId]);
              if (!Array.isArray(res) || res.length === 0) continue;
              const obj = res[0];

              for (const gruppe of (obj?.properties ?? [])) {
                const pset = gruppe?.name || (gruppe as any)?.displayName || "";
                if (pset !== selectedAttr.pset) continue;
                for (const attr of (gruppe?.properties ?? [])) {
                  if (attr.name !== selectedAttr.name) continue;
                  const val = String(attr.value ?? "").toLowerCase();
                  if (val === ifcWert.toLowerCase() || val.includes(ifcWert.toLowerCase())) {
                    if (!treffenByModel.has(mid)) treffenByModel.set(mid, []);
                    treffenByModel.get(mid)!.push(rId); // Input-Runtime-ID, nicht obj.id!
                    alleTreffer.push(rId);
                  }
                }
              }
            } catch { /* einzelnes Objekt überspringen */ }
          }
        } catch { /* Modell überspringen */ }
      }

      if (alleTreffer.length === 0) { setSuchStatus("Keine Bauteile gefunden"); return; }

      // Korrekte ModelObjectIds[] → nur gefundene Runtime-IDs markieren
      const selection = [...treffenByModel.entries()].map(([modelId, objectRuntimeIds]) => ({
        modelId,
        objectRuntimeIds
      }));
      await (api.viewer as any).setSelection(selection);
      setGefundeneIds(alleTreffer);
      setSuchStatus(`✓ ${alleTreffer.length} Bauteile gefunden & markiert`);
    } catch (e) {
      setSuchStatus(`Fehler: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLaedt(false);
    }
  }

  // Task anklicken → Objekte im Viewer markieren wenn vorhanden
  async function taskAnklicken(taskId: string) {
    const istGleich = taskId === aktivTaskId;
    setAktivTaskId(istGleich ? null : taskId);
    if (!istGleich && api) {
      const task = aktiveSim?.tasks.find(t => t.id === taskId);
      if (task && task.objektGuids.length > 0) {
        try {
          await api.viewer.setSelection(task.objektGuids.map(Number));
        } catch { /* ignore */ }
      }
    }
  }

  function gefundeneHinzufuegen() {
    if (!aktivTask || gefundeneIds.length === 0 || !aktiveSim) return;
    const neueGuids = gefundeneIds.map(String);
    // GUID-Eindeutigkeit: aus anderen Tasks entfernen
    const bereinigteTasks = aktiveSim.tasks.map(t =>
      t.id === aktivTask.id
        ? { ...t, objektGuids: [...new Set([...t.objektGuids, ...neueGuids])] }
        : { ...t, objektGuids: t.objektGuids.filter(g => !neueGuids.includes(g)) }
    );
    updateSim({ ...aktiveSim, tasks: bereinigteTasks });
    setGefundeneIds([]);
    setSuchStatus(`✓ ${neueGuids.length} Bauteile hinzugefügt`);
  }

  function selektionHinzufuegen() {
    if (!aktivTask || selektion.length === 0 || !aktiveSim) return;
    const neueGuids = selektion.map(String);
    // GUID-Eindeutigkeit: aus anderen Tasks entfernen
    const bereinigteTasks = aktiveSim.tasks.map(t =>
      t.id === aktivTask.id
        ? { ...t, objektGuids: [...new Set([...t.objektGuids, ...neueGuids])] }
        : { ...t, objektGuids: t.objektGuids.filter(g => !neueGuids.includes(g)) }
    );
    updateSim({ ...aktiveSim, tasks: bereinigteTasks });
  }

  function speichereGuids(taskId: string, guids: string[]) {
    if (!aktiveSim) return;
    updateSim({ ...aktiveSim, tasks: aktiveSim.tasks.map(t => t.id === taskId ? { ...t, objektGuids: guids } : t) });
  }

  function guidEntfernen(taskId: string, guid: string) {
    if (!aktiveSim) return;
    updateSim({ ...aktiveSim, tasks: aktiveSim.tasks.map(t => t.id === taskId ? { ...t, objektGuids: t.objektGuids.filter(g => g !== guid) } : t) });
  }

  function typAendern(taskId: string, typ: TaskTyp) {
    if (!aktiveSim) return;
    updateSim({ ...aktiveSim, tasks: aktiveSim.tasks.map(t => t.id === taskId ? { ...t, typ } : t) });
  }

  async function markieren(guids: string[]) {
    if (!api) return;
    await api.viewer.setSelection(guids.map(Number));
  }

  // Statistiken
  const totalZugewiesen = aktiveSim?.tasks.reduce((s, t) => s + t.objektGuids.length, 0) ?? 0;
  const alleGuids = new Set(aktiveSim?.tasks.flatMap(t => t.objektGuids) ?? []);
  const nichtZugewiesen = totalObjekte != null ? Math.max(0, totalObjekte - alleGuids.size) : null;

  if (!aktiveSim) {
    return (
      <div className="tc-empty">
        <div className="tc-empty-icon">🔧</div>
        <div className="tc-empty-title">Keine aktive Simulation</div>
        <div className="tc-empty-sub">Tab „Projekte" → Simulation aktivieren</div>
      </div>
    );
  }

  return (
    <div className="tasklist-wrap">

      {/* Gantt Liste */}
      <div className="gantt-section">
        <div className="gantt-section-header">
          <span>Gantt · {aktiveSim.tasks.length} Tasks</span>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {totalZugewiesen > 0 && totalObjekte != null && (
              <span style={{ color: "var(--tc-blue)", fontSize: 9 }}>
                ⬡ {totalZugewiesen} / {totalObjekte}
              </span>
            )}
            {nichtZugewiesen != null && nichtZugewiesen > 0 && (
              <span style={{ color: "var(--tc-orange)", fontSize: 9 }}>
                ∅ {nichtZugewiesen} nicht zugewiesen
              </span>
            )}
          </div>
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
              onClick={() => taskAnklicken(task.id)}
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
              {totalObjekte != null
                ? `⬡ ${aktivTask.objektGuids.length} / ${totalObjekte}`
                : `⬡ ${aktivTask.objektGuids.length}`}
            </span>
          </div>

          {/* Task-Typ */}
          <div className="detail-block">
            <div className="detail-block-title">Task-Typ</div>
            <div className="typ-btns">
              {(["neubau", "bestand", "abbruch"] as TaskTyp[]).map(typ => (
                <button key={typ}
                  className={`typ-btn ${aktivTask.typ === typ ? `aktiv-${typ}` : ""}`}
                  onClick={() => typAendern(aktivTask.id, typ)}>
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
              {!attrLaedt && allAttrs.length > 0 && (
                <span style={{ color: "var(--tc-text-3)", fontWeight: 400, marginLeft: 6 }}>
                  {allAttrs.length} Attribute
                </span>
              )}
            </div>

            <div className="ac-wrap" ref={acRef}>
              <input
                className="ac-input"
                placeholder="Attribut suchen… (z.B. Material)"
                value={ifcQuery}
                onChange={e => { setIfcQuery(e.target.value); setSelectedAttr(null); setAcOffen(true); setGefundeneIds([]); setSuchStatus(null); }}
                onFocus={() => { setAcOffen(true); if (!allAttrs.length && modellId) ladeAttr(); }}
              />
              {acOffen && acItems.length > 0 && (
                <div className="ac-dropdown">
                  {acItems.map((item, i) => (
                    <div key={i} className="ac-item"
                      onMouseDown={() => { setIfcQuery(`${item.name} › ${item.pset}`); setSelectedAttr(item); setAcOffen(false); }}>
                      <div style={{ fontWeight: 500, color: "var(--tc-text)" }}>{item.name}</div>
                      <div style={{ fontSize: 9, color: "var(--tc-text-3)", marginTop: 1 }}>{item.pset}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Wert-Input mit Vorschlägen aus attrMap */}
            {(() => {
              const vorschlaege = selectedAttr && attrMap[selectedAttr.key]
                ? [...attrMap[selectedAttr.key]].filter(v =>
                    !ifcWert || v.toLowerCase().includes(ifcWert.toLowerCase())
                  ).slice(0, 8)
                : [];
              return (
                <div className="ac-wrap" style={{ marginTop: 4 }}>
                  <input
                    className="ac-input"
                    placeholder="Wert (z.B. Beton NPK C)…"
                    value={ifcWert}
                    onChange={e => { setIfcWert(e.target.value); setGefundeneIds([]); setSuchStatus(null); }}
                  />
                  {selectedAttr && vorschlaege.length > 0 && ifcWert.length === 0 && (
                    <div className="ac-dropdown">
                      {vorschlaege.map((v, i) => (
                        <div key={i} className="ac-item" onMouseDown={() => setIfcWert(v)}>
                          <div style={{ color: "var(--tc-text)" }}>{v}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}

            <button
              className="tc-btn-primary"
              style={{ width: "100%", marginTop: 6 }}
              disabled={laedt || !selectedAttr || !ifcWert || !modellId}
              onClick={ifcSuchen}
            >
              {laedt ? "⟳ Suche…" : "🔍 Suchen & Markieren"}
            </button>

            {!modellId && (
              <div className="alert info" style={{ marginTop: 5, fontSize: 9 }}>
                ⟳ Warte auf Modell-Verbindung…
              </div>
            )}

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
                ? `✓ ${selektion.length} Bauteil(e) ausgewählt`
                : "Bauteil(e) im Viewer anklicken…"}
            </div>
            {selektion.length > 0 && (
              <button className="tc-btn-secondary" style={{ width: "100%", marginTop: 5 }}
                onClick={selektionHinzufuegen}>
                + Ausgewählte Bauteile hinzufügen ({selektion.length})
              </button>
            )}
          </div>

          {/* Übersicht nicht zugewiesen */}
          {nichtZugewiesen != null && nichtZugewiesen > 0 && (
            <div className="detail-block" style={{ background: "#FFF8F0", border: "0.5px solid var(--tc-orange)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ color: "var(--tc-orange)", fontSize: 11 }}>⚠</span>
                <span style={{ fontSize: 10, color: "var(--tc-text-2)" }}>
                  <strong>{nichtZugewiesen}</strong> von <strong>{totalObjekte}</strong> Bauteilen noch keinem Task zugewiesen
                </span>
              </div>
              <div style={{ fontSize: 9, color: "var(--tc-text-3)", marginTop: 3 }}>
                Zugewiesen: {alleGuids.size} eindeutige Bauteile über {aktiveSim.tasks.filter(t => t.objektGuids.length > 0).length} Tasks
              </div>
            </div>
          )}

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
                      onClick={() => speichereGuids(aktivTask.id, [])}>
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
                    <button className="guid-row-x" onClick={() => guidEntfernen(aktivTask.id, g)}>✕</button>
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