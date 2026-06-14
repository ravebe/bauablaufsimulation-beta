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

// Universeller Datum-Parser: akzeptiert YYYY-MM-DD, DD.MM.YYYY, MM/DD/YYYY etc.
export function parseDateUniversal(s: string): Date | null {
  if (!s) return null;
  // DD.MM.YYYY
  const de = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (de) return new Date(Number(de[3]), Number(de[2]) - 1, Number(de[1]));
  // YYYY-MM-DD
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  // MM/DD/YYYY
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (us) return new Date(Number(us[3]), Number(us[1]) - 1, Number(us[2]));
  // Fallback
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

// Datum als DD.MM.YYYY formatieren
export function formatDatum(s: string): string {
  const d = parseDateUniversal(s);
  if (!d) return s;
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
}
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
// Komprimierte IFC-GUID → unkomprimierte UUID pro Dateiname
// Wird für convertToObjectRuntimeIds gebraucht (API erwartet unkomprimierte UUIDs)
export const BEKANNTE_GUID_UUID_MAPS: Record<string, Record<string, string>> = {
  "01_Fundation.ifc": {
    "2RStUXPRzDTODhQYCAgNtz": "9b7377a1-65bf-4d75-836b-6a230aa97dfd",
    "0PSm7dj6TFsRpMdhU9gAoQ": "197301e7-b467-4fd9-bcd6-9eb789a8ac9a",
    "3Yy8jISHLEjAfoVc2X3vYI": "e2f08b52-7115-4eb4-aa72-7e60a10f9892",
    "2dMFD2uuT8RgtbFiFxL14c": "a758f342-e387-486e-ade5-3ec3fb541126",
    "26EP9y5WnBxe$6oD6qLJiT": "8639927c-160c-4bee-8fc6-c8d1b4553b1d",
    "1dYP93zBD3qv43MwQaghQ7": "67899243-f4b3-43d3-9103-5ba6a4aab687",
    "22OfFu1HjB$Au5hzUJCk7h": "826293f8-051b-4bfc-ae05-afd79332e1eb",
    "0wy8wdemn7yOBss5WqhVyI": "3af08ea7-a30c-47f1-82f6-d85834adff12",
    "3UiflBx_P3efXY5_Ms78Cn": "deb29bcb-efe6-43a2-9862-17e5b61c8331",
    "1wds5CjtP1Ux3A$RAT8xAJ": "7a9f614c-b776-417b-b0ca-fdb29d23b293",
  },
  "00_Stützmauer.ifc": {
    "0vrXFjjuHDvxoeqqQIoFsY": "39d613ed-b784-4de7-bca8-d34692c8fda2",
    "3QXZD7dQf6kw6_cUIdzuxj": "da863347-9daa-46bb-a1be-99e4a7f78eed",
    "1wp4DjU212zwtWruHR1WyL": "7acc436d-7820-42f7-ade0-d7845b060f15",
    "2DeAUwEUjEEOr2Amnywcjv": "8da0a7ba-39eb-4e39-8d42-2b0c7cea6b79",
    "18B79q_S15DfFY7suBu1ZR": "482c7274-f9c0-4536-93e2-1f6e0be018db",
    "0uGi26OHP9VO8b_Rq2Hnoy": "3842c086-6116-497d-8225-f9bd02471cbc",
    "1d7go44TP268ceR6y3vuYq": "671eac84-11d6-4218-89a8-6c6f03e788b4",
    "0ldZPaxBX7meqZ72qJDoBn": "2f9e3664-ecb8-47c2-8d23-1c2d133722f1",
  },
};

// Datum validieren: YYYY-MM-DD
export function isValidDatum(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}
