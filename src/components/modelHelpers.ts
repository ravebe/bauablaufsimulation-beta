// modelHelpers.ts — wiederverwendbare TC-API-Hilfsfunktionen
import type { ApiInstance } from "../hooks/useApi";
import { batchGetProperties } from "../hooks/useApi";
import { parseObjectIds } from "../types";

// Modul-Level-Caches (persistieren über Re-Renders)
const modellTypCache: Record<string, 'tekla' | 'standard'> = {};
export const echteBauteileCache: Record<string, number[]> = {};
export function clearEchteBauteileCache() {
  Object.keys(echteBauteileCache).forEach(k => delete echteBauteileCache[k]);
}

/** Bauteil-GUIDs (Format "modelId:::runtimeId") in die vom Viewer erwarteten Batches je Modell
 *  gruppieren — gemeinsame Grundlage für alle "Auge"-Buttons (ganzer Task oder einzelnes Bauteil). */
export function guidsZuBatch(guids: string[]): { modelId: string; objectRuntimeIds: number[] }[] {
  const byModel = new Map<string, Set<number>>();
  for (const g of guids) {
    if (!g.includes(":::")) continue;
    const sep = g.indexOf(":::"); const mid = g.slice(0, sep); const rId = Number(g.slice(sep + 3));
    if (mid && !isNaN(rId)) { if (!byModel.has(mid)) byModel.set(mid, new Set()); byModel.get(mid)!.add(rId); }
  }
  return [...byModel.entries()].map(([modelId, rIds]) => ({ modelId, objectRuntimeIds: [...rIds] }));
}

/** Blendet alle Objekte in allen geladenen Modellen aus und zeigt/markiert danach nur `batch` — für
 *  die "Auge"-Buttons in Tab Kalkulation (ganzer Task oder ein einzelnes Bauteil in der aufklappbaren
 *  Liste). isolateEntities allein reichte nicht (blendete nichts sichtbar ein, vermutlich weil die
 *  Methode in der echten TC-Workspace-API anders heißt/anders wirkt als unser eigenes
 *  ApiInstance-Typinterface vermuten ließ); setObjectState ist dagegen an mehreren Stellen im Code
 *  nachweislich funktionsfähig. */
export async function zeigeBauteileImModell(api: ApiInstance, batch: { modelId: string; objectRuntimeIds: number[] }[]): Promise<void> {
  const modelle = await api.viewer.getModels();
  for (const m of modelle) {
    const alleIds = await getModellObjekte(api, m.id);
    if (alleIds.length > 0) await api.viewer.setObjectState({ modelObjectIds: [{ modelId: m.id, objectRuntimeIds: alleIds }] }, { visible: false });
  }
  await api.viewer.setObjectState({ modelObjectIds: batch }, { visible: true });
  const viewerSetSelection = api.viewer as unknown as {
    setSelection: (sel: { modelObjectIds: { modelId: string; objectRuntimeIds: number[] }[] }, mode: string) => Promise<void>;
  };
  await viewerSetSelection.setSelection({ modelObjectIds: batch }, "set");
}

export async function getModellObjekte(api: ApiInstance, mid: string): Promise<number[]> {
  try {
    const result = await (api.viewer as any).getObjects({ modelObjectIds: [{ modelId: mid }] }) as any[];
    const ids: number[] = []; const seen = new Set<number>();
    for (const r of result ?? []) {
      for (const rId of r?.objectRuntimeIds ?? []) { const n = Number(rId); if (!isNaN(n) && !seen.has(n)) { seen.add(n); ids.push(n); } }
      for (const o of r?.objects ?? []) { const n = Number(o?.id ?? o); if (!isNaN(n) && !seen.has(n)) { seen.add(n); ids.push(n); } }
    }
    if (ids.length > 0) return ids;
  } catch {}
  try { return parseObjectIds(await (api.viewer as any).getObjects(mid)); } catch {}
  return [];
}

