// zugriff.ts — die EINE Stelle für die Zugriffsregeln je Simulation (vorher dreifach in App.tsx,
// TabProjekte.tsx und ZugriffskontrollManager.tsx, jeweils leicht anders formuliert).
//   Ersteller        → immer "edit"
//   sonst            → individueller Eintrag, sonst Standard ("__default__"), sonst "read"
//   Benutzer unbekannt (userId noch nicht geladen) → "read", aber sichtbar
// Rechte verwalten dürfen Ersteller und Admins (Admin-Erkennung siehe ZugriffskontrollManager.tsx).
import type { SimProjekt, Zugriff } from "./types";

export const STANDARD_ZUGRIFF_KEY = "__default__";

type SimZugriff = Pick<SimProjekt, "erstellerId" | "zugriff">;

export function istErsteller(sim: SimZugriff | null | undefined, userId: string | null | undefined): boolean {
  return !!sim && !!userId && sim.erstellerId === userId;
}

export function zugriffFuer(sim: SimZugriff | null | undefined, userId: string | null | undefined): Zugriff {
  if (!sim) return "read";
  if (istErsteller(sim, userId)) return "edit";
  if (!userId) return "read";
  return (sim.zugriff?.[userId] ?? sim.zugriff?.[STANDARD_ZUGRIFF_KEY] ?? "read") as Zugriff;
}

export function darfBearbeiten(sim: SimZugriff | null | undefined, userId: string | null | undefined): boolean {
  return zugriffFuer(sim, userId) === "edit";
}

/** "none" blendet die Simulation aus — solange der Benutzer unbekannt ist, bleibt alles sichtbar */
export function istSichtbar(sim: SimZugriff, userId: string | null | undefined): boolean {
  if (!userId) return true;
  return zugriffFuer(sim, userId) !== "none";
}

export function darfRechteVerwalten(sim: SimZugriff | null | undefined, userId: string | null | undefined, istAdmin: boolean): boolean {
  return !!sim && (istAdmin || istErsteller(sim, userId));
}

/** Kann ausser mir noch jemand bearbeiten? (dann lohnt die Anwesenheitsanzeige) */
export function mitBearbeitungGeteilt(sim: SimZugriff, userId: string | null | undefined): boolean {
  const z = sim.zugriff ?? {};
  if (z[STANDARD_ZUGRIFF_KEY] === "edit") return true;
  if (sim.erstellerId && sim.erstellerId !== userId) return true; // Ersteller kann immer bearbeiten
  return Object.entries(z).some(([uid, zz]) => uid !== STANDARD_ZUGRIFF_KEY && uid !== userId && zz === "edit");
}
