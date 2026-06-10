// AttributeFilter.tsx — IFC-Attribut-Suche mit Autocomplete
import { useState, useEffect, useRef } from "react";
import type { SimProjekt, Task } from "../types";
import type { ApiInstance } from "../hooks/useApi";
import { getModellObjekte } from "./modelHelpers";

interface AttrItem { pset: string; name: string; key: string; }
interface Props {
  api: ApiInstance | null;
  aktiveSim: SimProjekt | null;
  aktivTask: Task | null;
  aktivesModellId: string | null;
  updateSim: (sim: SimProjekt) => void;
  onAttrReset?: () => void; // wird bei Task-Wechsel aufgerufen
  resetSignal?: number; // erhöht sich bei Task-Wechsel → löst Reset aus
}

export default function AttributeFilter({ api, aktiveSim, aktivTask, aktivesModellId, updateSim, resetSignal }: Props) {
  const [allAttrs, setAllAttrs] = useState<AttrItem[]>([]);
  const [attrMap, setAttrMap] = useState<Record<string, Set<string>>>({});
  const [selectedAttr, setSelectedAttr] = useState<AttrItem | null>(null);
  const [ifcQuery, setIfcQuery] = useState("");
  const [ifcWert, setIfcWert] = useState("");
  const [acOffen, setAcOffen] = useState(false);
  const [wertDropdownOffen, setWertDropdownOffen] = useState(false);
  const [suchStatus, setSuchStatus] = useState<string | null>(null);
  const [gefundeneByModel, setGefundeneByModel] = useState<Map<string, number[]>>(new Map());
  const [laedt, setLaedt] = useState(false);
  const [attrLaedt, setAttrLaedt] = useState(false);
  const [konflikt, setKonflikt] = useState<{ details: { name: string; anzahl: number }[]; guids: string[] } | null>(null);
  const acRef = useRef<HTMLDivElement>(null);
  const ladeAttrGen = useRef(0);

  // Reset bei Task-Wechsel: Attribut behalten, nur Wert + Ergebnisse leeren
  useEffect(() => {
    setSuchStatus(null); setGefundeneByModel(new Map()); setKonflikt(null);
    setIfcWert("");
  }, [resetSignal]);

  // Status bei nächstem Klick löschen
  useEffect(() => {
    if (!suchStatus) return;
    const handler = () => { setSuchStatus(null); };
    const timer = setTimeout(() => document.addEventListener("click", handler, { once: true }), 300);
    return () => { clearTimeout(timer); document.removeEventListener("click", handler); };
  }, [suchStatus]);

  // Autocomplete schließen bei Klick außerhalb
  useEffect(() => {
    const handler = (e: MouseEvent) => { if (acRef.current && !acRef.current.contains(e.target as Node)) setAcOffen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Attribute laden wenn Sim/Modell wechselt
  useEffect(() => {
    setAllAttrs([]); setAttrMap({}); setSelectedAttr(null);
    if (api) ladeAttr();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aktiveSim?.id, aktivesModellId, api]);

  const modellId = aktiveSim?.modelle[0]?.id ?? aktivesModellId ?? null;

  async function ladeAttr() {
    if (!api || !aktiveSim) return;
    const modelIds = (aktiveSim.modelle.map(m => m.id).filter(Boolean)) as string[];
    if (modelIds.length === 0) return;
    const myGen = ++ladeAttrGen.current;
    setAttrLaedt(true);
    const map: Record<string, Set<string>> = {};
    const attrsMap = new Map<string, AttrItem>();
    const verarbeiteGruppe = (g: any, psetName: string) => {
      for (const p of (g?.properties ?? (g as any)?.items ?? [])) {
        if (!p?.name) continue;
        const subProps = (p as any).properties ?? (p as any).items ?? (p as any).groups;
        if (Array.isArray(subProps) && subProps.length > 0) { verarbeiteGruppe(p, p.name); }
        else {
          const key = `${psetName}||${p.name}`;
          if (!attrsMap.has(key)) attrsMap.set(key, { pset: psetName, name: p.name, key });
          if (p.value != null) { if (!map[key]) map[key] = new Set(); map[key].add(String(p.value)); }
        }
      }
    };
    const verarbeiteObj = (obj: any) => {
      for (const g of (obj?.properties ?? (obj as any)?.groups ?? [])) {
        verarbeiteGruppe(g, g?.name || (g as any)?.displayName || "Eigenschaften");
      }
      if (obj?.product) {
        const p = obj.product;
        const addAttr = (pset: string, name: string, val: any) => {
          if (!val) return; const key = `${pset}||${name}`;
          if (!attrsMap.has(key)) attrsMap.set(key, { pset, name, key });
          if (!map[key]) map[key] = new Set(); map[key].add(String(val));
        };
        addAttr("Reference Object", "Common Type", p.objectType);
        addAttr("Product", "Product Name", p.name);
        addAttr("Product", "Product Description", p.description);
      }
    };
    for (const mid of modelIds) {
      try {
        const allIds = await getModellObjekte(api, mid);
        if (allIds.length === 0) continue;
        for (let i = 0; i < allIds.length; i += 10) {
          const chunk = allIds.slice(i, i + 10);
          const res = await Promise.allSettled(chunk.map(rId => api.viewer.getObjectProperties(mid, [rId])));
          for (const r of res) { if (r.status === 'fulfilled' && Array.isArray(r.value)) for (const obj of r.value) verarbeiteObj(obj); }
        }
        try {
          const layers = await api.viewer.getLayers(mid);
          if (Array.isArray(layers)) {
            const key = "Presentation Layers||Layer";
            if (!attrsMap.has(key)) attrsMap.set(key, { pset: "Presentation Layers", name: "Layer", key });
            if (!map[key]) map[key] = new Set();
            for (const l of layers) { if (l?.name) map[key].add(String(l.name)); }
          }
        } catch {}
        try {
          const guids = await api.viewer.convertToObjectIds(mid, allIds);
          if (Array.isArray(guids)) {
            const key = "Reference Object||GUID (IFC)";
            if (!attrsMap.has(key)) attrsMap.set(key, { pset: "Reference Object", name: "GUID (IFC)", key });
            if (!map[key]) map[key] = new Set();
            for (const g of guids) { if (g) map[key].add(String(g)); }
          }
        } catch {}
      } catch {}
    }
    if (myGen !== ladeAttrGen.current) return;
    setAttrMap(map); setAllAttrs([...attrsMap.values()]); setAttrLaedt(false);
  }

  const acItems = ifcQuery.length >= 1
    ? allAttrs.filter(a => a.name.toLowerCase().startsWith(ifcQuery.toLowerCase()) || a.pset.toLowerCase().startsWith(ifcQuery.toLowerCase())).slice(0, 40)
    : [];

  async function ifcSuchen() {
    if (!api || !selectedAttr || !ifcWert || !aktivTask || !aktiveSim) return;
    setSuchStatus(null); setGefundeneByModel(new Map()); setLaedt(true);
    const modelIds = aktiveSim.modelle.map(m => m.id).filter(Boolean) as string[];
    if (modelIds.length === 0) { setSuchStatus("Kein Modell gefunden"); setLaedt(false); return; }
    const wertPasst = (val: any) => { const s = String(val ?? "").toLowerCase(); return s === ifcWert.toLowerCase() || s.includes(ifcWert.toLowerCase()); };
    try {
      const treffenByModel = new Map<string, number[]>();
      const alleTreffer: number[] = [];
      for (const mid of modelIds) {
        try {
          const allIds = await getModellObjekte(api, mid);
          if (allIds.length === 0) continue;
          if (selectedAttr.pset === "Reference Object" && selectedAttr.name === "GUID (IFC)") {
            try {
              const guids = await api.viewer.convertToObjectIds(mid, allIds);
              if (Array.isArray(guids)) for (let i = 0; i < guids.length; i++) if (guids[i] && wertPasst(guids[i])) { if (!treffenByModel.has(mid)) treffenByModel.set(mid, []); treffenByModel.get(mid)!.push(allIds[i]); alleTreffer.push(allIds[i]); }
            } catch {}; continue;
          }
          for (const rId of allIds) {
            try {
              const res = await api.viewer.getObjectProperties(mid, [rId]);
              if (!Array.isArray(res) || res.length === 0) continue;
              const obj = res[0]; let gefunden = false;
              const sucheInGruppe = (g: any, psetName: string): boolean => {
                for (const p of (g?.properties ?? (g as any)?.items ?? [])) {
                  if (!p?.name) continue;
                  const sub = (p as any).properties ?? (p as any).items ?? (p as any).groups;
                  if (Array.isArray(sub) && sub.length > 0) { if (sucheInGruppe(p, p.name)) return true; }
                  else if (psetName === selectedAttr.pset && p.name === selectedAttr.name && wertPasst(p.value)) return true;
                }
                return false;
              };
              for (const g of (obj?.properties ?? (obj as any)?.groups ?? [])) { if (sucheInGruppe(g, g?.name || (g as any)?.displayName || "")) { gefunden = true; break; } }
              if (!gefunden && obj?.product) {
                const p = obj.product;
                if (selectedAttr.pset === "Reference Object" && selectedAttr.name === "Common Type" && wertPasst(p.objectType)) gefunden = true;
                if (selectedAttr.pset === "Product" && selectedAttr.name === "Product Name" && wertPasst(p.name)) gefunden = true;
                if (selectedAttr.pset === "Product" && selectedAttr.name === "Product Description" && wertPasst(p.description)) gefunden = true;
              }
              if (gefunden) { if (!treffenByModel.has(mid)) treffenByModel.set(mid, []); treffenByModel.get(mid)!.push(rId); alleTreffer.push(rId); }
            } catch {}
          }
        } catch {}
      }
      if (alleTreffer.length === 0) { setSuchStatus("Keine Bauteile gefunden"); return; }
      const selection = [...treffenByModel.entries()].map(([modelId, objectRuntimeIds]) => ({ modelId, objectRuntimeIds }));
      await (api.viewer as any).setSelection(selection);
      setGefundeneByModel(new Map(treffenByModel));
      const maxTreffer = Math.max(...[...treffenByModel.values()].map(ids => ids.length));
      setSuchStatus(`✓ ${maxTreffer} Bauteile gefunden & markiert`);
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
    if (details.length > 0) {
      setKonflikt({ details, guids: neueGuids });
    } else {
      filterZuweisen(neueGuids);
    }
  }

  const vorschlaege = selectedAttr && attrMap[selectedAttr.key]
    ? [...attrMap[selectedAttr.key]].filter(v => !ifcWert || v.toLowerCase().includes(ifcWert.toLowerCase())).slice(0, 8) : [];
  const gefundeneAnzahl = gefundeneByModel.size > 0 ? Math.max(...[...gefundeneByModel.values()].map(ids => ids.length), 0) : 0;

  return (
    <div className="detail-block">
      <div className="detail-block-title">
        IFC-Attribut Filter
        {attrLaedt && <span style={{ color: "var(--tc-text-3)", fontWeight: 400, marginLeft: 6 }}>⟳ lädt…</span>}
        {!attrLaedt && allAttrs.length > 0 && <span style={{ color: "var(--tc-text-3)", fontWeight: 400, marginLeft: 6 }}>{allAttrs.length} Attribute</span>}
      </div>
      <div className="ac-wrap" ref={acRef}>
        <input className="ac-input" placeholder="Attribut suchen… (z.B. Material)" value={ifcQuery}
          onChange={e => { setIfcQuery(e.target.value); setSelectedAttr(null); setAcOffen(true); setGefundeneByModel(new Map()); setSuchStatus(null); }}
          onFocus={() => { setAcOffen(true); if (!allAttrs.length && modellId) ladeAttr(); }} />
        {acOffen && acItems.length > 0 && (
          <div className="ac-dropdown">
            {acItems.map((item, i) => (
              <div key={i} className="ac-item" onMouseDown={() => { setIfcQuery(`${item.name} › ${item.pset}`); setSelectedAttr(item); setAcOffen(false); }}>
                <div style={{ fontWeight: 500, color: "var(--tc-text)" }}>{item.name}</div>
                <div style={{ fontSize: 9, color: "var(--tc-text-3)", marginTop: 1 }}>{item.pset}</div>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="ac-wrap" style={{ marginTop: 4 }}>
        <input className="ac-input" placeholder="Wert (z.B. Beton NPK C)…" value={ifcWert}
          onChange={e => { setIfcWert(e.target.value); setGefundeneByModel(new Map()); setSuchStatus(null); setWertDropdownOffen(true); }}
          onFocus={() => setWertDropdownOffen(true)} onBlur={() => setTimeout(() => setWertDropdownOffen(false), 150)} />
        {wertDropdownOffen && vorschlaege.length > 0 && (
          <div className="ac-dropdown">
            {vorschlaege.map((v, i) => <div key={i} className="ac-item" onMouseDown={() => { setIfcWert(v); setWertDropdownOffen(false); }}><div style={{ color: "var(--tc-text)" }}>{v}</div></div>)}
          </div>
        )}
      </div>
      <button className="tc-btn-primary" style={{ width: "100%", marginTop: 6 }}
        disabled={laedt || !selectedAttr || !ifcWert || !modellId} onClick={ifcSuchen}>
        {laedt ? "⟳ Suche…" : "🔍 Suchen & Markieren"}
      </button>
      {!modellId && <div className="alert info" style={{ marginTop: 5, fontSize: 9 }}>⟳ Warte auf Modell-Verbindung…</div>}
      {suchStatus && <div className={`alert ${suchStatus.startsWith("✓") ? "ok" : "err"}`} style={{ marginTop: 5 }}>{suchStatus}</div>}
      {konflikt ? (
        <div style={{ background: "#FFF7ED", border: "1px solid #FB923C", borderRadius: 6, padding: 8, fontSize: 11, marginTop: 6 }}>
          <div style={{ fontWeight: 600, color: "#C2410C", marginBottom: 4 }}>⚠ Objekte in anderen Tasks:</div>
          {konflikt.details.map((k, i) => (
            <div key={i} style={{ color: "#9A3412" }}>• {k.anzahl} aus „{k.name}"</div>
          ))}
          <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
            <button className="tc-btn-primary" style={{ flex: 1, background: "#16a34a", borderColor: "#16a34a", fontSize: 11 }}
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
    </div>
  );
}
