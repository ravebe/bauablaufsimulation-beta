// undoVerlauf.ts — reine Logik für Rückgängig/Wiederholen (ohne React, testbar), siehe useUndo.ts.
// Gespeichert wird jeweils die ganze Simulationsliste — so lassen sich auch Anlegen, Löschen, Kopieren,
// Gantt-Import usw. zurücknehmen (vorher nur Änderungen über updateSim). Billig, weil unveränderte
// Simulationen zwischen den Ständen dieselben Objekte sind (keine Kopien).
import type { SimProjekt } from "../types";

export interface Verlauf { undo: SimProjekt[][]; redo: SimProjekt[][]; }

export const LEERER_VERLAUF: Verlauf = { undo: [], redo: [] };
export const MAX_SCHRITTE = 15;

/** Gleicher Stand? (gleiche Länge, dieselben Objekte an denselben Stellen) — dann kein Rückgängig-Schritt */
export function gleicherStand(a: SimProjekt[], b: SimProjekt[]): boolean {
  return a === b || (a.length === b.length && a.every((s, i) => s === b[i]));
}

/** Vor einer Änderung: bisherigen Stand merken, Wiederholen-Stapel verwerfen */
export function aufzeichnen(v: Verlauf, vorher: SimProjekt[], max = MAX_SCHRITTE): Verlauf {
  return { undo: [...v.undo.slice(-(max - 1)), vorher], redo: [] };
}

/** Rückgängig: letzter Stand zurück, aktueller auf den Wiederholen-Stapel; null = nichts zu tun */
export function rueckgaengig(v: Verlauf, aktuell: SimProjekt[]): { verlauf: Verlauf; stand: SimProjekt[] } | null {
  if (v.undo.length === 0) return null;
  return { verlauf: { undo: v.undo.slice(0, -1), redo: [...v.redo, aktuell] }, stand: v.undo[v.undo.length - 1] };
}

export function wiederholen(v: Verlauf, aktuell: SimProjekt[]): { verlauf: Verlauf; stand: SimProjekt[] } | null {
  if (v.redo.length === 0) return null;
  return { verlauf: { undo: [...v.undo, aktuell], redo: v.redo.slice(0, -1) }, stand: v.redo[v.redo.length - 1] };
}
