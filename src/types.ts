import type { Kalender } from "./components/kalenderHelpers";
import { arbeitstageZwischen, LEERER_KALENDER, arbeitstagPlus, arbeitstageVersatz } from "./components/kalenderHelpers";
import type { Stammdaten } from "./components/stammdatenHelpers";
import type { Zeiteinheit, Zeitpunkt } from "./components/zeitHelpers";
import { meilensteinZeitpunkt, meilensteinFelder, startZeitpunkt, endZeitpunkt, zeitFelder, naechsteArbeitszeit, letzteArbeitszeit, arbeitsMinutenZwischen, endeAusArbeitsMinuten, startAusArbeitsMinuten, folgeStartZeitpunkt, vergleicheZeitpunkte, zeitZuMin, ARBEITSBEGINN_MIN, ARBEITSENDE_MIN } from "./components/zeitHelpers";

export type TaskTyp = "neubau" | "bestand" | "abbruch" | "temporaer" | "baustelleneinrichtung" | "drittprojekt";

// Anzeige-Reihenfolge + deutsches Label je Typ — "temporaer" heisst intern weiterhin so (bestehende
// Simulationsdaten speichern diesen Key), wird aber überall als "Bauhilfsmassnahme" angezeigt (Begriff
// aus buildingSMART UCM #3509). Einzige Stelle für Typ-Labels, damit eine künftige Umbenennung nicht an
// einzelnen Stellen vergessen werden kann.
export const TASK_TYP_LISTE: TaskTyp[] = ["neubau", "bestand", "abbruch", "temporaer", "baustelleneinrichtung", "drittprojekt"];
export const TASK_TYP_LABEL: Record<TaskTyp, string> = {
  neubau: "Neubau", bestand: "Bestand", abbruch: "Abbruch", temporaer: "Bauhilfsmassnahme",
  baustelleneinrichtung: "Baustelleneinrichtung", drittprojekt: "Drittprojekt",
};
// Gemeinsame Farbpalette für GanttChart/TabAbspielen/dreiDHeuteHelper (waren zuvor drei identische,
// unabhängig gepflegte Kopien).
export const TASK_TYP_FARBE: Record<TaskTyp, string> = {
  neubau: "#6cc07a", bestand: "#999999", abbruch: "#edb94c", temporaer: "#a0522d",
  baustelleneinrichtung: "#4a90d9", drittprojekt: "#9b8ec4",
};

export interface Task {
  id: string;
  name: string;
  start: string;   // YYYY-MM-DD
  end: string;     // YYYY-MM-DD
  typ: TaskTyp;
  objektGuids: string[]; // Runtime IDs als strings
  extraSpalten?: Record<string, string>; // Zusätzliche Gantt-Spalten für Auto-Verknüpfung
  outlineLevel?: number; // 1 = Hauptebene, 2+ = Kind (MSP-kompatibel)
  isGroup?: boolean; // true = Gruppentitel (keine Bauteile, kein Typ)
  predecessorId?: string; // ID des (ersten) Vorgänger-Tasks
  lagDays?: number; // Wartetage nach Vorgänger-Ende (default 0)
  meilenstein?: boolean; // Meilenstein: Dauer 0, Ende = Start (Raute im Gantt) — wie in MS Project
  startZeit?: string; // "HH:MM" bei Zeiteinheit Halbtage/Uhrzeit — fehlt = 08:00 (siehe zeitHelpers.ts)
  endZeit?: string;   // "HH:MM" — fehlt = 17:00
  weitereVorgaenger?: { id: string; lagDays: number }[]; // 2. bis 30. Vorgänger mit eigenen Wartetagen (wie MS Project) — siehe vorgaengerListe()
  bauteilKuerzel?: string; // Bauteil-Kürzel für die Kalkulation (z.B. "WB"), siehe stammdatenHelpers.ts
  mengen?: Record<string, number>; // Gewerk-key → Menge, für die Menge→Tage-Kalkulation
  mengenQuelle?: Record<string, "auto" | "manuell" | "fehler">; // Herkunft je Gewerk-key — steuert Farbe (blau/schwarz/rot) in Tab Kalkulation
  mengenInfo?: Record<string, string>; // Tooltip-Text bei Status "fehler" (z.B. fehlende Attribute), siehe formelHelpers.ts
  mengenObjekte?: Record<string, Record<string, number>>; // Gewerk-key → Bauteil-GUID (objektGuids-Eintrag) → manuell gesetzter Einzelwert, überschreibt für genau dieses Bauteil den Formel-Wert — siehe Bauteil-Liste in Tab Kalkulation
  berechneteDauerManuell?: number; // manuelle Übersteuerung der "Berechnet"-Spalte in Tab Kalkulation (schwarz statt blau) — siehe dauerBerechnetTask() in stammdatenHelpers.ts
  kranbereich?: string; // reine Gruppierung/Bauphase (IFC-Pset "Bauphase") — für die Kranauswertung
                        // siehe stattdessen kraene; kein Parallel-Datenmodell zu kraene
  kraene?: string[]; // Kran-IDs (SimProjekt.kraene) — mehrere = Schnittstellen-Task zwischen Kränen,
                      // Anteil IMMER automatisch gleichmässig verteilt (2→0.5, 3→0.33…), siehe kranHelpers.ts
  /** @deprecated Personal (Soll) wird nicht mehr erfasst oder ausgewertet — eingeplantes Personal kommt aus Tab Ressourcen (Kräne & Personal, Kolonnen); nur noch in alten Projekten vorhanden */
  personalSoll?: number;
  /** Stand aus "Auslastung optimieren" (auslastungOptimieren.ts): freigabe = Start vor dem ersten Optimieren, start = vom Optimieren
   *  gesetzter Start (beide "YYYY-MM-DD HH:MM"), vorgaenger = dabei automatisch ergänzte Vorgänger. Beim nächsten Optimieren werden
   *  diese Vorgänger neu bestimmt und, solange der Start unverändert ist, gilt wieder freigabe — erneutes Optimieren liefert so
   *  dasselbe Ergebnis, statt den Ablauf weiter zu verschieben. */
  optimierung?: { freigabe: string; start: string; vorgaenger: string[] };
  /** Vorgänger, die «Auto-Vorgänger» (autoVorgaenger.ts) gesetzt hat — erneutes Ausführen ersetzt nur diese. Zusammen mit
   *  optimierung.vorgaenger die automatischen Vorgänger (blau); alle übrigen sind von Hand gesetzt (schwarz) und bleiben. */
  autoVorgaenger?: string[];
  /** Vorgänger aus den Ablaufregeln (SimProjekt.ablaufRegeln, ablaufRegeln.ts) — nach jeder Änderung neu bestimmt, blau wie die
   *  übrigen automatischen. Regel ausschalten oder löschen entfernt sie wieder. */
  regelVorgaenger?: string[];
  /** Ablauf aus "Auslastung optimieren" (auslastungOptimierenKran.ts): je Arbeitstag, wer an welcher Leistungsposition von wann
   *  bis wann arbeitet (TagesLauf). Tab AVOR zeigt und rechnet genau diesen Ablauf. Gilt nur, solange Termine (termin =
   *  terminSchluessel), Mengen/Leistungspositionen (basis) und Kräne & Personal (kraene) gleich sind — sonst verteilt Tab AVOR
   *  die Arbeit wieder gleichmässig auf die Tage des Tasks und rechnet den Tag mit demselben Rechenkern (ablaufKern.ts) neu. */
  tagesArbeit?: { termin: string; basis: string; kraene: string; tage: Record<string, TagesLauf[]> };
  attrGruppe?: Record<string, string>; // Attribut-Werte-Kombination (pset||name → Wert), die diesen Task bei der Attribut-Task-Erzeugung ergeben hat — dient beim erneuten Generieren dazu, denselben Task (inkl. Termine) wiederzuerkennen statt neu anzulegen, siehe AttributTaskErzeugung.tsx
}

