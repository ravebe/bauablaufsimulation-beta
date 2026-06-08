import { useState, useEffect, useRef } from "react";
import type { SimProjekt, TaskTyp } from "../types";
import { parseObjectIds, parseObjectsRaw, BEKANNTE_GUID_LAYER_MAPS } from "../types";
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
  const [wertDropdownOffen, setWertDropdownOffen] = useState(false);
  const [suchStatus, setSuchStatus] = useState<string | null>(null);
  const [gefundeneIds, setGefundeneIds] = useState<number[]>([]); // alle Runtime-IDs (für Anzeige)
  const [gefundeneByModel, setGefundeneByModel] = useState<Map<string, number[]>>(new Map()); // pro Modell für korrektes Hinzufügen
  const [laedt, setLaedt] = useState(false);
  const [attrLaedt, setAttrLaedt] = useState(false);
  const [totalObjekte, setTotalObjekte] = useState<number | null>(null);
  const [bauelementeIdsMap, setBauelementeIdsMap] = useState<Record<string, number[]>>({});
  // modelId → (runtimeId → Layer-Name)
  const [runtimeLayerMapByModel, setRuntimeLayerMapByModel] = useState<Record<string, Record<number, string>>>({});
  // modelId → (runtimeId → IFC-GUID) — inverse Map für direktes Nachschlagen
  const [guidByRuntimeByModel, setGuidByRuntimeByModel] = useState<Record<string, Record<number, string>>>({});
  const acRef = useRef<HTMLDivElement>(null);
  const ladeAttrGen = useRef(0); // Cancellation-Token gegen Race Conditions

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
    setGefundeneByModel(new Map());
    setIfcQuery("");
    setIfcWert("");
    setSelectedAttr(null);
  }, [aktivTaskId]);

  // Bauteile zählen via getObjects + parameter.class (TC API offiziell, wie DataTable)
  // Zählt nur echte IFC-Bauteile — keine IFCSITE/BUILDING/STOREY/SPACE/GRID
  // Funktioniert für JEDES Projekt, nicht nur bekannte Modelle
  useEffect(() => {
    if (!api || !aktiveSim) return;
    const modellIds = aktiveSim.modelle.map(m => m.id).filter(Boolean);
    if (modellIds.length === 0) { setTotalObjekte(null); return; }

    const IFC_BAUTEIL_KLASSEN = [
      "IFCWALL", "IFCWALLSTANDARDCASE", "IFCSLAB", "IFCFOOTING",
      "IFCCOLUMN", "IFCBEAM", "IFCMEMBER", "IFCPLATE",
      "IFCBUILDINGELEMENTPROXY", "IFCSTAIR", "IFCSTAIRFLIGHT",
      "IFCRAMP", "IFCRAMPFLIGHT", "IFCROOF", "IFCDOOR", "IFCWINDOW",
      "IFCCOVERING", "IFCFURNISHINGELEMENT", "IFCPILE",
    ];

    (async () => {
      let gesamt = 0;
      const neueMap: Record<string, number[]> = {};

      for (const mid of modellIds) {
        const alleIds = new Set<number>();
        try {
          for (const klasse of IFC_BAUTEIL_KLASSEN) {
            try {
              const result = await (api.viewer as any).getObjects(
                { modelObjectIds: [{ modelId: mid }], parameter: { class: klasse } }
              ) as any[];
              if (Array.isArray(result)) {
                for (const r of result) {
                  for (const rId of (r?.objectRuntimeIds ?? [])) {
                    const n = Number(rId);
                    if (!isNaN(n) && n > 0) alleIds.add(n);
                  }
                }
              }
            } catch { /* Klasse nicht vorhanden → überspringen */ }
          }
        } catch { /* Modell überspringen */ }

        const bauIds = [...alleIds];
        if (bauIds.length > 0) {
          neueMap[mid] = bauIds;
          gesamt += bauIds.length;
        }
      }

      // Fallback für bekannte Modelle wenn getObjects-Klassen-Filter 0 liefert
      if (gesamt === 0) {
        for (const modell of aktiveSim.modelle) {
          const matchKey = Object.keys(BEKANNTE_GUID_LAYER_MAPS).find(
            k => modell.name.includes(k) || k.includes(modell.name)
          );
          if (matchKey) gesamt += Object.keys(BEKANNTE_GUID_LAYER_MAPS[matchKey]).length;
        }
      }

      setBauelementeIdsMap(neueMap);
      setTotalObjekte(gesamt > 0 ? gesamt : null);
    })();
  }, [aktiveSim?.id, api]);

  // GUID→Layer + GUID→RuntimeId Mapping vollautomatisch pro Modell
  useEffect(() => {
    if (!api || !aktiveSim) return;

    (async () => {
      const neueLayerMap: Record<string, Record<number, string>> = {};
      const neueGuidMap: Record<string, Record<number, string>> = {};
      const neueBauMap: Record<string, number[]> = {};
      const layerWerte = new Set<string>();

      for (const modell of aktiveSim.modelle) {
        const matchKey = Object.keys(BEKANNTE_GUID_LAYER_MAPS).find(
          k => modell.name.includes(k) || k.includes(modell.name)
        );
        if (!matchKey) continue;
        const guidLayerMap = BEKANNTE_GUID_LAYER_MAPS[matchKey];
        const guids = Object.keys(guidLayerMap);
        if (guids.length === 0) continue;

        const layerMap: Record<number, string> = {};
        const guidMap: Record<number, string> = {};
        const bauIds: number[] = [];

        try {
          const BATCH = 50;
          for (let i = 0; i < guids.length; i += BATCH) {
            const slice = guids.slice(i, i + BATCH);
            const runtimeIds = await api.viewer.convertToObjectRuntimeIds(modell.id, slice);
            if (!Array.isArray(runtimeIds)) continue;
            for (let j = 0; j < slice.length; j++) {
              const rid = Number(runtimeIds[j]);
              if (!isNaN(rid) && rid > 0) {
                const guid = slice[j];
                const layer = guidLayerMap[guid];
                layerMap[rid] = layer;
                guidMap[rid] = guid;   // inverse Map: runtimeId → GUID
                bauIds.push(rid);
                layerWerte.add(layer);
              }
            }
          }
        } catch { /* Modell überspringen */ }

        if (bauIds.length > 0) {
          neueLayerMap[modell.id] = layerMap;
          neueGuidMap[modell.id] = guidMap;
          neueBauMap[modell.id] = bauIds;
        }
      }

      if (Object.keys(neueLayerMap).length > 0) {
        setRuntimeLayerMapByModel(neueLayerMap);
        setGuidByRuntimeByModel(neueGuidMap);
        setBauelementeIdsMap(neueBauMap);
        setAttrMap(prev => {
          const key = "Presentation Layers||Layer";
          const vorh = new Set([...(prev[key] ?? []), ...layerWerte]);
          return { ...prev, [key]: vorh };
        });
        setAllAttrs(prev => {
          const key = "Presentation Layers||Layer";
          return prev.some(a => a.key === key)
            ? prev
            : [...prev, { pset: "Presentation Layers", name: "Layer", key }];
        });
      }
    })();
  }, [aktiveSim?.id, api]);

  // Attribute vorladen — parallele Einzelabfragen + Cancellation-Token gegen Race Condition
  async function ladeAttr() {
    if (!api) return;

    const modelIds = [...new Set([
      ...(aktiveSim?.modelle.map(m => m.id).filter(Boolean) ?? []),
      ...(aktivesModellId ? [aktivesModellId] : [])
    ])].filter(Boolean) as string[];

    if (modelIds.length === 0) return;
    const myGen = ++ladeAttrGen.current; // Diese Generation merken
    setAttrLaedt(true);

    const map: Record<string, Set<string>> = {};
    const attrsMap = new Map<string, AttrItem>();

    // Rekursives Parsing: PSet > Property oder PSet > SubGroup > Property
    const verarbeiteGruppe = (g: any, psetName: string) => {
      for (const p of (g?.properties ?? (g as any)?.items ?? [])) {
        if (!p?.name) continue;
        const subProps = (p as any).properties ?? (p as any).items ?? (p as any).groups;
        if (Array.isArray(subProps) && subProps.length > 0) {
          // Verschachtelte Gruppe (z.B. Presentation Layers als Sub-Gruppe)
          verarbeiteGruppe(p, p.name);
        } else {
          const key = `${psetName}||${p.name}`;
          if (!attrsMap.has(key)) attrsMap.set(key, { pset: psetName, name: p.name, key });
          if (p.value != null) {
            if (!map[key]) map[key] = new Set();
            map[key].add(String(p.value));
          }
        }
      }
    };
    const verarbeiteObj = (obj: any) => {
      // Formale PSets aus properties-Array
      for (const g of (obj?.properties ?? (obj as any)?.groups ?? [])) {
        const pset = g?.name || (g as any)?.displayName || "Eigenschaften";
        verarbeiteGruppe(g, pset);
      }
      // TC-berechnete Felder: product → Reference Object & Product PSets
      if (obj?.product) {
        const p = obj.product;
        if (p.objectType) {
          const key = "Reference Object||Common Type";
          if (!attrsMap.has(key)) attrsMap.set(key, { pset: "Reference Object", name: "Common Type", key });
          if (!map[key]) map[key] = new Set();
          map[key].add(String(p.objectType));
        }
        if (p.name) {
          const key = "Product||Product Name";
          if (!attrsMap.has(key)) attrsMap.set(key, { pset: "Product", name: "Product Name", key });
          if (!map[key]) map[key] = new Set();
          map[key].add(String(p.name));
        }
        if (p.description) {
          const key = "Product||Product Description";
          if (!attrsMap.has(key)) attrsMap.set(key, { pset: "Product", name: "Product Description", key });
          if (!map[key]) map[key] = new Set();
          map[key].add(String(p.description));
        }
      }
      // TC-berechnetes Feld: class → Presentation Layers > Layer
      if (obj?.class) {
        const key = "Presentation Layers||Layer";
        if (!attrsMap.has(key)) attrsMap.set(key, { pset: "Presentation Layers", name: "Layer", key });
        if (!map[key]) map[key] = new Set();
        map[key].add(String(obj.class));
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
        // 1. Metadaten direkt aus getObjects Response (layer, name, class falls vorhanden)
        for (const objMeta of parseObjectsRaw(rohe)) {
          if (objMeta.layer) {
            const key = "Presentation Layers||Layer";
            if (!attrsMap.has(key)) attrsMap.set(key, { pset: "Presentation Layers", name: "Layer", key });
            if (!map[key]) map[key] = new Set();
            map[key].add(String(objMeta.layer));
          }
          if (objMeta.name) {
            const key = "Product||Product Name";
            if (!attrsMap.has(key)) attrsMap.set(key, { pset: "Product", name: "Product Name", key });
            if (!map[key]) map[key] = new Set();
            map[key].add(String(objMeta.name));
          }
          if (objMeta.class) {
            const key = "Reference Object||Common Type";
            if (!attrsMap.has(key)) attrsMap.set(key, { pset: "Reference Object", name: "Common Type", key });
            if (!map[key]) map[key] = new Set();
            map[key].add(String(objMeta.class));
          }
        }

        // 2. getLayers: alle Layer-Namen (Fallback falls getObjects keine Layer hat)
        try {
          const layers = await api!.viewer.getLayers(mid);
          if (Array.isArray(layers)) {
            const key = "Presentation Layers||Layer";
            if (!attrsMap.has(key)) attrsMap.set(key, { pset: "Presentation Layers", name: "Layer", key });
            if (!map[key]) map[key] = new Set();
            for (const l of layers) {
              if (l?.name) map[key].add(String(l.name));
            }
          }
        } catch {}

        // 3. GUID (IFC) via convertToObjectIds
        try {
          const guids = await api!.viewer.convertToObjectIds(mid, allIds);
          if (Array.isArray(guids)) {
            const key = "Reference Object||GUID (IFC)";
            if (!attrsMap.has(key)) attrsMap.set(key, { pset: "Reference Object", name: "GUID (IFC)", key });
            if (!map[key]) map[key] = new Set();
            for (const g of guids) { if (g) map[key].add(String(g)); }
          }
        } catch {}

      } catch { /* Modell überspringen */ }
    }

    // Nur schreiben wenn kein neuerer Aufruf gestartet wurde (Race Condition Fix)
    if (myGen !== ladeAttrGen.current) return;
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

    // Hilfsfunktion: prüft ob Wert passt (hier definiert, für alle Pfade nutzbar)
    const wertPasst = (val: any): boolean => {
      const s = String(val ?? "").toLowerCase();
      return s === ifcWert.toLowerCase() || s.includes(ifcWert.toLowerCase());
    };

    try {
      const treffenByModel = new Map<string, number[]>();
      const alleTreffer: number[] = [];

      for (const mid of modelIds) {
        try {
          const rohe = await api.viewer.getObjects(mid);
          const allObjsMeta = parseObjectsRaw(rohe);
          // Nur echte Bauteile durchsuchen (IFCSITE/GRID etc. ausgeschlossen)
          const bekannteIds = bauelementeIdsMap[mid];
          const allIds = bekannteIds?.length > 0
            ? bekannteIds
            : allObjsMeta.map(o => o.id).filter(n => !isNaN(n));
          if (allIds.length === 0) continue;

          // Fast Path 1: GUID (IFC) via convertToObjectIds
          if (selectedAttr.pset === "Reference Object" && selectedAttr.name === "GUID (IFC)") {
            try {
              const guids = await api!.viewer.convertToObjectIds(mid, allIds);
              if (Array.isArray(guids)) {
                for (let i = 0; i < guids.length; i++) {
                  if (guids[i] && wertPasst(guids[i])) {
                    if (!treffenByModel.has(mid)) treffenByModel.set(mid, []);
                    treffenByModel.get(mid)!.push(allIds[i]);
                    alleTreffer.push(allIds[i]);
                  }
                }
              }
            } catch {}
            continue;
          }

          // Fast Path 2: Presentation Layers > Layer
          if (selectedAttr.pset === "Presentation Layers" && selectedAttr.name === "Layer") {
            // 2a: runtimeLayerMapByModel — pro Modell getrennt → exakte Treffer
            const modellMap = runtimeLayerMapByModel[mid];
            if (modellMap && Object.keys(modellMap).length > 0) {
              for (const rId of allIds) {
                const layer = modellMap[rId];
                if (layer && wertPasst(layer)) {
                  if (!treffenByModel.has(mid)) treffenByModel.set(mid, []);
                  treffenByModel.get(mid)!.push(rId);
                  alleTreffer.push(rId);
                }
              }
              continue;
            }

            // 2b: getObjects Metadaten (falls TC layer-Info mitliefert)
            const metaHasLayer = allObjsMeta.some(o => o.layer != null);
            if (metaHasLayer) {
              for (const objMeta of allObjsMeta) {
                if (objMeta.layer && wertPasst(String(objMeta.layer))) {
                  if (!treffenByModel.has(mid)) treffenByModel.set(mid, []);
                  treffenByModel.get(mid)!.push(objMeta.id);
                  alleTreffer.push(objMeta.id);
                }
              }
              continue;
            }

            // 2c: Alle IDs auf einmal — TC liefert oft partielle Ergebnisse statt zu werfen
            try {
              const allProps = await (api!.viewer as any).getObjectProperties(mid, allIds);
              if (Array.isArray(allProps) && allProps.length > 0) {
                for (const obj of allProps) {
                  const rId = typeof obj?.id === "number" ? obj.id : null;
                  if (rId == null) continue;
                  let layerGefunden = false;
                  for (const g of (obj?.properties ?? [])) {
                    if ((g?.name || "") === "Presentation Layers") {
                      for (const p of (g?.properties ?? [])) {
                        if (p?.name === "Layer" && wertPasst(p?.value)) { layerGefunden = true; break; }
                      }
                    }
                    if (layerGefunden) break;
                  }
                  if (!layerGefunden && wertPasst(obj?.class)) layerGefunden = true;
                  if (layerGefunden) {
                    if (!treffenByModel.has(mid)) treffenByModel.set(mid, []);
                    treffenByModel.get(mid)!.push(rId);
                    alleTreffer.push(rId);
                  }
                }
                continue;
              }
            } catch {}
          }

          // Standard: getObjectProperties pro Objekt
          for (const rId of allIds) {
            try {
              const res = await api.viewer.getObjectProperties(mid, [rId]);
              if (!Array.isArray(res) || res.length === 0) continue;
              const obj = res[0];

              let gefunden = false;

              // 1. Formale PSets (rekursiv)
              const sucheInGruppe = (g: any, psetName: string): boolean => {
                for (const p of (g?.properties ?? (g as any)?.items ?? [])) {
                  if (!p?.name) continue;
                  const subProps = (p as any).properties ?? (p as any).items ?? (p as any).groups;
                  if (Array.isArray(subProps) && subProps.length > 0) {
                    if (sucheInGruppe(p, p.name)) return true;
                  } else if (psetName === selectedAttr.pset && p.name === selectedAttr.name) {
                    if (wertPasst(p.value)) return true;
                  }
                }
                return false;
              };
              for (const gruppe of (obj?.properties ?? (obj as any)?.groups ?? [])) {
                const pset = gruppe?.name || (gruppe as any)?.displayName || "";
                if (sucheInGruppe(gruppe, pset)) { gefunden = true; break; }
              }

              // 2. TC product-Felder: Reference Object > Common Type / Product > Product Name etc.
              if (!gefunden && obj?.product) {
                const p = obj.product;
                if (selectedAttr.pset === "Reference Object" && selectedAttr.name === "Common Type" && wertPasst(p.objectType)) gefunden = true;
                if (selectedAttr.pset === "Product" && selectedAttr.name === "Product Name" && wertPasst(p.name)) gefunden = true;
                if (selectedAttr.pset === "Product" && selectedAttr.name === "Product Description" && wertPasst(p.description)) gefunden = true;
              }

              // 3. TC class-Feld: Presentation Layers > Layer
              if (!gefunden && selectedAttr.pset === "Presentation Layers" && selectedAttr.name === "Layer") {
                if (wertPasst(obj?.class)) gefunden = true;
              }

              if (gefunden) {
                if (!treffenByModel.has(mid)) treffenByModel.set(mid, []);
                treffenByModel.get(mid)!.push(rId);
                alleTreffer.push(rId);
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

      // Eindeutige Treffer pro Modell merken für korrektes Hinzufügen
      setGefundeneByModel(new Map(treffenByModel));

      // Anzahl = grösstes einzelnes Modell (ein Bauteil kann in beiden Modellen eine Runtime-ID haben)
      const maxTreffer = Math.max(...[...treffenByModel.values()].map(ids => ids.length));
      setGefundeneIds(alleTreffer);
      setSuchStatus(`✓ ${maxTreffer} Bauteile gefunden & markiert`);
    } catch (e) {
      setSuchStatus(`Fehler: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLaedt(false);
    }
  }

  // Prüft ob ein String eine echte IFC-GUID ist (22 Zeichen, Base64-ähnlich)
  function istIfcGuid(s: string): boolean {
    return /^[A-Za-z0-9_$]{22}$/.test(s);
  }

  // Markiert Objekte via getObjects + setSelection — exakt wie die DataTable
  // Für IFC-GUIDs: getObjects mit GlobalId-Filter → Runtime-IDs → setSelection
  // Für Legacy-Runtime-IDs: direkt ans erste Modell
  async function markiereGuids(guids: string[]) {
    if (!api || guids.length === 0) return;

    const modellIds = [...new Set([
      ...(aktiveSim?.modelle.map(m => m.id).filter(Boolean) ?? []),
      ...(aktivesModellId ? [aktivesModellId] : [])
    ])].filter(Boolean) as string[];
    if (modellIds.length === 0) return;

    const echteGuids = guids.filter(istIfcGuid);
    const legacyIds = guids.filter(g => !istIfcGuid(g)).map(Number).filter(n => !isNaN(n) && n > 0);

    const selection: { modelId: string; objectRuntimeIds: number[] }[] = [];

    // Ansatz 1: getObjects mit GlobalId-Property-Filter (TC API offiziell)
    if (echteGuids.length > 0) {
      // Zuerst aus guidByRuntimeByModel (schnell, kein API-Aufruf)
      let ausMap = false;
      for (const mid of modellIds) {
        const guidMap = guidByRuntimeByModel[mid];
        if (!guidMap || Object.keys(guidMap).length === 0) continue;
        const rIds = Object.entries(guidMap)
          .filter(([, guid]) => echteGuids.includes(guid))
          .map(([rId]) => Number(rId));
        if (rIds.length > 0) {
          selection.push({ modelId: mid, objectRuntimeIds: rIds });
          ausMap = true;
        }
      }

      // Fallback: getObjects mit GlobalId-Filter wenn Map leer (unbekannte Modelle)
      if (!ausMap) {
        for (const mid of modellIds) {
          try {
            const result = await (api.viewer as any).getObjects(
              { modelObjectIds: [{ modelId: mid }],
                parameter: { properties: { 'GlobalId': echteGuids.length === 1 ? echteGuids[0] : echteGuids } }
              }
            ) as any[];
            if (Array.isArray(result)) {
              for (const r of result) {
                const rIds = (r?.objectRuntimeIds ?? []).map(Number).filter((n: number) => !isNaN(n) && n > 0);
                if (rIds.length > 0) selection.push({ modelId: mid, objectRuntimeIds: rIds });
              }
            }
          } catch { /* Modell überspringen */ }
        }
      }
    }

    // Legacy Runtime-IDs
    if (legacyIds.length > 0) {
      selection.push({ modelId: modellIds[0], objectRuntimeIds: legacyIds });
    }

    if (selection.length > 0) {
      try {
        await (api.viewer as any).setSelection(selection);
      } catch { /* ignore */ }
    }
  }

  // Task anklicken → Objekte markieren
  async function taskAnklicken(taskId: string) {
    const istGleich = taskId === aktivTaskId;
    setAktivTaskId(istGleich ? null : taskId);
    if (!istGleich && api) {
      const task = aktiveSim?.tasks.find(t => t.id === taskId);
      if (task && task.objektGuids.length > 0) {
        await markiereGuids(task.objektGuids);
      }
    }
  }

  async function gefundeneHinzufuegen() {
    if (!aktivTask || gefundeneIds.length === 0 || !aktiveSim || !api) return;

    // GUIDs direkt aus guidByRuntimeByModel — kein API-Aufruf nötig
    const ifcGuids = new Set<string>();
    for (const [mid, rIds] of gefundeneByModel.entries()) {
      const guidMap = guidByRuntimeByModel[mid] ?? {};
      for (const rId of rIds) {
        const guid = guidMap[rId];
        if (guid) {
          ifcGuids.add(guid);
        } else {
          // Fallback: Runtime-ID als String (wird beim Markieren als Legacy behandelt)
          ifcGuids.add(String(rId));
        }
      }
    }

    const neueGuids = [...ifcGuids];
    const bereinigteTasks = aktiveSim.tasks.map(t =>
      t.id === aktivTask.id
        ? { ...t, objektGuids: [...new Set([...t.objektGuids, ...neueGuids])] }
        : { ...t, objektGuids: t.objektGuids.filter(g => !neueGuids.includes(g)) }
    );
    updateSim({ ...aktiveSim, tasks: bereinigteTasks });
    setGefundeneIds([]);
    setGefundeneByModel(new Map());
    setSuchStatus(`✓ ${neueGuids.length} Bauteile hinzugefügt`);
  }

  async function selektionHinzufuegen() {
    if (!aktivTask || selektion.length === 0 || !aktiveSim || !api) return;

    // getObjects({ selected: true }) → gibt aktuelle Selektion mit modelId+runtimeIds
    // Dann GUIDs aus guidByRuntimeByModel nachschlagen
    let neueGuids: string[] = [];
    try {
      const result = await (api.viewer as any).getObjects({ selected: true }) as any[];
      if (Array.isArray(result)) {
        for (const r of result) {
          const mid = r?.modelId;
          const rIds: number[] = (r?.objectRuntimeIds ?? []).map(Number).filter((n: number) => !isNaN(n));
          const guidMap = guidByRuntimeByModel[mid] ?? {};
          for (const rId of rIds) {
            const guid = guidMap[rId];
            if (guid) neueGuids.push(guid);
            else neueGuids.push(String(rId)); // Legacy-Fallback
          }
        }
      }
    } catch {
      // Fallback: Runtime-IDs direkt
      neueGuids = selektion.map(String);
    }

    if (neueGuids.length === 0) return;
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
    await markiereGuids(guids);
  }

  // Statistiken
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
            {totalObjekte != null && (
              <span style={{ color: "var(--tc-blue)", fontSize: 9 }}>
                ⬡ {alleGuids.size} / {totalObjekte}
              </span>
            )}
            {totalObjekte != null && nichtZugewiesen != null && nichtZugewiesen > 0 && (
              <span style={{ color: "#3B82F6", fontSize: 9 }}>
                ∅ {nichtZugewiesen} offen
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
                onChange={e => { setIfcQuery(e.target.value); setSelectedAttr(null); setAcOffen(true); setGefundeneIds([]); setGefundeneByModel(new Map()); setSuchStatus(null); }}
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
                    onChange={e => { setIfcWert(e.target.value); setGefundeneIds([]); setGefundeneByModel(new Map()); setSuchStatus(null); setWertDropdownOffen(true); }}
                    onFocus={() => setWertDropdownOffen(true)}
                    onBlur={() => setTimeout(() => setWertDropdownOffen(false), 150)}
                  />
                  {wertDropdownOffen && vorschlaege.length > 0 && (
                    <div className="ac-dropdown">
                      {vorschlaege.map((v, i) => (
                        <div key={i} className="ac-item" onMouseDown={() => { setIfcWert(v); setWertDropdownOffen(false); }}>
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
                + Gefundene hinzufügen ({Math.max(...[...gefundeneByModel.values()].map(ids => ids.length), 0)})
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

          {/* Übersicht Bauteile — blauer Info-Block */}
          {totalObjekte != null && (
            <div className="detail-block" style={{
              background: "#EFF6FF",
              border: "0.5px solid #BFDBFE",
              borderRadius: 6,
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 10, color: "#1D4ED8", fontWeight: 600 }}>
                  ⬡ {alleGuids.size} / {totalObjekte} Bauteile zugewiesen
                </span>
                {nichtZugewiesen != null && nichtZugewiesen > 0 && (
                  <span style={{ fontSize: 9, color: "#3B82F6" }}>
                    {nichtZugewiesen} offen
                  </span>
                )}
              </div>
              <div style={{ marginTop: 4, height: 4, borderRadius: 2, background: "#BFDBFE", overflow: "hidden" }}>
                <div style={{
                  height: "100%",
                  borderRadius: 2,
                  background: "#3B82F6",
                  width: `${totalObjekte > 0 ? Math.round((alleGuids.size / totalObjekte) * 100) : 0}%`,
                  transition: "width 0.3s ease",
                }} />
              </div>
              <div style={{ fontSize: 9, color: "#60A5FA", marginTop: 3 }}>
                {aktiveSim.tasks.filter(t => t.objektGuids.length > 0).length} Tasks mit Bauteilen
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