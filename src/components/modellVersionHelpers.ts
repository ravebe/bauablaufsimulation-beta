// modellVersionHelpers.ts — Wechsel der Modellversion einer Simulation inkl. Bauteil-Zuordnungen.
// Task.objektGuids speichert "modelId:::runtimeId". Runtime-IDs vergibt der Viewer aber je Version neu —
// nach einem reinen Versionswechsel zeigen sie auf andere (oder keine) Bauteile. Darum: Runtime-IDs in
// der Quellversion → IFC-GUIDs (stabil über Versionen) → Runtime-IDs in der Zielversion.
import type { Task } from "../types";
import type { ApiInstance } from "../hooks/useApi";
import { batchConvertToObjectIds, batchConvertToRuntimeIds } from "../hooks/useApi";

const pause = (ms: number) => new Promise(r => setTimeout(r, ms));

export interface Umstellung {
  mapping: Map<string, string>; // alter objektGuid → neuer objektGuid
  umgestellt: number;
  nichtGefunden: number;
}

/** Runtime-IDs dieses Modells über alle Tasks */
export function runtimeIdsDesModells(tasks: Task[], mid: string): number[] {
  const ids = new Set<number>();
  for (const t of tasks) for (const g of t.objektGuids) {
    if (!g.startsWith(`${mid}:::`)) continue;
    const n = Number(g.slice(mid.length + 3));
    if (!isNaN(n)) ids.add(n);
  }
  return [...ids];
}

/** Lädt eine Version im Viewer (wiederholt, falls TC sie noch verarbeitet) */
export async function ladeModellVersion(api: ApiInstance, mid: string, versionId: string | undefined): Promise<void> {
  let letzter: unknown = null;
  for (let i = 0; i < 3; i++) {
    try { await api.viewer.toggleModelVersion({ id: mid, versionId }, true, false); return; }
    catch (e) { letzter = e; await pause(3000); }
  }
  throw new Error(`Version konnte nicht geladen werden: ${letzter instanceof Error ? letzter.message : String(letzter)}`);
}

/** Runtime-ID → IFC-GUID in der (zu ladenden) Quellversion */
export async function ifcGuidsInVersion(api: ApiInstance, mid: string, versionId: string | undefined, rIds: number[],
  onVersuch?: (n: number) => void): Promise<Map<number, string>> {
  if (rIds.length === 0) return new Map();
  await ladeModellVersion(api, mid, versionId);
  for (let versuch = 1; versuch <= 12; versuch++) {
    const map = await batchConvertToObjectIds(api, mid, rIds);
    if (map.size > 0) return map;
    onVersuch?.(versuch);
    await pause(5000);
  }
  throw new Error("Keine IFC-GUIDs aus der bisherigen Version erhalten.");
}

/** Lädt die Zielversion und baut alter objektGuid → neuer objektGuid über die IFC-GUIDs auf */
export async function ordneInVersionZu(api: ApiInstance, mid: string, versionId: string, tasks: Task[],
  guidById: Map<number, string>, onVersuch?: (n: number) => void): Promise<Umstellung> {
  const guids = [...new Set(guidById.values())];
  let neueIds = new Map<string, number>();
  for (let versuch = 1; versuch <= 18; versuch++) {
    try { await api.viewer.toggleModelVersion({ id: mid, versionId }, true, false); } catch { /* evtl. noch in Verarbeitung */ }
    if (guids.length === 0) break;
    neueIds = await batchConvertToRuntimeIds(api, mid, guids);
    if (neueIds.size > 0) break;
    onVersuch?.(versuch);
    await pause(10000);
  }
  if (guids.length > 0 && neueIds.size === 0) throw new Error("Die Bauteile wurden in der Zielversion nicht gefunden (Version nicht ladbar?).");

  const mapping = new Map<string, string>();
  let umgestellt = 0, nichtGefunden = 0;
  for (const t of tasks) for (const g of t.objektGuids) {
    if (!g.startsWith(`${mid}:::`) || mapping.has(g)) continue;
    const ifcGuid = guidById.get(Number(g.slice(mid.length + 3)));
    const neuId = ifcGuid ? neueIds.get(ifcGuid) : undefined;
    if (neuId === undefined) { nichtGefunden++; continue; }
    umgestellt++;
    mapping.set(g, `${mid}:::${neuId}`);
  }
  return { mapping, umgestellt, nichtGefunden };
}

/** objektGuids gemäss Mapping umschreiben (nicht gefundene bleiben unverändert) */
export function wendeUmstellungAn(tasks: Task[], mapping: Map<string, string>): Task[] {
  if (mapping.size === 0) return tasks;
  return tasks.map(t => t.objektGuids.some(g => mapping.has(g))
    ? { ...t, objektGuids: t.objektGuids.map(g => mapping.get(g) ?? g) }
    : t);
}

/** Kompletter Wechsel: Bauteile der Quellversion (Zuordnungen stammen von dort) in der Zielversion
 *  wiederfinden. Für einen normalen Wechsel ist quelle = bisher gepinnte Version; zur Reparatur nach
 *  einem Wechsel ohne Neuverknüpfung die Version, in der die Bauteile ursprünglich erfasst wurden. */
export async function stelleVersionUm(api: ApiInstance, mid: string, quelleVersionId: string | undefined, zielVersionId: string,
  tasks: Task[], onSchritt?: (text: string) => void): Promise<Umstellung> {
  onSchritt?.("Bauteile in der bisherigen Version lesen …");
  const guidById = await ifcGuidsInVersion(api, mid, quelleVersionId, runtimeIdsDesModells(tasks, mid),
    n => onSchritt?.(`Bauteile in der bisherigen Version lesen … (Versuch ${n + 1})`));
  onSchritt?.("Neue Version laden und Bauteile zuordnen …");
  return ordneInVersionZu(api, mid, zielVersionId, tasks, guidById,
    n => onSchritt?.(`Neue Version laden und Bauteile zuordnen … (Versuch ${n + 1})`));
}
