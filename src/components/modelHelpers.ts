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
    if (alleIds.length > 0) await api.viewer.setObjectState([{ modelId: m.id, objectRuntimeIds: alleIds }], { visible: false });
  }
  await api.viewer.setObjectState(batch, { visible: true });
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

export async function getEchteBauteile(api: ApiInstance, simId: string, mid: string): Promise<number[]> {
  const key = `${simId}_${mid}`;
  if (echteBauteileCache[key]) return echteBauteileCache[key];
  const allIds = await getModellObjekte(api, mid);
  if (allIds.length === 0) { echteBauteileCache[key] = []; return []; }
  const istTekla = await detectIstTekla(api, mid, allIds);
  let echte: number[];
  if (!istTekla) {
    const hierarchie = new Set<number>();
    for (const rId of allIds.slice(0, 15)) {
      try { await api.viewer.getObjectProperties(mid, [rId]); hierarchie.add(rId); } catch { break; }
    }
    echte = allIds.filter(id => !hierarchie.has(id));
  } else {
    echte = await filterEchteBauteile(api, mid, allIds);
  }
  echteBauteileCache[key] = echte;
  return echte;
}
