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
  ifcGuidLayerMap?: Record<string, string>; // GUID → Layer-Name (aus IFC-Parsing)
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
  class?: string;                          // → Presentation Layers > Layer
  product?: {                              // → Reference Object / Product PSets
    name?: string;                         // → Product Name
    description?: string;                  // → Product Description
    objectType?: string;                   // → Common Type (z.B. REINFORCINGBAR)
  };
  properties?: TcPropertySet[];
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

// Vollständige Objekt-Metadaten aus getObjects() Response — layer, name, class etc.
export interface TcObjectMeta {
  id: number;
  layer?: string;
  name?: string;
  class?: string;
  [key: string]: unknown;
}

export function parseObjectsRaw(rohe: unknown): TcObjectMeta[] {
  if (!Array.isArray(rohe)) return [];
  const objs: TcObjectMeta[] = [];
  for (const item of rohe) {
    if (Array.isArray((item as any)?.objects)) {
      for (const o of (item as any).objects) {
        const n = Number(o?.id ?? o);
        if (!isNaN(n)) objs.push({ ...o, id: n });
      }
    } else if (typeof item === "number") {
      objs.push({ id: item });
    } else if ((item as any)?.id != null) {
      const n = Number((item as any).id);
      if (!isNaN(n)) objs.push({ ...item, id: n });
    }
  }
  return objs;
}

// Hilfsfunktion: IFC-Datei parsen → GUID→Layer-Mapping
export function parseIfcLayerMap(ifcContent: string): Record<string, string> {
  const guidToLayer: Record<string, string> = {};
  // Entity-Lookup: id → Zeile
  const entities: Record<string, string> = {};
  for (const m of ifcContent.matchAll(/^#(\d+)=\s*(.+)$/gm)) {
    entities[m[1]] = m[2];
  }
  // IFCPRESENTATIONLAYERASSIGNMENT → ShapeRep → ProductShape → Objekt → GUID
  for (const m of ifcContent.matchAll(/IFCPRESENTATIONLAYERASSIGNMENT\('([^']+)'[^(]*\(([^)]+)\)/g)) {
    const layerName = m[1].replace(/\\S\\\|/g, 'ü').replace(/\\S\\\{/g, 'ö').replace(/\\S\\]/g, 'ä');
    const shapeIds = [...m[2].matchAll(/#(\d+)/g)].map(r => r[1]);
    for (const shapeId of shapeIds) {
      // ProductDefinitionShape die diesen ShapeRep enthält
      for (const [prodId, prodLine] of Object.entries(entities)) {
        if (!prodLine.startsWith('IFCPRODUCTDEFINITIONSHAPE')) continue;
        if (!prodLine.includes(`#${shapeId}`)) continue;
        // Bauelement das diesen ProductShape nutzt
        for (const objLine of Object.values(entities)) {
          if (!/^IFC(WALL|SLAB|FOOTING|COLUMN|BEAM|BUILDINGELEMENTPROXY|MEMBER|PLATE)/.test(objLine)) continue;
          if (!objLine.includes(`#${prodId}`)) continue;
          const guidMatch = objLine.match(/\('([^']{22})'/);
          if (guidMatch) guidToLayer[guidMatch[1]] = layerName;
        }
      }
    }
  }
  return guidToLayer;
}

// localStorage Keys
export const SIMS_KEY = "4d-sims-v3";
export const AKTIV_KEY = "4d-aktiv-v3";

// Bekannte GUID→Layer-Mappings pro IFC-Dateiname
// Wird in TabProjekte beim Speichern von Modellen automatisch zugeordnet
export const BEKANNTE_GUID_LAYER_MAPS: Record<string, Record<string, string>> = {
  "01_Fundation.ifc": {
    "2RStUXPRzDTODhQYCAgNtz": "Bodenplatte",
    "0PSm7dj6TFsRpMdhU9gAoQ": "Bodenplatte",
    "3Yy8jISHLEjAfoVc2X3vYI": "Bodenplatte",
    "2dMFD2uuT8RgtbFiFxL14c": "Einzelfundament",
    "26EP9y5WnBxe$6oD6qLJiT": "Einzelfundament",
    "1dYP93zBD3qv43MwQaghQ7": "Schachtwand",
    "22OfFu1HjB$Au5hzUJCk7h": "Schachtwand",
    "0wy8wdemn7yOBss5WqhVyI": "Schachtwand",
    "3UiflBx_P3efXY5_Ms78Cn": "Schachtwand",
    "1wds5CjtP1Ux3A$RAT8xAJ": "Schachtkopfplatte",
  },
  "00_Stützmauer.ifc": {
    "0vrXFjjuHDvxoeqqQIoFsY": "Streifenfundament",
    "3QXZD7dQf6kw6_cUIdzuxj": "Streifenfundament",
    "1wp4DjU212zwtWruHR1WyL": "Streifenfundament",
    "2DeAUwEUjEEOr2Amnywcjv": "Streifenfundament",
    "18B79q_S15DfFY7suBu1ZR": "Stützmauerwand_Anzug",
    "0uGi26OHP9VO8b_Rq2Hnoy": "Stützmauerwand_Anzug",
    "1d7go44TP268ceR6y3vuYq": "Stützmauerwand_Anzug",
    "0ldZPaxBX7meqZ72qJDoBn": "Stützmauerwand_Anzug",
  },
};
// Datum validieren: YYYY-MM-DD
export function isValidDatum(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}