export interface AttrRef { pset: string; name: string; key: string; } // gleiche Form wie AttrItem in modelHelpers.ts

export interface SimModell {
  id: string;   // modelId aus TC (über alle Versionen hinweg stabil)
  name: string; // Dateiname z.B. "23.ifc"
  versionId?: string; // zum Zeitpunkt der Zuweisung gepinnte TC-Versions-ID — wird beim Laden verwendet, damit neue Revisionen NICHT automatisch übernommen werden
  pfad?: string[]; // Ordner im TC-Explorer (ohne Stammordner), beim Auswählen im Tab Projekt gemerkt
  ifcGuidLayerMap?: Record<string, string>; // GUID → Layer-Name (aus IFC-Parsing)
  // von "In Connect übernehmen" (IfcExportDialog.tsx) hochgeladene Version mit 4D-Daten + die Version
  // ohne 4D-Daten, auf der sie beruht — erneute Exporte/Übernahmen gehen immer von der Basis aus
  vierD?: { versionId: string; basisVersionId?: string; am: string; ausVersionId?: string }; // ausVersionId: gepinnte Version beim Hochladen (noch nicht aktualisiert)
}

export type Zugriff = "edit" | "read" | "none";

// Zeitraster für Kran-Auswertungen (Kranoptik) — global je Projekt, Default "monat"
// wenn nicht gesetzt (siehe kranHelpers.ts).
export type Zeitraster = "monat" | "woche";

// Kran-Stammdaten (Tab Ressourcen → Kräne & Personal, siehe KranPersonalEditor.tsx / kranHelpers.ts). Verfügbarkeit
// bewusst grob als ein zusammenhängender von/bis-Zeitraum je Kran (keine Perioden-Liste) — fehlt
// von/bis, gilt der Kran als durchgehend verfügbar.
export interface Kran {
  id: string;
  name: string;
  verfuegbarVon?: string; // YYYY-MM-DD
  verfuegbarBis?: string; // YYYY-MM-DD
  /** @deprecated nicht mehr verwendet — die Höchstzahl unter dem Kran ist die Summe seines Personals (personal) */
  maxPersonen?: number;
  personal?: KranPersonal[]; // Personal unter dem Kran je Zeitraum und Unternehmer (Tab Ressourcen → Kräne & Personal)
}

/** Personal eines Unternehmers unter einem Kran in einem Zeitraum — ein Pool von Allroundern: verstärkt jede Leistungsposition
 *  dieses Unternehmers (Rate.unternehmer) an Tasks dieses Krans. von/bis leer = ganze Verfügbarkeit des Krans. */
export interface KranPersonal {
  id: string;
  unternehmer: string;
  personen: number;
  von?: string; // YYYY-MM-DD
  bis?: string; // YYYY-MM-DD
}

/** Aus der Simulation entferntes Bauteil ("modelId:::runtimeId"), mit dem Task, in dem es vorher war */
export interface Ausschluss { guid: string; taskId?: string; }

export interface SimProjekt {
  id: string;
  name: string;
  zeiteinheit?: Zeiteinheit; // Tage (Standard) / Halbtage / Uhrzeit — Einstellung im ⋮ der Simulationskarte, siehe zeitHelpers.ts
  erstelltAm: string; // ISO string
  erstellerId?: string; // TC User ID des Erstellers
  geaendertAm?: string; // ISO-Zeitstempel der letzten Bearbeitung (gesetzt in updateSim, App.tsx) — u.a. für den IFC-4D-Export
  geaendertVon?: string; // Name des letzten Bearbeiters
  zugriff?: Record<string, Zugriff>; // userId → Zugriff (default: "read")
  autoVerknuepft?: boolean; // true wenn Auto-Verknüpfung durchgeführt
  ganttImport?: { dateiname: string; version: number }; // Metadaten des zuletzt importierten Gantt (version zählt Importe hoch)
  ausgeschlossen?: Ausschluss[]; // aus der Simulation entfernte Bauteile: ausgeblendet, in keinem Task, von Auto-Verknüpfung/Attribut-Tasks/IFC-Import übergangen — siehe ausschlussHelpers.ts
  verknuepfungsModus?: "auto" | "attribut"; // welche der beiden Verknüpfungsarten aktiv ist (Auto-Verknüpfung vs. Attribut-Task-Erzeugung) — nur eine der beiden gleichzeitig, siehe TabProjekte.tsx
  attributTasksErzeugt?: boolean; // true wenn die Attribut-Task-Erzeugung mind. einmal durchgeführt wurde
  attributKonfig?: { tasknameAttr: AttrRef; zusatzAttrs: AttrRef[] }; // zuletzt verwendete Attribut-Auswahl der Attribut-Task-Erzeugung, für Vorbelegung beim erneuten Öffnen
  tasks: Task[];
  modelle: SimModell[];
  kalender?: Kalender; // Arbeitstage-Kalender (Feiertage) dieses Projekts
  stammdaten?: Stammdaten; // Leistungswerte/Personal/CHF für die Kalkulation, siehe stammdatenHelpers.ts
  mengenBerechnetSignatur?: string; // Signatur der Stammdaten (Formeln/Ausschlussfilter) zum Zeitpunkt des letzten "Mengen aus Bauteilen berechnen" — siehe mengenRelevanteSignatur() in stammdatenHelpers.ts; weicht sie vom aktuellen Stand ab, sind die Mengen veraltet
  kraene?: Kran[]; // Kran-Stammdaten, Verfügbarkeit und Personal je Unternehmer, siehe kranHelpers.ts / KranPersonalEditor.tsx (Tab Ressourcen)
  zeitraster?: Zeitraster; // globaler Monat/Woche-Umschalter für Kran-Auswertungen, fehlt = "monat"
  /** 3D-Ansicht bei Halbtagen/Uhrzeit: true = genau nach Uhrzeit (Abspielen zeigt den Stand zur jeweiligen Zeit); fehlt/false =
   *  ganzer Tag (sichtbar ist, was bis Tagesende begonnen hat, aktiv alle Tasks des Tages) — gilt für Abspielen, Tab AVOR und Tab
   *  Kosten gleich, siehe dreiDZustandAufTagSetzen. Umschalten: Tab Abspielen → ⋮ → Optionen. */
  genauNachUhrzeit?: boolean;
  optimiertStand?: string; // Termin-Signatur nach "Auslastung optimieren" (terminSignatur) — solange gleich, gelten Abweichungen zur berechneten Dauer als gewollt
  /** "Auslastung optimieren" → «Automatisch nachführen»: nach jeder Änderung (Termine, Mengen, Tab Ressourcen, Kräne & Personal)
   *  werden die betroffenen Tasks und ihre Nachfolger mit diesen Einstellungen neu optimiert (nachfuehren.ts), die übrigen
   *  behalten ihren Ablauf. Fehlt = aus. */
  autoNachfuehren?: { reihenfolge: "kritischerPfad" | "startdatum" | "gantt" | "gruppen"; luecken: boolean;
    /** Tasks ohne Vorgänger ab Projektbeginn (OptimierOptionen.abBeginn) — fehlt = ein (Standard), false = frühestens am bisherigen Start */
    abBeginn?: boolean };
  /** "Auslastung optimieren" → Reihenfolge «Nach Gruppen» (gruppenReihenfolge.ts): wer zuerst Personal bekommt — Stufe für Stufe
   *  (Gruppenebenen des Gantts, Bauteilart) in der hier festgelegten Reihenfolge der Werte. */
  gruppenReihenfolge?: GruppenReihenfolge;
  /** Ablaufregeln (Tab Ressourcen, ablaufRegeln.ts): «erst A fertig, dann B» — ergeben automatische Vorgänger (Task.regelVorgaenger). */
  ablaufRegeln?: AblaufRegel[];
}