export async function detectIstTekla(api: ApiInstance, mid: string, sampleIds: number[]): Promise<boolean> {
  if (modellTypCache[mid]) return modellTypCache[mid] === 'tekla';
  const start = Math.min(3, Math.max(0, sampleIds.length - 6));
  const sample = sampleIds.slice(start, start + 6);
  if (sample.length === 0) return false;
  const results = await Promise.allSettled(sample.map(rId => api.viewer.getObjectProperties(mid, [rId])));
  const throwCount = results.filter(r => r.status === 'rejected').length;
  const istTekla = throwCount >= Math.ceil(sample.length * 0.7);
  modellTypCache[mid] = istTekla ? 'tekla' : 'standard';
  return istTekla;
}

export async function filterEchteBauteile(api: ApiInstance, mid: string, rIds: number[]): Promise<number[]> {
  if (rIds.length === 0) return [];
  const istTekla = await detectIstTekla(api, mid, rIds);
  if (!istTekla) return rIds;
  const echte: number[] = [];
  const BATCH = 10;
  for (let i = 0; i < rIds.length; i += BATCH) {
    const chunk = rIds.slice(i, i + BATCH);
    const results = await Promise.allSettled(chunk.map(rId => api.viewer.getObjectProperties(mid, [rId])));
    for (let j = 0; j < chunk.length; j++) { if (results[j].status === 'rejected') echte.push(chunk[j]); }
  }
  return echte;
}

// Flaches Attribut-Set eines Objekts ("Pset||Property" → Wert), rekursiv über verschachtelte
// Property-Gruppen — dieselbe Konvention wie in TabTasks.tsx/AttributeFilter.tsx.
export interface ObjWerte { [key: string]: string; }

function sammelPropWerte(obj: ObjWerte, gruppe: any, gruppenName: string) {
  for (const p of gruppe?.properties ?? gruppe?.items ?? []) {
    if (!p?.name) continue;
    const sub = p?.properties ?? p?.items;
    if (Array.isArray(sub) && sub.length > 0) { sammelPropWerte(obj, p, p.name); continue; }
    const v = String(p?.value ?? "").trim();
    if (v && v !== "null" && v !== "undefined") obj[`${gruppenName}||${p.name}`] = v;
  }
}

/**
 * Lädt für eine Liste von "modelId:::runtimeId"-GUIDs (task.objektGuids) alle Attribut-Werte
 * (Psets, Product, Layer) — Grundlage für die Formel-Auswertung in Tab Kalkulation.
 */
export async function ladeObjektAttribute(api: ApiInstance, guids: string[]): Promise<Map<string, ObjWerte>> {
  const werte = new Map<string, ObjWerte>();
  const nachModell = new Map<string, { g: string; rId: number }[]>();
  for (const g of guids) {
    if (!g.includes(":::")) continue;
    const sep = g.indexOf(":::");
    const mid = g.slice(0, sep); const rId = Number(g.slice(sep + 3));
    if (!nachModell.has(mid)) nachModell.set(mid, []);
    nachModell.get(mid)!.push({ g, rId });
    werte.set(g, {});
  }

  for (const [mid, eintraege] of nachModell) {
    const rIds = eintraege.map(e => e.rId);
    const objByRId = new Map(eintraege.map(e => [e.rId, e.g]));

    try {
      const props = await batchGetProperties(api, mid, rIds);
      for (const entry of props) {
        const g = objByRId.get(entry.id);
        if (!g) continue;
        const obj = werte.get(g)!;
        sammelPropWerte(obj, entry, (entry as any)?.name || "Eigenschaften");
        if (entry.product) {
          const p = entry.product;
          if (p.name) obj["Product||Product Name"] = String(p.name);
          if (p.objectType) obj["Reference Object||Common Type"] = String(p.objectType);
          if (p.description) obj["Product||Description"] = String(p.description);
        }
      }
    } catch {}

    try {
      const layers = await api.viewer.getLayers(mid) as any[];
      if (Array.isArray(layers)) {
        for (const l of layers) {
          if (!l?.name) continue;
          for (const rId of (l as any)?.objectRuntimeIds ?? []) {
            const g = objByRId.get(rId);
            if (g) werte.get(g)!["Layer||Layer"] = String(l.name);
          }
        }
      }
    } catch {}
  }

  return werte;
}

