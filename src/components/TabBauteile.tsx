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
  const [wertDropdownOffen, setWertDropdownOffen] = useState(false);
  const [suchStatus, setSuchStatus] = useState<string | null>(null);
  const [gefundeneIds, setGefundeneIds] = useState<number[]>([]); // alle Runtime-IDs (für Anzeige)
  const [gefundeneByModel, setGefundeneByModel] = useState<Map<string, number[]>>(new Map()); // pro Modell für korrektes Hinzufügen
  const [laedt, setLaedt] = useState(false);
  const [attrLaedt, setAttrLaedt] = useState(false);
  const [totalObjekte, setTotalObjekte] = useState<number | null>(null);
  const [totalLaedt, setTotalLaedt] = useState(false);
  // Anzeige-Namen für gespeicherte Objekte: {guid → {name, ifcId}}
  const [guidInfo, setGuidInfo] = useState<Map<string, {name: string; ifcId: string}>>(new Map());
  // Cache: "simId_modellId" → echte Bauteil-IDs (nur einmal berechnen pro Session)
  const echteBauteileCache = useRef<Record<string, number[]>>({});
  // Cache: "modellId" → "tekla" | "standard"
  const modellTypCache = useRef<Record<string, 'tekla' | 'standard'>>({});
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
    setGuidInfo(new Map());
  }, [aktivTaskId]);

  // Guid-Labels laden: Product Name + IFC GUID pro gespeichertem Objekt
  useEffect(() => {
    if (!api || !aktivTask?.objektGuids.length) return;
    const guids = aktivTask.objektGuids;
    (async () => {
      const info = new Map<string, {name: string; ifcId: string}>();
      for (const g of guids) {
        if (!g.includes(":::")) continue;
        const sep = g.indexOf(":::");
        const mid = g.slice(0, sep); const rId = Number(g.slice(sep + 3));
        let name = ""; let ifcId = "";
        // IFC GUID holen
        try {
          const ids = await api.viewer.convertToObjectIds(mid, [rId]);
          ifcId = (ids as any)?.[0] ?? "";
        } catch { /* nicht verfügbar */ }
        // Product Name aus Properties
        try {
          const props: any[] = await api.viewer.getObjectProperties(mid, [rId]) as any;
          outer: for (const pset of props ?? []) {
            for (const p of pset?.properties ?? []) {
              const n = (p?.name ?? "").toLowerCase();
              if (n === "name" || n === "product name" || n === "bezeichnung") {
                name = String(p?.value ?? ""); break outer;
              }
            }
          }
        } catch { /* Tekla-Modell: getObjectProperties wirft */ }
        info.set(g, { name: name || `rId: ${rId}`, ifcId });
      }
      setGuidInfo(info);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aktivTask?.id, aktivTask?.objektGuids.length, api]);

  // Hilfsfunktion: Runtime-IDs eines Modells holen
  // Probiert ObjectSelector (DataTable-Format) → Fallback auf string-Format
  async function getModellObjekte(mid: string): Promise<number[]> {
    // Versuch 1: ObjectSelector-Format (gibt ModelObjects[] zurück)
    try {
      const result = await (api!.viewer as any).getObjects({
        modelObjectIds: [{ modelId: mid }]
      }) as any[];
      const ids: number[] = [];
      const seen = new Set<number>();
      for (const r of result ?? []) {
        // Format A: {objectRuntimeIds: number[]}
        for (const rId of r?.objectRuntimeIds ?? []) {
          const n = Number(rId); if (!isNaN(n) && !seen.has(n)) { seen.add(n); ids.push(n); }
        }
        // Format B: {objects: [{id: number}]}
        for (const o of r?.objects ?? []) {
          const n = Number(o?.id ?? o); if (!isNaN(n) && !seen.has(n)) { seen.add(n); ids.push(n); }
        }
      }
      if (ids.length > 0) return ids;
    } catch { /* weiter zu Fallback */ }

    // Versuch 2: string-Format (getObjects(modelId))
    try {
      const rohe = await (api!.viewer as any).getObjects(mid);
      return parseObjectIds(rohe);
    } catch {}

    return [];
  }

  // Erkennt Modell-Typ: Tekla-Export (getObjectProperties wirft für echte Bauteile)
  // vs. Standard IFC (Revit/ArchiCAD — getObjectProperties funktioniert für alle)
  async function detectIstTekla(mid: string, sampleIds: number[]): Promise<boolean> {
    if (modellTypCache.current[mid]) return modellTypCache.current[mid] === 'tekla';
    const start = Math.min(3, Math.max(0, sampleIds.length - 6));
    const sample = sampleIds.slice(start, start + 6);
    if (sample.length === 0) return false;
    const results = await Promise.allSettled(
      sample.map(rId => api!.viewer.getObjectProperties(mid, [rId]))
    );
    const throwCount = results.filter(r => r.status === 'rejected').length;
    const istTekla = throwCount >= Math.ceil(sample.length * 0.7);
    modellTypCache.current[mid] = istTekla ? 'tekla' : 'standard';
    return istTekla;
  }

  // Filtert echte Bauteile — model-type-aware:
  // Standard IFC: alle rIds sind echte Bauteile → direkt zurückgeben
  // Tekla IFC: rejected = echtes Bauteil, fulfilled = Hierarchie
  async function filterEchteBauteile(mid: string, rIds: number[]): Promise<number[]> {
    if (rIds.length === 0) return [];
    const istTekla = await detectIstTekla(mid, rIds);
    if (!istTekla) return rIds; // Standard: alle sind gültig

    const echte: number[] = [];
    const BATCH = 10;
    for (let i = 0; i < rIds.length; i += BATCH) {
      const chunk = rIds.slice(i, i + BATCH);
      const results = await Promise.allSettled(
        chunk.map(rId => api!.viewer.getObjectProperties(mid, [rId]))
      );
      for (let j = 0; j < chunk.length; j++) {
        if (results[j].status === 'rejected') echte.push(chunk[j]);
      }
    }
    return echte;
  }

  // Echte Bauteile eines Modells holen — mit Cache (nur einmal pro Modell/Session)
  async function getEchteBauteile(mid: string): Promise<number[]> {
    const key = `${aktiveSim?.id ?? 'x'}_${mid}`;
    if (echteBauteileCache.current[key]) return echteBauteileCache.current[key];
    const allIds = await getModellObjekte(mid);
    if (allIds.length === 0) { echteBauteileCache.current[key] = []; return []; }

    const istTekla = await detectIstTekla(mid, allIds);
    let echte: number[];
    if (!istTekla) {
      // Standard IFC: IFCSITE + IFCBUILDING + IFCBUILDINGSTOREY = ~3 Hierarchie-Objekte
      // Hierarchie-IDs testen: die ersten getObjectProperties die NICHT werfen = Hierarchie
      const hierarchie = new Set<number>();
      for (const rId of allIds.slice(0, 15)) {
        try { await api!.viewer.getObjectProperties(mid, [rId]); hierarchie.add(rId); }
        catch { break; }
      }
      echte = allIds.filter(id => !hierarchie.has(id));
    } else {
      echte = await filterEchteBauteile(mid, allIds);
    }
    echteBauteileCache.current[key] = echte;
    return echte;
  }
  // Bauteile zählen — nur echte Bauteile (ohne Hierarchie-Container)
  useEffect(() => {
    if (!api || !aktiveSim) return;
    if (aktiveSim.modelle.length === 0) { setTotalObjekte(null); return; }
    echteBauteileCache.current = {};

    (async () => {
      setTotalLaedt(true);
      let gesamt = 0;
      for (const modell of aktiveSim.modelle) {
        if (!modell.id) continue;
        const echte = await getEchteBauteile(modell.id);
        gesamt += echte.length;
      }
      setTotalObjekte(gesamt > 0 ? gesamt : null);
      setTotalLaedt(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aktiveSim?.id, api]);

  // Attribute vorladen — parallele Einzelabfragen + Cancellation-Token gegen Race Condition
  async function ladeAttr() {
    if (!api) return;

    // Nur Modelle der aktiven Simulation (aktivesModellId kann falsches Modell sein!)
    const modelIds = (aktiveSim?.modelle.map(m => m.id).filter(Boolean) ?? []) as string[];

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
      // KEIN obj.class → Layer! class ist der IFC-Typ (IFCSITE etc.), nicht der Layer-Name.
    };

    for (const mid of modelIds) {
      try {
        // Objekte holen — ObjectSelector zuerst, dann string-Fallback
        const allIds = await getModellObjekte(mid);
        if (allIds.length === 0) continue;

        // getObjectProperties pro Objekt
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

        // getLayers: einzige zuverlässige Quelle für Layer-Namen
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

        // GUID (IFC) via convertToObjectIds
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
    if (!api || !selectedAttr || !ifcWert || !aktivTask || !aktiveSim) return;
    setSuchStatus(null);
    setGefundeneIds([]);
    setLaedt(true);

    // Nur Modelle der aktiven Simulation — aktivesModellId NICHT einschliessen
    // (könnte Modell einer anderen Simulation sein → falsche Treffer!)
    const modelIds = aktiveSim.modelle.map(m => m.id).filter(Boolean) as string[];

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
          const allIds = await getModellObjekte(mid);
          if (allIds.length === 0) continue;

          // Fast Path 1: GUID (IFC)
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
            // Versuch: getObjects mit Layer-Property-Filter (wie DataTable)
            let layerGefunden = false;
            try {
              const layerResult = await (api.viewer as any).getObjects({
                modelObjectIds: [{ modelId: mid }],
                parameter: { properties: { Layer: ifcWert } }
              }) as any[];
              const gefunden: number[] = [];
              for (const r of layerResult ?? []) {
                for (const rId of r?.objectRuntimeIds ?? []) {
                  const n = Number(rId); if (!isNaN(n)) gefunden.push(n);
                }
                for (const o of r?.objects ?? []) {
                  const n = Number(o?.id ?? o); if (!isNaN(n)) gefunden.push(n);
                }
              }
              if (gefunden.length > 0) {
                treffenByModel.set(mid, gefunden);
                alleTreffer.push(...gefunden);
                layerGefunden = true;
              }
            } catch {}

            // Fallback: getObjectProperties pro Objekt (nur für Objekte die Properties liefern)
            if (!layerGefunden) {
              for (const rId of allIds) {
                try {
                  const res = await api.viewer.getObjectProperties(mid, [rId]);
                  if (!Array.isArray(res) || res.length === 0) continue;
                  const obj = res[0];
                  let treffer = false;
                  for (const g of (obj?.properties ?? (obj as any)?.groups ?? [])) {
                    if (treffer) break;
                    const gruppenName = g?.name || (g as any)?.displayName || "";
                    if (gruppenName === "Presentation Layers") {
                      for (const p of (g?.properties ?? [])) {
                        if (p?.name === "Layer" && wertPasst(p?.value)) { treffer = true; break; }
                      }
                    }
                  }
                  if (treffer) {
                    if (!treffenByModel.has(mid)) treffenByModel.set(mid, []);
                    treffenByModel.get(mid)!.push(rId);
                    alleTreffer.push(rId);
                  }
                } catch { /* Objekt wirft → kein Layer-Match */ }
              }
            }
            continue;
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

  // Objekte im Viewer markieren — Format "modelId:::rId" oder Legacy "rId"
  // Task anklicken → Bauteile im 3D markieren
  async function taskAnklicken(taskId: string) {
    const istGleich = taskId === aktivTaskId;
    setAktivTaskId(istGleich ? null : taskId);
    if (istGleich) {
      try { await (api?.viewer as any)?.setSelection([]); } catch { /* ignore */ }
    } else {
      const task = aktiveSim?.tasks.find(t => t.id === taskId);
      if (!task || task.objektGuids.length === 0 || !api) return;

      // Stored guids parsen
      const byModel = new Map<string, number[]>();
      for (const g of task.objektGuids) {
        if (g.includes(":::")) {
          const sep = g.indexOf(":::");
          const mid = g.slice(0, sep); const rId = Number(g.slice(sep + 3));
          if (mid && !isNaN(rId)) { if (!byModel.has(mid)) byModel.set(mid, []); byModel.get(mid)!.push(rId); }
        }
      }
      if (byModel.size === 0) return;

      // setSelection mit recursive: false → KEINE Kinder-Expansion mehr!
      const selection = [...byModel.entries()].map(([modelId, rIds]) => ({
        modelId,
        objectRuntimeIds: [...new Set(rIds)],
        recursive: false,   // ← verhindert die 189/411-Expansion
      }));
      try { await (api.viewer as any).setSelection(selection); } catch { /* ignore */ }
    }
  }

  // Gefundene Objekte dem Task hinzufügen — als "modelId:::rId" speichern
  function gefundeneHinzufuegen() {
    if (!aktivTask || gefundeneIds.length === 0 || !aktiveSim) return;

    // Deduplizieren per "modelId:::rId" — gleiche rId in verschiedenen Modellen = verschiedene Objekte!
    const seen = new Set<string>();
    const neueGuids: string[] = [];
    for (const [mid, rIds] of gefundeneByModel.entries()) {
      for (const rId of rIds) {
        const key = `${mid}:::${rId}`;
        if (!seen.has(key)) {
          seen.add(key);
          neueGuids.push(key);
        }
      }
    }

    if (neueGuids.length === 0) return;
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

  // Mausklick-Selektion hinzufügen — filtert Hierarchie-Objekte heraus
  async function selektionHinzufuegen() {
    if (!aktivTask || selektion.length === 0 || !aktiveSim) return;
    const mid = aktivesModellId ?? aktiveSim.modelle[0]?.id;
    if (!mid) return;
    // Nur echte Bauteile speichern (Hierarchie-Objekte werden rausgefiltert)
    const echteIds = await filterEchteBauteile(mid, selektion);
    if (echteIds.length === 0) return;
    const neueGuids = echteIds.map(rId => `${mid}:::${rId}`);
    const bereinigteTasks = aktiveSim.tasks.map(t =>
      t.id === aktivTask.id
        ? { ...t, objektGuids: [...new Set([...t.objektGuids, ...neueGuids])] }
        : { ...t, objektGuids: t.objektGuids.filter(g => !neueGuids.includes(g)) }
    );
    updateSim({ ...aktiveSim, tasks: bereinigteTasks });
  }

  // Sichtbarkeits-Funktionen via setObjectState (umgeht TC's setSelection-Expansion)
  async function nurAnzeigen(guids: string[]) {
    if (!api || !aktiveSim) return;
    const byModel = new Map<string, number[]>();
    for (const g of guids) {
      if (!g.includes(":::")) continue;
      const sep = g.indexOf(":::");
      const mid = g.slice(0, sep); const rId = Number(g.slice(sep + 3));
      if (mid && !isNaN(rId)) { if (!byModel.has(mid)) byModel.set(mid, []); byModel.get(mid)!.push(rId); }
    }
    if (byModel.size === 0) return;

    // Schritt 1: Reset → sauberer Zustand (kein Modell-Level-Hide der Element-Show blockiert)
    try { await api.viewer.reset(); } catch { /* ignore */ }

    // Schritt 2: Inverse-Hide — nur NICHT-Task-Objekte ausblenden (kein Hierarchie-Problem)
    for (const [mid, taskRIds] of byModel.entries()) {
      const taskSet = new Set<number>(taskRIds);
      const alleIds = await getModellObjekte(mid);
      const hideIds = alleIds.filter(id => !taskSet.has(id));
      if (hideIds.length > 0) {
        try { await api.viewer.setObjectState([{ modelId: mid, objectRuntimeIds: hideIds }], { visible: false }); } catch { /* ignore */ }
      }
    }
  }

  async function ausblenden(guids: string[]) {
    if (!api) return;
    const byModel = new Map<string, number[]>();
    for (const g of guids) {
      if (g.includes(":::")) {
        const sep = g.indexOf(":::");
        const mid = g.slice(0, sep); const rId = Number(g.slice(sep + 3));
        if (mid && !isNaN(rId)) { if (!byModel.has(mid)) byModel.set(mid, []); byModel.get(mid)!.push(rId); }
      }
    }
    for (const [mid, rIds] of byModel.entries()) {
      try { await api.viewer.setObjectState([{ modelId: mid, objectRuntimeIds: [...new Set(rIds)] }] as any, { visible: false } as any); } catch { /* ignore */ }
    }
  }

  async function alleEinblenden() {
    if (!api) return;
    try { await api.viewer.reset(); } catch { /* ignore */ }
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
            {selektion.length > 0 && (() => {
              // Nur neue Objekte anzeigen (nicht bereits im Task)
              const bereitsImTask = new Set(
                aktivTask?.objektGuids.map(g => g.includes(":::") ? Number(g.split(":::")[1]) : Number(g)) ?? []
              );
              const neueAnzahl = selektion.filter(rId => !bereitsImTask.has(rId)).length;
              return neueAnzahl > 0 ? (
                <button className="tc-btn-primary" style={{ width: "100%", marginTop: 5, background: "#16a34a", borderColor: "#16a34a" }}
                  onClick={selektionHinzufuegen}>
                  + Hinzufügen ({neueAnzahl} neu)
                </button>
              ) : (
                <div style={{ fontSize: 10, color: "#888", marginTop: 4 }}>
                  Alle ausgewählten Objekte bereits im Task
                </div>
              );
            })()}
          </div>

          {/* Übersicht Bauteile — blauer Info-Block */}
          {(totalObjekte != null || totalLaedt) && (
            <div className="detail-block" style={{
              background: "#EFF6FF",
              border: "0.5px solid #BFDBFE",
              borderRadius: 6,
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 10, color: "#1D4ED8", fontWeight: 600 }}>
                  ⬡ {alleGuids.size} / {totalLaedt ? "…" : totalObjekte} Bauteile zugewiesen
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
                  width: `${totalObjekte ? Math.round((alleGuids.size / totalObjekte) * 100) : 0}%`,
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
                    <button className="tc-btn-primary" title="Nur diese Bauteile anzeigen, alle anderen ausblenden"
                      style={{ fontSize: 10, padding: "3px 8px" }}
                      onClick={() => nurAnzeigen(aktivTask.objektGuids)}>
                      👁 Nur diese
                    </button>
                    <button className="tc-btn-ghost" title="Diese Bauteile ausblenden"
                      onClick={() => ausblenden(aktivTask.objektGuids)}>
                      🚫
                    </button>
                    <button className="tc-btn-ghost" title="Alle Objekte wieder einblenden"
                      onClick={alleEinblenden}>
                      ↺
                    </button>
                    <button className="tc-btn-ghost" style={{ color: "var(--tc-red)" }}
                      onClick={() => speichereGuids(aktivTask.id, [])}>
                      🗑
                    </button>
                  </>
                )}
              </div>
            </div>

            {aktivTask.objektGuids.length > 0 && (
              <div className="guid-list">
                {aktivTask.objektGuids.map((g, i) => {
                  const info = guidInfo.get(g);
                  return (
                    <div key={i} className="guid-row">
                      <div className="guid-row-id" style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 11, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {info?.name ?? g}
                        </div>
                        {info?.ifcId && (
                          <div style={{ fontSize: 9, opacity: 0.55, fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {info.ifcId}
                          </div>
                        )}
                      </div>
                      <button className="guid-row-x" onClick={() => guidEntfernen(aktivTask.id, g)}>✕</button>
                    </div>
                  );
                })}
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