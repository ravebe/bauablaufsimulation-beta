// AttributeFilter.tsx — IFC-Attribut-Suche mit Autocomplete + Multi-Filter
import { useState, useEffect, useRef } from "react";
import type { SimProjekt, Task } from "../types";
import type { ApiInstance } from "../hooks/useApi";
import { getModellObjekte } from "./modelHelpers";

interface AttrItem { pset: string; name: string; key: string; }
interface FilterRow { query: string; selectedAttr: AttrItem | null; wert: string; acOffen: boolean; wertOffen: boolean; }
interface Props {
  api: ApiInstance | null;
  aktiveSim: SimProjekt | null;
  aktivTask: Task | null;
  aktivesModellId: string | null;
  updateSim: (sim: SimProjekt) => void;
  onAttrReset?: () => void;
  resetSignal?: number;
}

function neuerFilter(): FilterRow { return { query: "", selectedAttr: null, wert: "", acOffen: false, wertOffen: false }; }

export default function AttributeFilter({ api, aktiveSim, aktivTask, aktivesModellId, updateSim, resetSignal }: Props) {
  const [allAttrs, setAllAttrs] = useState<AttrItem[]>([]);
  const [attrMap, setAttrMap] = useState<Record<string, Set<string>>>({});
  const [filters, setFilters] = useState<FilterRow[]>([neuerFilter()]);
  const [collapsed, setCollapsed] = useState(true);
  const [suchStatus, setSuchStatus] = useState<string | null>(null);
  const [gefundeneByModel, setGefundeneByModel] = useState<Map<string, number[]>>(new Map());
  const [laedt, setLaedt] = useState(false);
  const [attrLaedt, setAttrLaedt] = useState(false);
  const [konflikt, setKonflikt] = useState<{ details: { name: string; anzahl: number }[]; guids: string[] } | null>(null);
  const acRef = useRef<HTMLDivElement>(null);
  const ladeAttrGen = useRef(0);

  // Reset bei Task-Wechsel: Attribute behalten, Werte leeren
  useEffect(() => {
    setSuchStatus(null); setGefundeneByModel(new Map()); setKonflikt(null);
    setFilters(prev => prev.map(f => ({ ...f, wert: "", acOffen: false, wertOffen: false })));
  }, [resetSignal]);

  // Status auto-dismiss
  useEffect(() => {
    if (!suchStatus) return;
    const handler = () => setSuchStatus(null);
    const timer = setTimeout(() => document.addEventListener("click", handler, { once: true }), 300);
    return () => { clearTimeout(timer); document.removeEventListener("click", handler); };
  }, [suchStatus]);

  // AC schließen bei Klick außerhalb
  useEffect(() => {
    const handler = (e: MouseEvent) => { if (acRef.current && !acRef.current.contains(e.target as Node)) setFilters(prev => prev.map(f => ({ ...f, acOffen: false }))); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const modellId = aktiveSim?.modelle[0]?.id ?? aktivesModellId ?? null;

  async function ladeAttr() {
    if (!api || !modellId) return;
    setAttrLaedt(true);
    const gen = ++ladeAttrGen.current;
    try {
      const allIds = await getModellObjekte(api, modellId);
      const attrsMap = new Map<string, AttrItem>();
      const map: Record<string, Set<string>> = {};
      const probeIds = allIds.slice(0, Math.min(30, allIds.length));
      for (const rId of probeIds) {
        if (gen !== ladeAttrGen.current) return;
        try {
          const res = await api.viewer.getObjectProperties(modellId, [rId]);
          if (!Array.isArray(res) || res.length === 0) continue;
          const obj = res[0];
          const sammel = (g: any, pn: string) => {
            for (const p of (g?.properties ?? (g as any)?.items ?? [])) {
              if (!p?.name) continue;
              const sub = (p as any).properties ?? (p as any).items ?? (p as any).groups;
              if (Array.isArray(sub) && sub.length > 0) { sammel(p, p.name); continue; }
              const key = `${pn}||${p.name}`;
              if (!attrsMap.has(key)) attrsMap.set(key, { pset: pn, name: p.name, key });
              if (p.value != null) { if (!map[key]) map[key] = new Set(); const v = String(p.value).trim(); if (v && v !== "null") map[key].add(v); }
            }
          };
          for (const g of (obj?.properties ?? (obj as any)?.groups ?? [])) sammel(g, g?.name || (g as any)?.displayName || "");
          if (obj?.product) {
            const pKey = "Product||Product Name"; const tKey = "Reference Object||Common Type";
            if (!attrsMap.has(pKey)) attrsMap.set(pKey, { pset: "Product", name: "Product Name", key: pKey });
            if (!attrsMap.has(tKey)) attrsMap.set(tKey, { pset: "Reference Object", name: "Common Type", key: tKey });
            if (obj.product.name) { if (!map[pKey]) map[pKey] = new Set(); map[pKey].add(String(obj.product.name)); }
            if (obj.product.objectType) { if (!map[tKey]) map[tKey] = new Set(); map[tKey].add(String(obj.product.objectType)); }
          }
        } catch {}
      }
      // Layers
      try {
        const layers = await api.viewer.getLayers(modellId);
        if (Array.isArray(layers)) {
          const lKey = "Layer||Layer";
          if (!attrsMap.has(lKey)) attrsMap.set(lKey, { pset: "Layer", name: "Layer", key: lKey });
          if (!map[lKey]) map[lKey] = new Set();
          for (const l of layers) if (l?.name) map[lKey].add(String(l.name));
        }
      } catch {}
      // GUID
      const gKey = "Reference Object||GUID (IFC)";
      if (!attrsMap.has(gKey)) attrsMap.set(gKey, { pset: "Reference Object", name: "GUID (IFC)", key: gKey });
      if (gen !== ladeAttrGen.current) return;
      setAttrMap(map); setAllAttrs([...attrsMap.values()]);
    } catch {}
    setAttrLaedt(false);
  }

  function updateFilter(idx: number, patch: Partial<FilterRow>) {
    setFilters(prev => prev.map((f, i) => i === idx ? { ...f, ...patch } : f));
    setGefundeneByModel(new Map()); setSuchStatus(null);
  }

  function addFilter() {
    if (filters.length >= 4) return;
    setFilters(prev => [...prev, neuerFilter()]);
  }

  function removeFilter(idx: number) {
    if (idx === 0) return;
    setFilters(prev => prev.filter((_, i) => i !== idx));
  }

  // Kombinierte Suche (AND)
  async function ifcSuchen() {
    if (!api || !aktivTask || !aktiveSim) return;
    const aktiveFilter = filters.filter(f => f.selectedAttr && f.wert);
    if (aktiveFilter.length === 0) return;
    setSuchStatus(null); setGefundeneByModel(new Map()); setLaedt(true);
    const modelIds = aktiveSim.modelle.map(m => m.id).filter(Boolean) as string[];
    if (modelIds.length === 0) { setSuchStatus("Kein Modell"); setLaedt(false); return; }

    try {
      const treffenByModel = new Map<string, number[]>();
      for (const mid of modelIds) {
        const allIds = await getModellObjekte(api, mid);
        if (allIds.length === 0) continue;
        for (const rId of allIds) {
          let allePasst = true;
          for (const f of aktiveFilter) {
            const attr = f.selectedAttr!;
            const wertPasst = (val: any) => { const s = String(val ?? "").toLowerCase(); return s === f.wert.toLowerCase() || s.includes(f.wert.toLowerCase()); };
            let gefunden = false;

            if (attr.pset === "Reference Object" && attr.name === "GUID (IFC)") {
              try { const ids = await api.viewer.convertToObjectIds(mid, [rId]); gefunden = Array.isArray(ids) && ids.some(g => wertPasst(g)); } catch {}
            } else if (attr.pset === "Layer" && attr.name === "Layer") {
              try {
                const layers = await api.viewer.getLayers(mid) as any[];
                if (Array.isArray(layers)) for (const l of layers) { if (l?.name && wertPasst(l.name) && (l.objectRuntimeIds ?? []).includes(rId)) { gefunden = true; break; } }
              } catch {}
            } else {
              try {
                const res = await api.viewer.getObjectProperties(mid, [rId]);
                if (Array.isArray(res) && res.length > 0) {
                  const obj = res[0];
                  const sucheIn = (g: any, pn: string): boolean => {
                    for (const p of (g?.properties ?? (g as any)?.items ?? [])) {
                      if (!p?.name) continue;
                      const sub = (p as any).properties ?? (p as any).items;
                      if (Array.isArray(sub) && sub.length > 0) { if (sucheIn(p, p.name)) return true; }
                      else if (pn === attr.pset && p.name === attr.name && wertPasst(p.value)) return true;
                    }
                    return false;
                  };
                  for (const g of (obj?.properties ?? [])) { if (sucheIn(g, g?.name || "")) { gefunden = true; break; } }
                  if (!gefunden && obj?.product) {
                    if (attr.pset === "Reference Object" && attr.name === "Common Type" && wertPasst(obj.product.objectType)) gefunden = true;
                    if (attr.pset === "Product" && attr.name === "Product Name" && wertPasst(obj.product.name)) gefunden = true;
                  }
                }
              } catch {}
            }
            if (!gefunden) { allePasst = false; break; }
          }
          if (allePasst) { if (!treffenByModel.has(mid)) treffenByModel.set(mid, []); treffenByModel.get(mid)!.push(rId); }
        }
      }
      if ([...treffenByModel.values()].reduce((s, a) => s + a.length, 0) === 0) { setSuchStatus("Keine Bauteile gefunden"); return; }
      const modelObjectIds = [...treffenByModel.entries()].map(([modelId, objectRuntimeIds]) => ({ modelId, objectRuntimeIds }));
      await (api.viewer as any).setSelection({ modelObjectIds }, "set");
      setGefundeneByModel(new Map(treffenByModel));
      const total = [...treffenByModel.values()].reduce((s, a) => s + a.length, 0);
      setSuchStatus(`✓ ${total} Bauteile gefunden & markiert`);
    } catch (e) { setSuchStatus(`Fehler: ${e instanceof Error ? e.message : String(e)}`); }
    finally { setLaedt(false); }
  }

  function filterZuweisen(guids: string[]) {
    if (!aktivTask || !aktiveSim) return;
    const bereinigteTasks = aktiveSim.tasks.map(t =>
      t.id === aktivTask.id ? { ...t, objektGuids: [...new Set([...t.objektGuids, ...guids])] }
        : { ...t, objektGuids: t.objektGuids.filter(g => !guids.includes(g)) }
    );
    updateSim({ ...aktiveSim, tasks: bereinigteTasks });
    setGefundeneByModel(new Map()); setKonflikt(null);
    setSuchStatus(`✓ ${guids.length} Bauteile hinzugefügt`);
  }

  function gefundeneHinzufuegen() {
    if (!aktivTask || gefundeneByModel.size === 0 || !aktiveSim) return;
    const seen = new Set<string>(); const neueGuids: string[] = [];
    for (const [mid, rIds] of gefundeneByModel.entries()) for (const rId of rIds) { const k = `${mid}:::${rId}`; if (!seen.has(k)) { seen.add(k); neueGuids.push(k); } }
    if (neueGuids.length === 0) return;
    const details: { name: string; anzahl: number }[] = [];
    for (const t of aktiveSim.tasks) {
      if (t.id === aktivTask.id) continue;
      const overlap = t.objektGuids.filter(g => neueGuids.includes(g)).length;
      if (overlap > 0) details.push({ name: t.name, anzahl: overlap });
    }
    if (details.length > 0) { setKonflikt({ details, guids: neueGuids }); }
    else { filterZuweisen(neueGuids); }
  }

  const gefundeneAnzahl = gefundeneByModel.size > 0 ? [...gefundeneByModel.values()].reduce((s, a) => s + a.length, 0) : 0;
  const kannSuchen = filters.some(f => f.selectedAttr && f.wert) && !!modellId;

  return (
    <div className="detail-block" ref={acRef}>
      {/* Titel — klickbar zum Auf-/Zuklappen */}
      <div style={{ display: "flex", alignItems: "center", cursor: "pointer", marginBottom: collapsed ? 0 : 6 }}
        onClick={() => { setCollapsed(c => !c); if (collapsed && !allAttrs.length && modellId) ladeAttr(); }}>
        <div className="detail-block-title" style={{ margin: 0, flex: 1 }}>
          IFC-Attribut Filter
          {attrLaedt && <span style={{ fontWeight: 400, marginLeft: 6 }}>⟳</span>}
          {!attrLaedt && allAttrs.length > 0 && <span style={{ fontWeight: 400, marginLeft: 6 }}>{allAttrs.length} Attribute</span>}
        </div>
        <span style={{ fontSize: 10, color: "#8a9baa", marginRight: 4 }}>{collapsed ? "▸" : "▾"}</span>
        {!collapsed && filters.length < 4 && (
          <button className="tc-btn-ghost" style={{ padding: "1px 6px", fontSize: 11, marginLeft: 2 }}
            onClick={e => { e.stopPropagation(); addFilter(); }}>+</button>
        )}
      </div>

      {/* Inhalt — nur wenn nicht collapsed */}
      {!collapsed && (
        <>
          {filters.map((f, idx) => {
            const acItems = f.query.length >= 1
              ? allAttrs.filter(a => a.name.toLowerCase().includes(f.query.toLowerCase()) || a.pset.toLowerCase().includes(f.query.toLowerCase())).slice(0, 20)
              : [];
            const vorschlaege = f.selectedAttr && attrMap[f.selectedAttr.key]
              ? [...attrMap[f.selectedAttr.key]].filter(v => !f.wert || v.toLowerCase().includes(f.wert.toLowerCase())).slice(0, 8) : [];

            return (
              <div key={idx} style={{ marginBottom: 6, position: "relative", borderLeft: idx > 0 ? "2px solid #2d7dbd" : "none", paddingLeft: idx > 0 ? 6 : 0 }}>
                {idx > 0 && (
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 2 }}>
                    <span style={{ fontSize: 9, color: "#8a9baa", fontWeight: 600 }}>UND-Filter {idx + 1}</span>
                    <button style={{ background: "none", border: "none", cursor: "pointer", color: "#999", fontSize: 12, padding: 0 }}
                      onClick={() => removeFilter(idx)}>✕</button>
                  </div>
                )}
                {/* Attribut */}
                <div style={{ position: "relative" }}>
                  <input className="ac-input" style={{ paddingRight: 24 }} placeholder="Attribut suchen…" value={f.query}
                    onChange={e => updateFilter(idx, { query: e.target.value, selectedAttr: null, acOffen: true })}
                    onFocus={() => { updateFilter(idx, { acOffen: true }); if (!allAttrs.length && modellId) ladeAttr(); }} />
                  {f.query && <button style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "#999", fontSize: 14, padding: 2 }}
                    onClick={() => updateFilter(idx, { query: "", selectedAttr: null })}>✕</button>}
                  {f.acOffen && acItems.length > 0 && (
                    <div className="ac-dropdown">
                      {acItems.map((item, i) => (
                        <div key={i} className="ac-item" onMouseDown={() => updateFilter(idx, { query: `${item.name} › ${item.pset}`, selectedAttr: item, acOffen: false })}>
                          <div style={{ fontWeight: 500, color: "var(--tc-text)" }}>{item.name}</div>
                          <div style={{ fontSize: 9, color: "var(--tc-text-3)" }}>{item.pset}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                {/* Wert */}
                <div style={{ marginTop: 3, position: "relative" }}>
                  <input className="ac-input" style={{ paddingRight: 24 }} placeholder="Wert…" value={f.wert}
                    onChange={e => updateFilter(idx, { wert: e.target.value, wertOffen: true })}
                    onFocus={() => updateFilter(idx, { wertOffen: true })} onBlur={() => setTimeout(() => updateFilter(idx, { wertOffen: false }), 150)} />
                  {f.wert && <button style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "#999", fontSize: 14, padding: 2 }}
                    onClick={() => updateFilter(idx, { wert: "" })}>✕</button>}
                  {f.wertOffen && vorschlaege.length > 0 && (
                    <div className="ac-dropdown">
                      {vorschlaege.map((v, i) => <div key={i} className="ac-item" onMouseDown={() => updateFilter(idx, { wert: v, wertOffen: false })}>{v}</div>)}
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          <button className="tc-btn-primary" style={{ width: "100%", marginTop: 2 }}
            disabled={laedt || !kannSuchen} onClick={ifcSuchen}>
            {laedt ? "⟳ Suche…" : `🔍 Suchen & Markieren${filters.filter(f => f.selectedAttr && f.wert).length > 1 ? ` (${filters.filter(f => f.selectedAttr && f.wert).length} Filter)` : ""}`}
          </button>

          {suchStatus && <div className={`alert ${suchStatus.startsWith("✓") ? "ok" : "err"}`} style={{ marginTop: 5 }}>{suchStatus}</div>}
          {konflikt ? (
            <div style={{ background: "#FFF7ED", border: "1px solid #FB923C", padding: 8, fontSize: 11, marginTop: 6 }}>
              <div style={{ fontWeight: 600, color: "#C2410C", marginBottom: 4 }}>⚠ Objekte in anderen Tasks:</div>
              {konflikt.details.map((k, i) => <div key={i} style={{ color: "#9A3412" }}>• {k.anzahl} aus „{k.name}"</div>)}
              <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                <button className="tc-btn-primary" style={{ flex: 1, background: "#2d7dbd", borderColor: "#2d7dbd", fontSize: 11 }}
                  onClick={() => filterZuweisen(konflikt.guids)}>Verschieben</button>
                <button className="tc-btn-ghost" style={{ flex: 1, fontSize: 11 }}
                  onClick={() => { setKonflikt(null); setSuchStatus("Abgebrochen"); }}>Abbrechen</button>
              </div>
            </div>
          ) : gefundeneAnzahl > 0 ? (
            <button className="tc-btn-green" style={{ width: "100%", marginTop: 6 }} onClick={gefundeneHinzufuegen}>
              + Gefundene hinzufügen ({gefundeneAnzahl})
            </button>
          ) : null}
        </>
      )}
    </div>
  );
}