export interface AttrItem { pset: string; name: string; key: string; }

/** "Pset||Property" → { pset, name, key } für die Anzeige im Attribut-Picker. */
export function keyZuAttrItem(key: string): AttrItem {
  const sep = key.indexOf("||");
  return sep === -1 ? { pset: "", name: key, key } : { pset: key.slice(0, sep), name: key.slice(sep + 2), key };
}

/** Attribut-Schlüssel aus den Werten mehrerer Bauteile ableiten (z.B. Ergebnis von ladeObjektAttribute). */
export function attrItemsAusWerten(werteListe: Iterable<ObjWerte>): AttrItem[] {
  const attrs = new Map<string, AttrItem>();
  for (const obj of werteListe) for (const key of Object.keys(obj)) if (!attrs.has(key)) attrs.set(key, keyZuAttrItem(key));
  return [...attrs.values()].sort((a, b) => a.key.localeCompare(b.key));
}

/** Liste bekannter Attribut-Schlüssel aus einer BLINDEN Objekt-Stichprobe des Modells — Fallback für
 *  den Attribut-Picker (Tab Ressourcen), wenn weder eine Viewer-Selektion noch bereits zugeordnete
 *  Bauteile vorhanden sind. Blind, weil die ersten N Runtime-IDs oft Hierarchie-Knoten (Site/Building/
 *  Storey) ohne die gesuchten Mengen-Attribute sind — deshalb nur letzter Ausweg. */
export async function ladeAttributListe(api: ApiInstance, modelId: string): Promise<AttrItem[]> {
  const allIds = await getModellObjekte(api, modelId);
  const probeIds = allIds.slice(0, Math.min(30, allIds.length));
  if (probeIds.length === 0) return [];
  const guids = probeIds.map(rId => `${modelId}:::${rId}`);
  const werte = await ladeObjektAttribute(api, guids);
  return attrItemsAusWerten(werte.values());
}

// --- Was ist ein "echtes" Bauteil? ---
// IFC-Klassen ohne physisches Bauteil: Struktur (Projekt/Gelände/Gebäude/Geschoss), Räume/Zonen, Öffnungen,
// Raster, Beschriftungen, virtuelle Elemente, Anschlüsse. Früher zählten diese bei normalen IFC-Modellen mit
// (es wurden nur die ersten 15 Objekte geprüft) und standen dauerhaft unter "Noch nicht verknüpft"/"offen".
const KEINE_BAUTEIL_KLASSEN = new Set([
  "project", "site", "building", "buildingstorey", "facility", "facilitypart", "bridge", "road", "railway",
  "space", "spatialzone", "externalspatialelement", "zone", "spatialelement",
  "openingelement", "opening", "voidingfeature", "projectionelement", "surfacefeature",
  "virtualelement", "annotation", "grid", "gridaxis", "distributionport", "port", "alignment", "referent",
]);

// Behälter: IfcElementAssembly fasst Einzelteile zusammen, die selbst verknüpft werden — die Baugruppe ist
// kein eigenes Bauteil (sonst stünde jede Baugruppe dauerhaft unter "Noch nicht verknüpft"). Ausnahme:
// in der Simulation direkt einem Task zugeordnete Baugruppen (dann als Einheit verwendet) zählen.
const BEHAELTER_KLASSEN = new Set(["elementassembly"]);

const klasseNorm = (klasse: string) => klasse.toLowerCase().replace(/^ifc/, "").replace(/standardcase$/, "").replace(/[^a-z]/g, "");

export function istBehaelterKlasse(klasse: string | undefined | null): boolean {
  return !!klasse && BEHAELTER_KLASSEN.has(klasseNorm(klasse));
}

/** IFC-Klasse ("IfcOpeningElement", "IFCOPENINGELEMENT", "IfcWallStandardCase" …) → physisches Bauteil?
 *  Unbekannt/leer → ja (lieber zu viel zeigen als ein echtes Bauteil verstecken). */
