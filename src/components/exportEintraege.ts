// exportEintraege.ts — Export-Einträge (alle Gantt-Formate + IFC 4D) für die ⋮-Menüs in Tab Bauteile und
// Tab Abspielen (PunkteMenu). Das ⋮ der Simulationskarte (SimKebabMenu.tsx) nutzt dieselben Formate.
import type { SimProjekt } from "../types";
import { EXPORT_FORMATE } from "./ganttExportFormate";
import type { PunkteMenuEintrag } from "./PunkteMenu";

export function exportEintraege(sim: SimProjekt | null, onIfcExport?: () => void): PunkteMenuEintrag[] {
  if (!sim || sim.tasks.length === 0) return [];
  return [
    ...EXPORT_FORMATE.map(f => ({ label: f.label, onClick: () => f.run(sim.tasks, sim.name, sim.kalender) })),
    ...(onIfcExport ? [{ label: "IFC 4D (.ifc) …", onClick: onIfcExport }] : []),
  ];
}