/** Ablaufregel: Tasks der Auswahl «nach» beginnen erst, wenn alle passenden Tasks der Auswahl «vor» fertig sind (+ Wartetage).
 *  Auswahl = Bedingungen, die alle zutreffen müssen (leer = alle Tasks); je Bedingung genügt einer der Werte (Name: enthält).
 *  bezug: "ueberall" = ohne Einschränkung; "gleich" = nur innerhalb derselben Gruppe auf Gliederungsebene ebene (und darüber);
 *  "darunter" = A liegt in der Gruppe direkt vor der Gruppe von B auf Ebene ebene (Reihenfolge wie im Dialog «Nach Gruppen», z.B.
 *  UG → EG → OG), auf den Ebenen darüber in derselben Gruppe. */
export type RegelFeld = "gruppe" | "kuerzel" | "kategorie" | "unternehmer" | "name";
/** nicht = «ausser»: trifft zu, wenn KEINER der Werte passt */
export interface RegelBedingung { feld: RegelFeld; ebene?: number; werte: string[]; nicht?: boolean }
export interface AblaufRegel {
  id: string;
  name: string;
  aktiv: boolean;
  vor: RegelBedingung[];
  nach: RegelBedingung[];
  bezug: "ueberall" | "gleich" | "darunter";
  ebene?: number;
  wartetage: number;
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
  // YYYY-MM-DD (der häufigste Fall zuerst — wird in den Kalender-Rechnungen sehr oft aufgerufen)
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  // DD.MM.YYYY
  const de = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:[ T]\d{1,2}:\d{2}(?::\d{2})?)?$/);
  if (de) return new Date(Number(de[3]), Number(de[2]) - 1, Number(de[1]));
  // MM/DD/YYYY
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T]\d{1,2}:\d{2}(?::\d{2})?)?$/);
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

// Projekt-spezifischer localStorage-Key, damit Daten aus verschiedenen
// Trimble-Connect-Projekten sich nicht überschneiden
export function nsKey(base: string, projectId: string | null): string {
  return projectId ? `${base}::${projectId}` : base;
}

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
  return parseDateUniversal(s) !== null;
}

// Datum zu YYYY-MM-DD normalisieren (für interne Speicherung)
/** Dauer (in Arbeitstagen) bleibt erhalten: wird Start oder Ende per Datumswahl geändert, wandert das andere Datum so mit, dass die
 *  Anzahl Arbeitstage gleich bleibt (3 Arbeitstage bleiben 3 Arbeitstage — Wochenenden/Feiertage werden übersprungen). Ist ein Datum
 *  nicht lesbar, wird nur das geänderte gesetzt; ein fehlerhaftes Paar (Ende vor Start) wird auf 1 Arbeitstag gebracht. */
export function datumsPaarVerschieben(altStart: string, altEnde: string, neuesDatum: string, geaendert: "start" | "end", kalender: Kalender = LEERER_KALENDER): { start: string; end: string } {
  const s = parseDateUniversal(altStart), e = parseDateUniversal(altEnde), n = parseDateUniversal(neuesDatum);
  if (!n) return { start: altStart, end: altEnde };
  const neu = normalizeDatum(neuesDatum);
  if (!s || !e) return geaendert === "start" ? { start: neu, end: altEnde } : { start: altStart, end: neu };
  const r = zeitraumVerschieben({ start: altStart, end: altEnde }, neu, geaendert, kalender);
  return { start: r.start, end: r.end };
}

/** Wie datumsPaarVerschieben, aber mit Uhrzeiten (Zeiteinheit Halbtage/Uhrzeit): die Dauer in ARBEITSZEIT bleibt erhalten. Tasks
 *  beginnen und enden nur in der Arbeitszeit an Arbeitstagen. neueMin = neue Uhrzeit (Minuten), sonst bleibt die bisherige. */