export function istBauteilKlasse(klasse: string | undefined | null): boolean {
  if (!klasse) return true;
  return !KEINE_BAUTEIL_KLASSEN.has(klasseNorm(klasse));
}

// IFC-Klasse je Objekt — einmal je Modell und Sitzung geladen (Modell ändert sich nicht; neue Version = neue
// Runtime-IDs, dann wird neu geladen). null = Objekt liefert keine Eigenschaften (Datei-/Gruppenknoten).
const klassenCache = new Map<string, Map<number, string | null>>();

export async function ladeObjektKlassen(api: ApiInstance, mid: string, rIds: number[]): Promise<Map<number, string | null>> {
  if (!klassenCache.has(mid)) klassenCache.set(mid, new Map());
  const cache = klassenCache.get(mid)!;
  const fehlend = rIds.filter(id => !cache.has(id));
  const BATCH = 100, PARALLEL = 4;
  const pakete: number[][] = [];
  for (let i = 0; i < fehlend.length; i += BATCH) pakete.push(fehlend.slice(i, i + BATCH));
  for (let i = 0; i < pakete.length; i += PARALLEL) {
    await Promise.all(pakete.slice(i, i + PARALLEL).map(async paket => {
      try {
        const res = await api.viewer.getObjectProperties(mid, paket);
        const gefunden = new Set<number>();
        for (const o of Array.isArray(res) ? res : []) { cache.set(o.id, o.class ?? ""); gefunden.add(o.id); }
        for (const id of paket) if (!gefunden.has(id)) cache.set(id, null);
      } catch {
        // ganzes Paket abgelehnt → einzeln (ein einzelnes Problem-Objekt soll nicht 100 andere mitreissen)
        for (const id of paket) {
          try { const r = await api.viewer.getObjectProperties(mid, [id]); cache.set(id, r?.[0]?.class ?? ""); }
          catch { cache.set(id, null); }
        }
      }
    }));
  }
  return new Map(rIds.map(id => [id, cache.get(id) ?? null]));
}

/** @param verknuepft Bauteile ("modelId:::runtimeId"), die in der Simulation einem Task zugeordnet sind —
 *  Baugruppen zählen nur, wenn sie selbst darunter sind (siehe BEHAELTER_KLASSEN) */
export async function getEchteBauteile(api: ApiInstance, simId: string, mid: string, verknuepft: Set<string> = new Set()): Promise<number[]> {
  const key = `${simId}_${mid}`;
  if (echteBauteileCache[key]) return echteBauteileCache[key];
  const allIds = await getModellObjekte(api, mid);
  if (allIds.length === 0) { echteBauteileCache[key] = []; return []; }
  const istTekla = await detectIstTekla(api, mid, allIds);
  let echte: number[];
  if (!istTekla) {
    const klassen = await ladeObjektKlassen(api, mid, allIds);
    const weg = new Map<string, number>();
    echte = allIds.filter(id => {
      const k = klassen.get(id);
      const ok = k !== null && istBauteilKlasse(k) && (!istBehaelterKlasse(k) || verknuepft.has(`${mid}:::${id}`));
      if (!ok) { const n = k === null ? "(ohne Eigenschaften)" : (k || "?"); weg.set(n, (weg.get(n) ?? 0) + 1); }
      return ok;
    });
    console.log(`[Bauteile] Modell ${mid}: ${allIds.length} Objekte, davon ${echte.length} Bauteile — nicht gezählt:`,
      Object.fromEntries([...weg].sort((a, b) => b[1] - a[1])));
  } else {
    echte = await filterEchteBauteile(api, mid, allIds);
  }
  echteBauteileCache[key] = echte;
  return echte;
}

/** IFC-Klasse aus dem Cache (für Anzeige), falls schon geladen */
export function bekannteKlasse(mid: string, rId: number): string | null | undefined {
  return klassenCache.get(mid)?.get(rId);
}
