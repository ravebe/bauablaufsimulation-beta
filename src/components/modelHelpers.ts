// modelHelpers.ts — wiederverwendbare TC-API-Hilfsfunktionen
import type { ApiInstance } from "../hooks/useApi";
import { parseObjectIds } from "../types";

// Modul-Level-Caches (persistieren über Re-Renders)
const modellTypCache: Record<string, 'tekla' | 'standard'> = {};
export const echteBauteileCache: Record<string, number[]> = {};
export function clearEchteBauteileCache() {
  Object.keys(echteBauteileCache).forEach(k => delete echteBauteileCache[k]);
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