export function zeitraumVerschieben(t: { start: string; end: string; startZeit?: string; endZeit?: string; meilenstein?: boolean }, neuesDatum: string, geaendert: "start" | "end",
  kalender: Kalender = LEERER_KALENDER, neueMin?: number): { start: string; end: string; startZeit: string | undefined; endZeit: string | undefined } {
  const S = startZeitpunkt(t), E = endZeitpunkt(t);
  const neu = normalizeDatum(neuesDatum);
  if (t.meilenstein) return meilensteinFelder(meilensteinZeitpunkt({ datum: neu, min: neueMin ?? S.min }, kalender));
  const dauer = arbeitsMinutenZwischen(S, E, kalender);
  if (geaendert === "start") {
    const s = naechsteArbeitszeit({ datum: neu, min: neueMin ?? S.min }, kalender);
    return zeitFelder(s, endeAusArbeitsMinuten(s, dauer, kalender));
  }
  const e = letzteArbeitszeit({ datum: neu, min: neueMin ?? E.min }, kalender);
  return zeitFelder(startAusArbeitsMinuten(e, dauer, kalender), e);
}

export function normalizeDatum(s: string): string {
  const d = parseDateUniversal(s);
  if (!d) return s;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// === Gruppen-Hilfsfunktionen (MSP OutlineLevel) ===

/** outlineLevel mit Default 1 */
export function getOutlineLevel(t: Task): number { return t.outlineLevel ?? 1; }

/** Ist dieser Task eine Gruppe? (explizites Flag ODER nächster Task hat höheres Level) */
export function istGruppe(tasks: Task[], idx: number): boolean {
  if (idx < 0 || idx >= tasks.length) return false;
  if (tasks[idx].isGroup) return true;
  const myLevel = getOutlineLevel(tasks[idx]);
  return idx + 1 < tasks.length && getOutlineLevel(tasks[idx + 1]) > myLevel;
}

/** Finde alle Kind-Indizes einer Gruppe (direkt + verschachtelt) */
export function getKinder(tasks: Task[], groupIdx: number): number[] {
  const myLevel = getOutlineLevel(tasks[groupIdx]);
  const children: number[] = [];
  for (let i = groupIdx + 1; i < tasks.length; i++) {
    if (getOutlineLevel(tasks[i]) <= myLevel) break;
    children.push(i);
  }
  return children;
}

/** Übergruppen je Task-ID (alle Gruppen, in denen der Task steckt, nach Gliederung/outlineLevel). */
export function uebergruppenJeTask(tasks: Task[]): Map<string, Set<string>> {
  const ergebnis = new Map<string, Set<string>>();
  const stapel: { id: string; level: number }[] = [];
  tasks.forEach((t, i) => {
    const level = getOutlineLevel(t);
    while (stapel.length && stapel[stapel.length - 1].level >= level) stapel.pop();
    ergebnis.set(t.id, new Set(stapel.map(s => s.id)));
    if (istGruppe(tasks, i)) stapel.push({ id: t.id, level });
  });
  return ergebnis;
}

/** Ist die eine Gruppe in der anderen enthalten (Über- ↔ Untergruppe/Task)? Dann kann keine Vorgänger der anderen sein. */
export function istVerschachtelt(uebergruppen: Map<string, Set<string>>, a: string, b: string): boolean {
  return !!uebergruppen.get(a)?.has(b) || !!uebergruppen.get(b)?.has(a);
}

/** Entfernt Vorgänger zwischen einer Gruppe und ihrem eigenen Inhalt (z.B. Untergruppe «UG» mit Vorgänger «Etappe A», in der sie
 *  steckt) — ein solcher Vorgänger ist nicht möglich. Gibt dasselbe Array zurück, wenn nichts zu entfernen war. */
export function ohneVerschachtelteVorgaenger(tasks: Task[]): Task[] {
  const ueber = uebergruppenJeTask(tasks);
  let geaendert = false;
  const neu = tasks.map(t => {
    const liste = vorgaengerListe(t);
    const gueltig = liste.filter(v => !istVerschachtelt(ueber, t.id, v.id));
    if (gueltig.length === liste.length) return t;
    geaendert = true;
    return mitVorgaengern(t, gueltig);
  });
  return geaendert ? neu : tasks;
}

/** Berechne Start/Ende einer Gruppe aus ihren Kindern */
export function gruppenDaten(tasks: Task[], groupIdx: number, kalender?: Kalender): { start: string; end: string; tage: number } {
  // Nur Blatt-Tasks zählen, keine verschachtelten Untergruppen — deren eigene start/end-Felder sind
  // beim Erstellen eingefroren (z.B. "heute") und würden die äußere Gruppe verfälschen. Die Tasks
  // einer Untergruppe stehen ohnehin schon (flach) mit in getKinder() und werden separat gezählt.
  const children = getKinder(tasks, groupIdx).filter(ci => !istGruppe(tasks, ci));
  if (children.length === 0) return { start: tasks[groupIdx].start, end: tasks[groupIdx].end, tage: 0 };
  let minStart = Infinity, maxEnd = -Infinity;
  for (const ci of children) {
    const s = parseDateUniversal(tasks[ci].start);
    const e = parseDateUniversal(tasks[ci].end);
    if (s) minStart = Math.min(minStart, s.getTime());
    if (e) maxEnd = Math.max(maxEnd, e.getTime());
  }
  if (minStart === Infinity || maxEnd === -Infinity) return { start: "", end: "", tage: 0 };
  const startD = new Date(minStart);
  const endD = new Date(maxEnd);
  const start = `${startD.getFullYear()}-${String(startD.getMonth()+1).padStart(2,"0")}-${String(startD.getDate()).padStart(2,"0")}`;
  const end = `${endD.getFullYear()}-${String(endD.getMonth()+1).padStart(2,"0")}-${String(endD.getDate()).padStart(2,"0")}`;
  return { start, end, tage: arbeitstageZwischen(start, end, kalender ?? LEERER_KALENDER) };
}

/**
 * Verschiebt per Drag&Drop einen Task (oder die aktuelle Mehrfachauswahl) an eine neue Position.
 * Ist der verschobene Task eine Gruppe und es liegt keine explizite Mehrfachauswahl vor, wird der
 * gesamte Block (Gruppe + alle Kinder) mitgenommen und relativ zueinander auf das neue Level verschoben
 * — Kinder rutschen also z.B. beim Herausziehen aus einer Gruppe alle gemeinsam eine Ebene zurück.
 */
export function taskVerschieben(tasks: Task[], fromIdx: number, toIdx: number, selectedIds: string[]): Task[] {
  if (fromIdx === toIdx || fromIdx < 0 || fromIdx >= tasks.length) return tasks;
  const targetId = tasks[toIdx]?.id;

  const istMultiDrag = selectedIds.length > 1;
  const movingIds = new Set<string>(
    istMultiDrag ? selectedIds : [tasks[fromIdx].id, ...getKinder(tasks, fromIdx).map(i => tasks[i].id)]
  );
  if (targetId && movingIds.has(targetId)) return tasks; // nicht in den eigenen Ast verschieben

  const moving = tasks.filter(t => movingIds.has(t.id));
  const remaining = tasks.filter(t => !movingIds.has(t.id));
  let insertAt = remaining.findIndex(t => t.id === targetId);
  if (insertAt < 0) insertAt = remaining.length;

  const target = remaining[insertAt];
  const targetIstGruppe = !!target && (target.isGroup || istGruppe(remaining, insertAt));
  // Nur in eine LEERE Gruppe wird per Drop automatisch hineingehängt (einzige Möglichkeit, ihr
  // überhaupt ein erstes Kind zuzuweisen) — bei einer Gruppe mit Kindern legt der Drop stattdessen
  // als Geschwister DAVOR ab, sonst ließe sich per Drag&Drop nie mehr etwas zwischen zwei Gruppen
  // einsortieren (Ziel wäre immer schon die nächste Gruppe → landete immer in ihr statt davor).
  const targetIstLeereGruppe = targetIstGruppe && getKinder(remaining, insertAt).length === 0;
  const neuesLevel = targetIstLeereGruppe ? getOutlineLevel(target) + 1
    : target ? getOutlineLevel(target)
    : remaining[insertAt - 1] ? getOutlineLevel(remaining[insertAt - 1])
    : 1;

  const movingNeu = istMultiDrag
    ? moving.map(m => m.isGroup ? m : { ...m, outlineLevel: neuesLevel })
    : (() => {
        const delta = neuesLevel - getOutlineLevel(moving[0]);
        return moving.map(m => ({ ...m, outlineLevel: Math.max(1, getOutlineLevel(m) + delta) }));
      })();
  if (targetIstLeereGruppe) insertAt += 1;

  remaining.splice(insertAt, 0, ...movingNeu);
  return remaining;
}

/**
 * Filtert Einträge auf Tasks, die ALLE Suchwörter enthalten (Name oder Zusatzspalten),
 * am besten passende zuerst. Ein Treffer der gesamten Suchphrase im Namen (z.B. "et. 10"
 * exakt so im Namen) rangiert vor Treffern, bei denen die Wörter nur verstreut vorkommen.
 * Leere Suche liefert die Eingabe unverändert zurück.
 */
export function sucheSortiereTasks<T>(eintraege: T[], getTask: (e: T) => Task, suchQuery: string): T[] {
  const q = suchQuery.trim().toLowerCase();
  if (!q) return eintraege;
  const woerter = q.split(/\s+/).filter(w => w.length > 0);
  const bewertet: { e: T; rang: number }[] = [];
  for (const e of eintraege) {
    const task = getTask(e);
    const name = task.name.toLowerCase();
    const text = [name, ...Object.values(task.extraSpalten || {}).map(v => String(v).toLowerCase())].join(" ");
    if (!woerter.every(w => text.includes(w))) continue;
    const exaktePos = name.indexOf(q);
    bewertet.push({ e, rang: exaktePos >= 0 ? exaktePos : 100000 + text.length });
  }
  bewertet.sort((a, b) => a.rang - b.rang);
  return bewertet.map(b => b.e);
}

// === Nummerierung & Vorgänger ===

/** Berechne Nummern: Gruppen = A, B, C… / Tasks = 1, 2, 3… */
export function berechneNummern(tasks: Task[]): Map<string, string> {
  const map = new Map<string, string>();
  let gruppeN = 0, taskN = 0;
  for (const t of tasks) {
    const isGrp = t.isGroup || false;
    if (isGrp) {
      gruppeN++;
      let lbl = ""; let n = gruppeN;
      while (n > 0) { lbl = String.fromCharCode(64 + ((n - 1) % 26) + 1) + lbl; n = Math.floor((n - 1) / 26); }
      map.set(t.id, lbl);
    } else {
      taskN++;
      map.set(t.id, String(taskN));
    }
  }
  return map;
}

/** Prüfe ob Vorgänger-Kette zirkulär wäre */
export function istZirkular(tasks: Task[], taskId: string, predId: string): boolean {
  const byId = new Map(tasks.map(t => [t.id, t]));
  const visited = new Set<string>();
  const stapel = [predId];
  while (stapel.length) {
    const current = stapel.pop()!;
    if (current === taskId) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    const t = byId.get(current);
    if (t) for (const v of vorgaengerListe(t)) stapel.push(v.id);
  }
  return false;
}

/** Eine Stufe der Reihenfolge «Nach Gruppen»: quelle "gruppe" = Gruppen der Gliederungsebene ebene (Name, z.B. «Etappe A» oder
 *  «UG» — gleichnamige Gruppen zählen gleich), "kuerzel" = Bauteilart (Bauteil-Kürzel des Tasks); werte = Reihenfolge, zuerst
 *  = bekommt zuerst Personal; aktiv = Stufe wird berücksichtigt. */
export interface PrioStufe { quelle: "gruppe" | "kuerzel"; ebene?: number; werte: string[]; aktiv: boolean }
export interface GruppenReihenfolge { stufen: PrioStufe[] }

/** Ein Stück Arbeit eines Tages (Task.tagesArbeit): Leistungsposition pos, von/bis in Stunden ab Arbeitsbeginn (bis über Std./Tag
 *  = Überstunden), leute = Besetzung, ph = geleistete Personenstunden, kran = Verstärkung durch die Kranzeit begrenzt. */
export interface TagesLauf { pos: string; von: number; bis: number; leute: number; ph: number; kran?: boolean }

/** Termine eines Tasks als Text — Task.tagesArbeit gilt nur, solange er gleich bleibt */
export const terminSchluessel = (t: Pick<Task, "start" | "end" | "startZeit" | "endZeit">) => `${t.start} ${t.startZeit ?? ""}|${t.end} ${t.endZeit ?? ""}`;

// === Mehrere Vorgänger (bis 30, je mit eigenen Wartetagen — wie MS Project) ===
export interface VorgaengerLink { id: string; lagDays: number }
export const MAX_VORGAENGER = 30;

/** Alle Vorgänger eines Tasks: der erste steht (kompatibel zu älteren Daten) in predecessorId/lagDays, die übrigen in weitereVorgaenger. */
export function vorgaengerListe(t: Task): VorgaengerLink[] {
  const liste: VorgaengerLink[] = t.predecessorId ? [{ id: t.predecessorId, lagDays: t.lagDays ?? 0 }] : [];
  for (const v of t.weitereVorgaenger ?? []) if (v.id && v.id !== t.predecessorId) liste.push({ id: v.id, lagDays: v.lagDays ?? 0 });
  return liste;
}

/** Setzt die Vorgänger eines Tasks (doppelte und eigene ID entfernt, max. 30). */
export function mitVorgaengern(t: Task, liste: VorgaengerLink[]): Task {
  const gesehen = new Set<string>();
  const sauber = liste.filter(v => v.id && v.id !== t.id && !gesehen.has(v.id) && gesehen.add(v.id)).slice(0, MAX_VORGAENGER);
  const [erster, ...rest] = sauber;
  return { ...t, predecessorId: erster?.id, lagDays: erster ? erster.lagDays : undefined, weitereVorgaenger: rest.length ? rest : undefined };
}

/** Text wie in MS Project: "26, 27+2" (Nummer, bei Wartetagen +n bzw. -n). */
/** Automatisch gesetzte Vorgänger eines Tasks (blau): von «Auto-Vorgänger» oder von «Auslastung optimieren» ergänzt. Alle übrigen
 *  sind von Hand gesetzt (schwarz) — keine Automatik ändert oder entfernt sie. */
export function automatischeVorgaenger(t: Task): Set<string> {
  return new Set([...(t.autoVorgaenger ?? []), ...(t.optimierung?.vorgaenger ?? []), ...(t.regelVorgaenger ?? [])]);
}
export const VORGAENGER_FARBE = { manuell: "#333", automatisch: "#2d7dbd" };

/** Tooltip der Vorgänger-Spalte: jeder Vorgänger mit Herkunft */
export function vorgaengerTitel(t: Task, nummern: Map<string, string>): string {
  const auto = new Set(t.autoVorgaenger ?? []), opt = new Set(t.optimierung?.vorgaenger ?? []), regel = new Set(t.regelVorgaenger ?? []);
  return "Vorgänger: " + vorgaengerListe(t).map(v => `${nummern.get(v.id) ?? "?"}${v.lagDays ? (v.lagDays > 0 ? `+${v.lagDays}` : `${v.lagDays}`) : ""}`
    + (regel.has(v.id) ? " (automatisch, Ablaufregel)" : auto.has(v.id) ? " (automatisch, Auto-Vorgänger)" : opt.has(v.id) ? " (automatisch, Optimieren)" : " (von Hand)")).join(", ")
    + "\nBlau = automatisch gesetzt (wird bei Auto-Vorgänger, Optimieren bzw. aus den Ablaufregeln neu bestimmt), schwarz = von Hand (bleibt immer).";
}

/** Nach einer Bearbeitung von Hand: nur Vorgänger, die unverändert geblieben sind (gleicher Task, gleiche Wartetage), behalten
 *  ihre automatische Herkunft — alles andere gilt ab jetzt als von Hand gesetzt. */
function herkunftNachBearbeitung(alt: Task, neu: Task): Task {
  const vorher = vorgaengerListe(alt);
  const gleich = new Set(vorgaengerListe(neu).filter(v => vorher.some(a => a.id === v.id && a.lagDays === v.lagDays)).map(v => v.id));
  const auto = (alt.autoVorgaenger ?? []).filter(id => gleich.has(id));
  const regel = (alt.regelVorgaenger ?? []).filter(id => gleich.has(id));
  return { ...neu, autoVorgaenger: auto.length ? auto : undefined, regelVorgaenger: regel.length ? regel : undefined,
    optimierung: alt.optimierung ? { ...alt.optimierung, vorgaenger: alt.optimierung.vorgaenger.filter(id => gleich.has(id)) } : undefined };
}

export function vorgaengerText(t: Task, nummern: Map<string, string>): string {
  return vorgaengerListe(t).map(v => `${nummern.get(v.id) ?? "?"}${v.lagDays ? (v.lagDays > 0 ? `+${v.lagDays}` : `${v.lagDays}`) : ""}`).join(", ");
}

/** Vorbelegung der Vorgänger-Auswahl: die häufigsten Wartetage stehen im Feld "Wartetage", die Nummern mit genau diesen
 *  Wartetagen ohne +n im Text (nur abweichende mit +n) — so wirkt eine Änderung im Feld auf alle diese Vorgänger. */
export function vorgaengerEingabe(t: Task, nummern: Map<string, string>): { text: string; lag: number } {
  const liste = vorgaengerListe(t);
  const anzahl = new Map<number, number>();
  for (const v of liste) anzahl.set(v.lagDays, (anzahl.get(v.lagDays) ?? 0) + 1);
  let lag = liste[0]?.lagDays ?? 0;
  for (const [l, n] of anzahl) if (n > (anzahl.get(lag) ?? 0)) lag = l;
  const text = liste.map(v => `${nummern.get(v.id) ?? "?"}${v.lagDays === lag ? "" : v.lagDays >= 0 ? `+${v.lagDays}` : `${v.lagDays}`}`).join(", ");
  return { text, lag };
}

/** Wartetage aus dem Eingabefeld (leer/ungültig = 0, Komma erlaubt) */
export function parseWartetage(s: string): number {
  return Math.round(Number(s.trim().replace(",", "."))) || 0;
}

/** Liest "26, 27+2; 30-1" — Nummern wie in der App (Gruppen A, B…, Tasks 1, 2…). Einträge ohne +n/-n erhalten standardLag.
 *  Unbekannte Nummern landen in "unbekannt". */
export function parseVorgaengerText(text: string, kandidaten: Task[], nummern: Map<string, string>, standardLag = 0): { liste: VorgaengerLink[]; unbekannt: string[] } {
  const idByNr = new Map<string, string>();
  for (const k of kandidaten) { const nr = nummern.get(k.id); if (nr) idByNr.set(nr.toUpperCase(), k.id); }
  const liste: VorgaengerLink[] = [], unbekannt: string[] = [];
  for (const roh of text.split(/[,;]/).map(s => s.trim()).filter(Boolean)) {
    const m = roh.match(/^(.+?)\s*([+-]\s*\d+(?:[.,]\d+)?)?$/);
    const nr = (m?.[1] ?? roh).trim().toUpperCase();
    const id = idByNr.get(nr);
    if (!id) { unbekannt.push(roh); continue; }
    const lag = m?.[2] ? Math.round(Number(m[2].replace(/\s/g, "").replace(",", "."))) : standardLag;
    liste.push({ id, lagDays: lag });
  }
  return { liste, unbekannt };
}

/** Der gerade getippte (letzte) Eintrag in "26, 27+2, 3" — ohne +n — für die Vorschlagsliste. */
export function letzterVorgaengerEintrag(text: string): string {
  return (text.split(/[,;]/).pop() ?? "").trim().replace(/\s*[+-].*$/, "");
}

/** Ersetzt den letzten Eintrag durch die gewählte Nummer (bisherige Einträge bleiben). */
export function ersetzeLetztenVorgaengerEintrag(text: string, nr: string): string {
  const teile = text.split(/[,;]/);
  teile[teile.length - 1] = nr;
  return teile.map(s => s.trim()).filter(Boolean).join(", ");
}

/** Ende eines Vorgängers als Zeitpunkt (Gruppen: Tagesende ihres letzten Tasks). */
function vorgaengerEndZeitpunkt(tasks: Task[], id: string, index?: Map<string, number>): Zeitpunkt | null {
  const idx = index ? index.get(id) ?? -1 : tasks.findIndex(t => t.id === id);
  if (idx < 0 || tasks[idx]?.id !== id) return null;
  const p = tasks[idx];
  if (p.isGroup || istGruppe(tasks, idx)) { const e = gruppenDaten(tasks, idx).end; return e ? { datum: e, min: ARBEITSENDE_MIN } : null; }
  return p.end ? endZeitpunkt(p) : null;
}

/** Start eines Tasks aus ALLEN Vorgängern: der späteste Folge-Start (Tag nach Vorgänger-Ende + Wartetage, auf Arbeitstag gerückt).
 *  index (Task-ID → Position in tasks) beschleunigt das Nachschlagen bei vielen Aufrufen. */
export function vorgaengerStart(tasks: Task[], t: Task, kalender: Kalender = LEERER_KALENDER, index?: Map<string, number>): Zeitpunkt | null {
  let spaetester: Zeitpunkt | null = null;
  for (const v of vorgaengerListe(t)) {
    const ende = vorgaengerEndZeitpunkt(tasks, v.id, index);
    if (!ende) continue;
    // ein Meilenstein ohne Wartetage liegt genau auf dem Ende seines Vorgängers (wie MS Project), ein Task beginnt danach
    const s = t.meilenstein && !v.lagDays ? meilensteinZeitpunkt(ende, kalender) : folgeStartZeitpunkt(ende, v.lagDays, kalender);
    if (!spaetester || vergleicheZeitpunkte(s, spaetester) > 0) spaetester = s;
  }
  return spaetester;
}

/** Der massgebende Vorgänger (der den spätesten Start erzwingt) — für die Anzeige "26+" bei mehreren. */
export function massgebenderVorgaenger(tasks: Task[], t: Task, kalender: Kalender = LEERER_KALENDER): string | undefined {
  let best: { id: string; s: Zeitpunkt } | undefined;
  for (const v of vorgaengerListe(t)) {
    const ende = vorgaengerEndZeitpunkt(tasks, v.id);
    const s = ende ? folgeStartZeitpunkt(ende, v.lagDays, kalender) : { datum: "", min: 0 };
    if (!best || vergleicheZeitpunkte(s, best.s) > 0) best = { id: v.id, s };
  }
  return best?.id;
}

/** Datum addieren (Tage) */
export function datumPlusTage(datum: string, tage: number): string {
  const d = parseDateUniversal(datum);
  if (!d) return datum;
  d.setDate(d.getDate() + tage);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

/** Verschiebt einen Task auf ein neues Startdatum (Dauer in Arbeitstagen bleibt erhalten). Bei Gruppen werden alle Kinder um dieselbe Anzahl Arbeitstage mitverschoben. */
export function verschiebeAufStart(tasks: Task[], taskId: string, neuerStart: string | Zeitpunkt, kalender: Kalender = LEERER_KALENDER): Task[] {
  const idx = tasks.findIndex(t => t.id === taskId);
  if (idx < 0) return tasks;
  const t = tasks[idx];
  // Dauer in Arbeitszeit bleibt; ohne Uhrzeit bleibt die bisherige Startzeit des Tasks
  const verschiebe = (x: Task, start: string | Zeitpunkt): Task => {
    const ziel = typeof start === "string" ? { datum: start, min: zeitZuMin(x.startZeit, ARBEITSBEGINN_MIN) } : start;
    if (x.meilenstein) return { ...x, ...meilensteinFelder(meilensteinZeitpunkt(ziel, kalender)) };
    const s = naechsteArbeitszeit(ziel, kalender);
    return { ...x, ...zeitFelder(s, endeAusArbeitsMinuten(s, arbeitsMinutenZwischen(startZeitpunkt(x), endZeitpunkt(x), kalender), kalender)) };
  };
  if (typeof neuerStart !== "string" && t.isGroup) neuerStart = neuerStart.datum;
  if (t.isGroup) {
    const { start: altStart } = gruppenDaten(tasks, idx, kalender);
    if (typeof neuerStart !== "string" || !parseDateUniversal(altStart) || !parseDateUniversal(neuerStart)) return tasks;
    const delta = arbeitstageVersatz(altStart, neuerStart, kalender);
    if (delta === 0) return tasks;
    const kinder = new Set(getKinder(tasks, idx));
    return tasks.map((x, i) => (i === idx || kinder.has(i)) ? verschiebe(x, arbeitstagPlus(x.start, delta, kalender)) : x);
  }
  return tasks.map((x, i) => i === idx ? verschiebe(x, neuerStart) : x);
}

/** Weg eines Zirkelbezugs: hängt predId über seine Vorgänger-Kette schon von taskId ab, liefert die Kette [predId, …, taskId]
 *  (z.B. 48 → 47 → 46), sonst null. */
export function zirkelPfad(tasks: Task[], taskId: string, predId: string): string[] | null {
  const byId = new Map(tasks.map(t => [t.id, t]));
  const besucht = new Set<string>();
  const suche = (id: string): string[] | null => {
    if (id === taskId) return [id];
    if (besucht.has(id)) return null;
    besucht.add(id);
    const t = byId.get(id);
    if (!t) return null;
    for (const v of vorgaengerListe(t)) { const p = suche(v.id); if (p) return [id, ...p]; }
    return null;
  };
  return suche(predId);
}

/** Alle Tasks gleicher Art (Task/Gruppe) für die Vorgänger-Auswahl — gesperrte (Zirkelbezug) mit ihrer Kette, damit die Auswahl
 *  sie ausgegraut samt Grund zeigen kann statt sie stillschweigend wegzulassen. */
export function vorgaengerKandidaten(tasks: Task[], taskId: string): (Task & { sperrPfad?: string[] })[] {
  const idx = tasks.findIndex(t => t.id === taskId);
  if (idx < 0) return [];
  const taskIstGruppe = istGruppe(tasks, idx);
  const ueber = uebergruppenJeTask(tasks);
  return tasks.filter((t, i) => t.id !== taskId && istGruppe(tasks, i) === taskIstGruppe && !istVerschachtelt(ueber, taskId, t.id))
    .map(t => { const p = zirkelPfad(tasks, taskId, t.id); return p ? { ...t, sperrPfad: p } : t; });
}

/** Gültige Vorgänger-Kandidaten für einen Task: kein Zyklus, Gruppen nur als Vorgänger von Gruppen, keine Über-/Untergruppe */
export function gueltigeVorgaenger(tasks: Task[], taskId: string): Task[] {
  const idx = tasks.findIndex(t => t.id === taskId);
  if (idx < 0) return [];
  const taskIstGruppe = istGruppe(tasks, idx);
  const ueber = uebergruppenJeTask(tasks);
  return tasks.filter((t, i) =>
    t.id !== taskId &&
    istGruppe(tasks, i) === taskIstGruppe &&
    !istVerschachtelt(ueber, taskId, t.id) &&
    !istZirkular(tasks, taskId, t.id)
  );
}

/** Kaskade: Nachfolger zeitlich verschieben wenn Vorgänger sich ändert */
export function kaskadiereNachfolger(tasks: Task[], geaenderteId: string, kalender: Kalender = LEERER_KALENDER): Task[] {
  let result = tasks.map(t => ({ ...t }));
  const queue = [geaenderteId];
  // Bei mehreren Vorgängern kann ein Task mehrfach neu berechnet werden (sobald ein weiterer Vorgänger sich verschiebt) — Obergrenze gegen Zyklen
  let schritte = 0;
  const maxSchritte = (tasks.length + 1) * (MAX_VORGAENGER + 1);
  while (queue.length > 0 && schritte++ < maxSchritte) {
    const predId = queue.shift()!;
    for (const t of result) {
      if (!vorgaengerListe(t).some(v => v.id === predId)) continue;
      // Nachfolger beginnt nach dem SPÄTESTEN seiner Vorgänger (Tag nach Ende + Wartetage, auf Arbeitstag gerückt)
      const neuerStart = vorgaengerStart(result, t, kalender);
      if (!neuerStart || (neuerStart.datum === t.start && neuerStart.min === zeitZuMin(t.startZeit, ARBEITSBEGINN_MIN))) continue;
      result = verschiebeAufStart(result, t.id, neuerStart, kalender);
      queue.push(t.id);
    }
  }
  return result;
}

/** Für welche Tasks gilt eine Vorgänger-Änderung am Task taskId? Ist er Teil einer Mehrfachauswahl, für alle
 *  markierten derselben Art (Gruppen bzw. Tasks — Gruppen haben nur Gruppen als Vorgänger, und beim Klick auf
 *  eine Gruppe werden ihre Tasks mitmarkiert), in Listen-Reihenfolge; sonst nur für ihn. */
export function vorgaengerZiele(tasks: Task[], selectedIds: string[], taskId: string): string[] {
  if (selectedIds.length < 2 || !selectedIds.includes(taskId)) return [taskId];
  const idx = tasks.findIndex(t => t.id === taskId);
  if (idx < 0) return [taskId];
  const gruppe = istGruppe(tasks, idx);
  const gewaehlt = new Set(selectedIds);
  return tasks.filter((t, i) => gewaehlt.has(t.id) && istGruppe(tasks, i) === gruppe).map(t => t.id);
}

/** Setzt die Vorgänger für alle ziele (leere Liste = entfernen), verschiebt sie hinter den spätesten Vorgänger
 *  und kaskadiert die Nachfolger. Je Ziel nur gültige Vorgänger (nicht er selbst, kein Zirkelbezug); bleibt
 *  dadurch keiner übrig, behält das Ziel seine bisherigen (nichts versehentlich löschen). */
export function setzeVorgaenger(tasks: Task[], ziele: string[], liste: VorgaengerLink[], kalender: Kalender = LEERER_KALENDER): Task[] {
  let erg = tasks;
  for (const id of ziele) {
    const gueltig = new Set(gueltigeVorgaenger(erg, id).map(t => t.id));
    const eigene = liste.filter(v => gueltig.has(v.id));
    if (liste.length > 0 && eigene.length === 0) continue;
    erg = erg.map(t => t.id === id ? herkunftNachBearbeitung(t, mitVorgaengern(t, eigene)) : t);
    const neu = erg.find(t => t.id === id);
    const start = neu ? vorgaengerStart(erg, neu, kalender) : null;
    if (start) erg = verschiebeAufStart(erg, id, start, kalender);
    erg = kaskadiereNachfolger(erg, id, kalender);
  }
  return erg;
}

/** Setzt jeden Task (keine Gruppen) auf Arbeitstage: Start auf den nächsten Arbeitstag, Ende so, dass die Dauer in Arbeitstagen bleibt
 *  (Spanne ohne Arbeitstag, z.B. in den Ferien oder Sa–So: Kalendertage der Spanne = Arbeitstage; Wochenenden in langen Spannen werden
 *  weggeschnitten). Gibt die Tasks und die Anzahl geänderter Tasks zurück — auch für den Import. */
export function normalisiereAufArbeitstage(tasks: Task[], kalender: Kalender = LEERER_KALENDER): { tasks: Task[]; geaendert: number } {
  let geaendert = 0;
  const neu = tasks.map((t, i) => {
    if (t.isGroup || istGruppe(tasks, i) || !parseDateUniversal(t.start) || !parseDateUniversal(t.end)) return t;
    const f = t.meilenstein
      ? meilensteinFelder(meilensteinZeitpunkt(startZeitpunkt(t), kalender))
      : (() => { const s = naechsteArbeitszeit(startZeitpunkt(t), kalender); return zeitFelder(s, endeAusArbeitsMinuten(s, arbeitsMinutenZwischen(startZeitpunkt(t), endZeitpunkt(t), kalender), kalender)); })();
    if (f.start === t.start && f.end === t.end && f.startZeit === t.startZeit && f.endZeit === t.endZeit) return t;
    geaendert++;
    return { ...t, ...f };
  });
  return { tasks: neu, geaendert };
}

/** Richtet alle Folge-Tasks neu an ihren Vorgängern aus (Nachfolger = Arbeitstag nach Vorgänger-Ende + Wartetage): beseitigt Überlappungen
 *  von Tasks, die noch am selben Tag wie ihr Vorgänger beginnen, und setzt alle Tasks auf Arbeitstage (Start/Ende nie auf Wochenende, Feiertag oder Ferien). */
export function richteKettenNeuAus(tasks: Task[], kalender: Kalender = LEERER_KALENDER): Task[] {
  // 1. Jeder Task (auch ohne Vorgänger) beginnt und endet an Arbeitstagen; die Dauer in Arbeitstagen bleibt (mindestens 1)
  let result = normalisiereAufArbeitstage(tasks, kalender).tasks;
  // 2. Folge-Tasks an ihren Vorgängern ausrichten
  for (const t of tasks) if (vorgaengerListe(t).length === 0) result = kaskadiereNachfolger(result, t.id, kalender);
  return result;
}
