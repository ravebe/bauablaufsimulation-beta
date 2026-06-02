export type TaskTyp = "neubau" | "bestand" | "abbruch";

export interface Task {
  id: string;
  name: string;
  start: string;   // YYYY-MM-DD
  end: string;     // YYYY-MM-DD
  typ: TaskTyp;
  objektGuids: string[]; // Runtime IDs als strings
}

export interface SimModell {
  id: string;   // modelId aus TC
  name: string; // Dateiname z.B. "23.ifc"
}

export interface SimProjekt {
  id: string;
  name: string;
  erstelltAm: string; // ISO string
  tasks: Task[];
  modelle: SimModell[];
}

// TC API Typen
export interface TcModel {
  modelId: string;
  name: string;
  fileName?: string;
}

export interface TcObjectProperty {
  name: string;
  value: string;
}

export interface TcPropertySet {
  name: string;
  properties: TcObjectProperty[];
}

export interface TcObjectWithProps {
  id: number;
  properties: TcPropertySet[];
}

export interface TcSelectionEvent {
  data: Array<{
    modelId: string;
    objectRuntimeIds: number[];
  }>;
}

// Hilfsfunktion: Runtime IDs aus getObjects() Response parsen
export function parseObjectIds(rohe: unknown): number[] {
  if (!Array.isArray(rohe)) return [];
  const ids: number[] = [];
  for (const item of rohe) {
    if (Array.isArray((item as any)?.objects)) {
      for (const o of (item as any).objects) {
        const n = Number(o?.id ?? o);
        if (!isNaN(n)) ids.push(n);
      }
    } else if (typeof item === "number") {
      ids.push(item);
    } else if ((item as any)?.id != null) {
      const n = Number((item as any).id);
      if (!isNaN(n)) ids.push(n);
    }
  }
  return ids;
}

// Datum validieren: YYYY-MM-DD
export function isValidDatum(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

// localStorage Keys
export const SIMS_KEY = "4d-sims-v3";
export const AKTIV_KEY = "4d-aktiv-v3";
