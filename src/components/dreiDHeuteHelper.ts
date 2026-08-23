// dreiDHeuteHelper.ts — Baut den 3D-Zustand des Modells (sichtbar/ausgeblendet/eingefärbt) für
// einen bestimmten Kalendertag auf. Eigenständige, reduzierte Kopie der Kernlogik aus
// TabAbspielen.tsx::zustandBeiTag — bewusst getrennt gehalten, damit andere Tabs (z.B. der
// "Heute"-Button in Tab Kosten) direkt in den 3D-Baufortschritt eines Tages springen können, ohne
// den Abspielen-Player-State (Playback-Loop, Event-Tracking, Farbmodus-Toggle) mit anzufassen.
import type { Task } from "../types";
import { parseDateUniversal } from "../types";
import type { ApiInstance } from "../hooks/useApi";

export const TYP_FARBEN = { neubau: "#6cc07a", bestand: "#999999", abbruch: "#edb94c", temporaer: "#a0522d" };

export function tagVonDatum(datum: string, min: Date): number {
  const d = parseDateUniversal(datum);
  if (!d) return 0;
  return Math.round((d.getTime() - min.getTime()) / 86400000);
}

function zuBatch(guids: string[]): { modelId: string; objectRuntimeIds: number[] }[] {
  const byModel = new Map<string, Set<number>>();
  for (const g of guids) {
    if (!g.includes(":::")) continue;
    const sep = g.indexOf(":::"); const mid = g.slice(0, sep); const rId = Number(g.slice(sep + 3));
    if (mid && !isNaN(rId)) { if (!byModel.has(mid)) byModel.set(mid, new Set()); byModel.get(mid)!.add(rId); }
  }
  return [...byModel.entries()].map(([modelId, rIds]) => ({ modelId, objectRuntimeIds: [...rIds] }));
}

async function setzeZustand(api: ApiInstance, guids: string[], opts: { visible?: boolean; color?: string | null }) {
  if (guids.length === 0) return;
  const batch = zuBatch(guids);
  if (batch.length === 0) return;
  try { await api.viewer.setObjectState({ modelObjectIds: batch } as any, opts as any); } catch { /* ignore */ }
}

function setzeZustandAsync(api: ApiInstance, guids: string[], opts: { visible?: boolean; color?: string | null }) {
  if (guids.length === 0) return;
  const batch = zuBatch(guids);
  if (batch.length === 0) return;
  api.viewer.setObjectState({ modelObjectIds: batch } as any, opts as any).catch(() => {});
}

async function selektieren(api: ApiInstance, guids: string[]) {
  if (guids.length === 0) return;
  try { await (api.viewer as any).setSelection({ modelObjectIds: zuBatch(guids) }, "set"); } catch { /* ignore */ }
}

/** Baut den 3D-Zustand für einen bestimmten Tag auf (Sichtbarkeit + Typ-Einfärbung + Selektion der
 * aktiven Neubau-Objekte) und gibt die an diesem Tag aktiven Tasks zurück. */
export async function dreiDZustandAufTagSetzen(api: ApiInstance, tasks: Task[], minDate: Date, tag: number, farbeEin = true): Promise<Task[]> {
  const showGuids: string[] = [];
  const hideGuids: string[] = [];
  const colorBestand: string[] = [];
  const colorAbbruch: string[] = [];
  const colorNeubau: string[] = [];
  const colorTemp: string[] = [];
  const selGuidsLocal: string[] = [];
  const aktive: Task[] = [];

  for (const t of tasks) {
    if (t.objektGuids.length === 0) continue;
    const s = tagVonDatum(t.start, minDate);
    const e = t.end ? tagVonDatum(t.end, minDate) : s;

    if (t.typ === "neubau") {
      if (tag >= s) {
        showGuids.push(...t.objektGuids);
        if (tag <= e) { selGuidsLocal.push(...t.objektGuids); aktive.push(t); }
        if (farbeEin) colorNeubau.push(...t.objektGuids);
      } else hideGuids.push(...t.objektGuids);
    } else if (t.typ === "bestand") {
      showGuids.push(...t.objektGuids); colorBestand.push(...t.objektGuids);
    } else if (t.typ === "abbruch") {
      if (tag > e) hideGuids.push(...t.objektGuids);
      else { showGuids.push(...t.objektGuids); if (tag >= s) colorAbbruch.push(...t.objektGuids); if (tag >= s) aktive.push(t); }
    } else if (t.typ === "temporaer") {
      if (tag > e) hideGuids.push(...t.objektGuids);
      else { showGuids.push(...t.objektGuids); if (farbeEin && tag >= s) colorTemp.push(...t.objektGuids); if (tag >= s) aktive.push(t); }
    }
  }

  if (hideGuids.length > 0) await setzeZustand(api, hideGuids, { visible: false });
  if (showGuids.length > 0) await setzeZustand(api, showGuids, { visible: true });
  if (colorBestand.length > 0) setzeZustandAsync(api, colorBestand, { color: TYP_FARBEN.bestand });
  if (colorAbbruch.length > 0) setzeZustandAsync(api, colorAbbruch, { color: TYP_FARBEN.abbruch });
  if (colorNeubau.length > 0) setzeZustandAsync(api, colorNeubau, { color: TYP_FARBEN.neubau });
  if (colorTemp.length > 0) setzeZustandAsync(api, colorTemp, { color: TYP_FARBEN.temporaer });
  if (selGuidsLocal.length > 0) await selektieren(api, selGuidsLocal);

  return aktive;
}
