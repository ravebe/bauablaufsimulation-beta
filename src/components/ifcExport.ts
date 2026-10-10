// ifcExport.ts — schreibt den Bauablauf einer Simulation als IFC-4D-Daten in eine bestehende IFC-Datei.
// Die Original-Datei bleibt unverändert, es werden nur neue Entitäten ans Ende des DATA-Abschnitts
// angehängt (neue #-IDs oberhalb der bisher höchsten), die per GlobalId auf die vorhandenen Bauteile
// verweisen. Das Schema wird aus FILE_SCHEMA erkannt:
//
//  IFC4 (inkl. IFC4X1/X2/X3 — gleiche Prozess-Entitäten):
//    IfcWorkPlan ─IfcRelAggregates→ IfcWorkSchedule ─IfcRelAssignsToControl→ oberste IfcTask
//    IfcTask (PredefinedType) + IfcTaskTime, Hierarchie über IfcRelNests,
//    Vorgänger über IfcRelSequence (+ IfcLagTime), Kalender als IfcWorkCalendar
//    (IfcWorkTime + IfcRecurrencePattern, Feiertage/Ferien als ExceptionTimes),
//    Bauteile: entstehende als Output (IfcRelAssignsToProduct), Abbruch/Bestand als Input
//    (IfcRelAssignsToProcess), IfcWorkPlan per IfcRelDeclares am IfcProject.
//  IFC2X3 (so weit das Schema es abbildet):
//    IfcWorkSchedule, IfcTask (Typ in ObjectType), Termine als IfcScheduleTimeControl über
//    IfcRelAssignsTasks, IfcRelNests, IfcRelSequence (TimeLag in Sekunden), Bauteile über
//    IfcRelAssignsToProcess. Kein Kalender-Objekt in IFC2X3.
//
// Zusätzlich bekommt jedes zugeordnete Bauteil ein Property Set "Bauablauf" (Vorgang, Termine, Typ …),
// damit die Infos auch in Viewern ohne 4D-Unterstützung (z.B. Trimble Connect) sichtbar sind.
import type { Task, TaskTyp, Kran } from "../types";
import { TASK_TYP_LABEL, getOutlineLevel, istGruppe, gruppenDaten, berechneNummern, parseDateUniversal } from "../types";
import type { Kalender } from "./kalenderHelpers";
import { arbeitstageZwischen, getKW, LEERER_KALENDER } from "./kalenderHelpers";

export type IfcSchemaFamilie = "IFC4" | "IFC2X3";

// Arbeitszeiten wie im MS-Project-Export (msProjectXml.ts): 08:00–17:00, 8 h Arbeit pro Tag
const ARBEITSBEGINN = "08:00:00";
const ARBEITSENDE = "17:00:00";
const ARBEITSSTUNDEN_PRO_TAG = 8;
const PSET_BAUTEIL = "Bauablauf";
const PSET_VORGANG = "Bauablauf_Vorgang";

// IfcTaskTypeEnum (IFC4) je Task-Typ — ohne exaktes Gegenstück USERDEFINED + ObjectType
const TASK_TYP_IFC4: Record<TaskTyp, string> = {
  neubau: "CONSTRUCTION", abbruch: "DEMOLITION", baustelleneinrichtung: "LOGISTIC",
  temporaer: "USERDEFINED", bestand: "USERDEFINED", drittprojekt: "USERDEFINED",
};
// Bauteile von Abbruch/Bestand sind Input des Vorgangs (sie existieren schon), alle anderen Output
const BAUTEIL_IST_INPUT: Record<TaskTyp, boolean> = {
  neubau: false, abbruch: true, baustelleneinrichtung: false, temporaer: false, bestand: true, drittprojekt: false,
};

export function erkenneIfcSchema(text: string): { familie: IfcSchemaFamilie | null; roh: string } {
  const m = text.slice(0, 50000).match(/FILE_SCHEMA\s*\(\s*\(\s*'([^']+)'/i);
  const roh = m ? m[1].trim().toUpperCase() : "";
  if (roh.startsWith("IFC2X3")) return { familie: "IFC2X3", roh };
  if (roh.startsWith("IFC4")) return { familie: "IFC4", roh };
  return { familie: null, roh };
}

// --- IFC-GlobalId: 128 bit → 22 Zeichen (buildingSMART-Base64) ---
const GUID_ZEICHEN = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$";

export function komprimiereGuid(bytes: Uint8Array): string {
  let bits = 0n;
  for (const b of bytes) bits = (bits << 8n) | BigInt(b);
  let s = "";
  for (let i = 0; i < 22; i++) { s = GUID_ZEICHEN[Number(bits & 63n)] + s; bits >>= 6n; }
  return s;
}

// cyrb128 — 128-bit-Hash, damit derselbe Task bei erneutem Export dieselbe GlobalId bekommt
function hash128(str: string): Uint8Array {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4; h2 ^= h1; h3 ^= h1; h4 ^= h1;
  const out = new Uint8Array(16);
  [h1, h2, h3, h4].forEach((h, i) => new DataView(out.buffer).setUint32(i * 4, h >>> 0));
  return out;
}

export function ifcGuidAus(seed: string): string { return komprimiereGuid(hash128(seed)); }

// --- STEP-Formatierung (ISO 10303-21) ---
/** String-Literal; Nicht-ASCII als \X2\…\X0\, damit die angehängten Zeilen reines ASCII bleiben. */
export function stepText(s: string): string {
  let out = "";
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (cp === 0x27) out += "''";
    else if (cp === 0x5c) out += "\\\\";
    else if (cp >= 0x20 && cp <= 0x7e) out += ch;
    else if (cp <= 0xffff) out += `\\X2\\${cp.toString(16).toUpperCase().padStart(4, "0")}\\X0\\`;
    else out += `\\X4\\${cp.toString(16).toUpperCase().padStart(8, "0")}\\X0\\`;
  }
  return `'${out}'`;
}
const stepReal = (n: number) => Number.isInteger(n) ? `${n}.` : String(n);
const ref = (id: number) => `#${id}`;
const refs = (ids: number[]) => `(${ids.map(ref).join(",")})`;
const label = (s: string) => stepText(s.length > 255 ? s.slice(0, 252) + "..." : s);

function isoDatum(s: string): string | null {
  const d = parseDateUniversal(s);
  if (!d) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** ISO-8601-Dauer in Tagen (IfcDuration), negative Wartezeiten als "-P2D" */
const isoDauerTage = (tage: number) => `${tage < 0 ? "-" : ""}P${Math.abs(tage)}D`;

class StepSchreiber {
  zeilen: string[] = [];
  naechsteId: number;
  constructor(startId: number) { this.naechsteId = startId; }
  add(entity: string): number {
    const id = this.naechsteId++;
    this.zeilen.push(`#${id}=${entity};`);
    return id;
  }
}

export interface IfcExportEingabe {
  ifcText: string;            // Datei-Inhalt (1 Zeichen = 1 Byte, z.B. per TextDecoder("latin1"))
  simId: string;
  simName: string;
  modellId: string;
  tasks: Task[];
  kalender?: Kalender;
  kraene?: Kran[];
  /** taskId → IFC-GlobalIds der Bauteile dieses Modells */
  bauteilGuidsJeTask: Map<string, string[]>;
  jetzt?: Date;
  /** Zusatzinfos für das Pset "Bauablauf" */
  meta?: { erstelltAm?: string; geaendertAm?: string; geaendertVon?: string; exportiertVon?: string; modellVersion?: string };
}

export interface IfcExportErgebnis {
  schema: string;
  familie: IfcSchemaFamilie;
  einfuegePos: number;   // Zeichen-/Byte-Position vor dem letzten ENDSEC; (Ende DATA) — bzw. Beginn des ersetzten alten 4D-Blocks
  /** Ende des ersetzten Bereichs (Position des letzten ENDSEC;); ohne Ersetzung = einfuegePos */
  ersetzeBis: number;
  /** true: die Datei enthielt den Bauablauf dieser Simulation schon — der alte Block wurde durch den aktuellen ersetzt */
  ersetzt: boolean;
  einfuegeText: string;  // reines ASCII
  anzahl: { tasks: number; verknuepfteBauteile: number; nichtGefunden: number; sequenzen: number; entitaeten: number };
  hinweise: string[];
}

/** Kommentar-Zeile (STEP-Kommentar) am Anfang des 4D-Blocks — markiert, was bei einer erneuten Übernahme ersetzt wird */
function markerZeile(simId: string, modellId: string): string {
  return `/* BAUABLAUFSIMULATION-4D ${simId}|${modellId} */`;
}

/** Erzeugt die 4D-Entitäten. Wirft Error mit deutscher Meldung, wenn die Datei nicht passt. */
export function erzeuge4dIfc(e: IfcExportEingabe): IfcExportErgebnis {
  let text = e.ifcText;
  const { tasks } = e;
  const { familie, roh } = erkenneIfcSchema(text);
  if (!familie) throw new Error(roh ? `IFC-Schema "${roh}" wird nicht unterstützt (nur IFC2X3 und IFC4).` : "Keine gültige IFC-Datei (FILE_SCHEMA fehlt) — ifcZIP/ifcXML werden nicht unterstützt.");
  if (tasks.length === 0) throw new Error("Die Simulation enthält keine Tasks.");

  const g = (teil: string) => ifcGuidAus(`${e.simId}|${e.modellId}|${teil}`);
  const scheduleGuid = g("workschedule");
  // Enthält die Datei den Bauablauf dieser Simulation schon (frühere Übernahme), wird der alte Block entfernt und
  // durch den aktuellen ersetzt — so lässt sich nach jeder Änderung erneut übernehmen, auch ohne Änderung.
  // Der Block steht am Ende von DATA; neuere Exporte tragen eine Marker-Zeile, bei älteren beginnt er (IFC4) mit
  // dem Terminplan-Entity (in IFC2X3 davor evtl. Hilfsentitäten — unreferenziert, aber gültig).
  const endsecAlt = text.lastIndexOf("ENDSEC;");
  let ersetzeVon = -1;
  if (text.includes(`'${scheduleGuid}'`)) {
    ersetzeVon = text.indexOf(markerZeile(e.simId, e.modellId));
    if (ersetzeVon < 0) {
      const pos = text.indexOf(`'${scheduleGuid}'`);
      ersetzeVon = text.lastIndexOf("\n", pos) + 1;
    }
    if (endsecAlt < 0 || ersetzeVon <= 0 || ersetzeVon > endsecAlt) throw new Error("Der bisherige Bauablauf in der Datei konnte nicht entfernt werden — bitte die Original-IFC (ohne 4D-Daten) verwenden.");
    text = text.slice(0, ersetzeVon) + text.slice(endsecAlt);
  }

  const endsec = text.lastIndexOf("ENDSEC;");
  if (endsec < 0 || text.indexOf("DATA;") < 0) throw new Error("DATA-Abschnitt der IFC-Datei nicht gefunden.");

  // Ein Durchlauf über alle Entitäten: höchste ID, Projekt, OwnerHistory, gesuchte Bauteile
  const benoetigt = new Set<string>();
  for (const guids of e.bauteilGuidsJeTask.values()) for (const x of guids) benoetigt.add(x);
  const bauteilId = new Map<string, number>();
  let maxId = 0, projektId: number | null = null, ownerHistoryId: number | null = null;
  for (const m of text.matchAll(/#(\d+)\s*=\s*([A-Za-z0-9_]+)\s*\(\s*(?:'([^']*)')?/g)) {
    const id = Number(m[1]);
    if (id > maxId) maxId = id;
    const typ = m[2].toUpperCase();
    if (typ === "IFCOWNERHISTORY" && ownerHistoryId === null) ownerHistoryId = id;
    else if (typ === "IFCPROJECT" && projektId === null) projektId = id;
    else if (m[3] && benoetigt.has(m[3]) && !typ.startsWith("IFCREL") && !typ.startsWith("IFCPROPERTY")) bauteilId.set(m[3], id);
  }

  const w = new StepSchreiber(maxId + 1);
  const hinweise: string[] = [];
  const ist4 = familie === "IFC4";
  const kal = e.kalender ?? LEERER_KALENDER;
  const nummern = berechneNummern(tasks);
  const jetzt = e.jetzt ?? new Date();
  const zwei = (n: number) => String(n).padStart(2, "0");
  const jetztIso = `${jetzt.getFullYear()}-${zwei(jetzt.getMonth() + 1)}-${zwei(jetzt.getDate())}T${zwei(jetzt.getHours())}:${zwei(jetzt.getMinutes())}:${zwei(jetzt.getSeconds())}`;

  // OwnerHistory: in IFC2X3 Pflicht, in IFC4 optional — vorhandene wiederverwenden
  let oh = ownerHistoryId !== null ? ref(ownerHistoryId) : "$";
  if (ownerHistoryId === null && !ist4) {
    const person = w.add(`IFCPERSON($,'Bauablaufsimulation',$,$,$,$,$,$)`);
    const org = w.add(`IFCORGANIZATION($,'Bauablaufsimulation',$,$,$)`);
    const pao = w.add(`IFCPERSONANDORGANIZATION(${ref(person)},${ref(org)},$)`);
    const app = w.add(`IFCAPPLICATION(${ref(org)},'1.0','Bauablaufsimulation','BAS')`);
    oh = ref(w.add(`IFCOWNERHISTORY(${ref(pao)},${ref(app)},$,.ADDED.,$,$,$,${Math.floor(jetzt.getTime() / 1000)})`));
  }

  // Termine je Task (Gruppen aus ihren Kindern)
  const termine = tasks.map((t, i) => {
    const d = istGruppe(tasks, i) ? gruppenDaten(tasks, i, kal) : { start: t.start, end: t.end };
    const start = isoDatum(d.start), ende = isoDatum(d.end);
    return { start, ende, tage: start && ende ? arbeitstageZwischen(start, ende, kal) : 0 };
  });
  const gueltig = termine.filter(x => x.start && x.ende);
  const projStart = gueltig.reduce((m, x) => (!m || x.start! < m ? x.start! : m), "") || jetztIso.slice(0, 10);
  const projEnde = gueltig.reduce((m, x) => (!m || x.ende! > m ? x.ende! : m), "") || projStart;

  // Hierarchie aus outlineLevel: Eltern = letzter Task davor mit kleinerem Level
  const elternIdx: (number | null)[] = [];
  const stapel: number[] = [];
  tasks.forEach((t, i) => {
    const lvl = getOutlineLevel(t);
    while (stapel.length && getOutlineLevel(tasks[stapel[stapel.length - 1]]) >= lvl) stapel.pop();
    elternIdx.push(stapel.length ? stapel[stapel.length - 1] : null);
    stapel.push(i);
  });

  const kranName = new Map((e.kraene ?? []).map(k => [k.id, k.name]));
  const typLabel = (t: Task, i: number) => istGruppe(tasks, i) ? "Gruppe" : TASK_TYP_LABEL[t.typ];
  const taskName = (t: Task, i: number) => t.name.trim() || `Vorgang ${nummern.get(t.id) ?? i + 1}`;

  // --- IFC2X3-Datumsobjekte (gecacht) ---
  const datumCache = new Map<string, number>();
  const zeitCache = new Map<string, number>();
  const kalenderDatum2x3 = (iso: string) => {
    if (!datumCache.has(iso)) {
      const [y, mo, d] = iso.split("-").map(Number);
      datumCache.set(iso, w.add(`IFCCALENDARDATE(${d},${mo},${y})`));
    }
    return datumCache.get(iso)!;
  };
  const datumZeit2x3 = (iso: string, zeit: string) => {
    const key = `${iso}T${zeit}`;
    if (!zeitCache.has(key)) {
      if (!zeitCache.has(zeit)) {
        const [h, mi, s] = zeit.split(":").map(Number);
        zeitCache.set(zeit, w.add(`IFCLOCALTIME(${h},${mi},${stepReal(s)},$,$)`));
      }
      zeitCache.set(key, w.add(`IFCDATEANDTIME(${ref(kalenderDatum2x3(iso))},${ref(zeitCache.get(zeit)!)})`));
    }
    return zeitCache.get(key)!;
  };

  // --- Arbeitsplan / Terminplan ---
  let scheduleId: number;
  if (ist4) {
    const zeitArgs = `'${jetztIso}',$,$,$,$,'${projStart}T${ARBEITSBEGINN}','${projEnde}T${ARBEITSENDE}'`;
    scheduleId = w.add(`IFCWORKSCHEDULE('${scheduleGuid}',${oh},${label(e.simName)},$,$,$,${zeitArgs},.PLANNED.)`);
    const plan = w.add(`IFCWORKPLAN('${g("workplan")}',${oh},${label(e.simName)},${stepText("Bauablaufsimulation")},$,$,${zeitArgs},.PLANNED.)`);
    w.add(`IFCRELAGGREGATES('${g("rel-plan-schedule")}',${oh},$,$,${ref(plan)},(${ref(scheduleId)}))`);
    if (projektId !== null) w.add(`IFCRELDECLARES('${g("rel-declares")}',${oh},$,$,${ref(projektId)},(${ref(plan)}))`);
    else hinweise.push("Kein IfcProject gefunden — Arbeitsplan nicht am Projekt deklariert.");
  } else {
    const erstellt = kalenderDatum2x3(jetztIso.slice(0, 10));
    const start = datumZeit2x3(projStart, ARBEITSBEGINN), ende = datumZeit2x3(projEnde, ARBEITSENDE);
    scheduleId = w.add(`IFCWORKSCHEDULE('${scheduleGuid}',${oh},${label(e.simName)},$,$,${stepText(e.simId.slice(0, 255))},${ref(erstellt)},$,$,$,$,${ref(start)},${ref(ende)},.PLANNED.,$)`);
  }

  // --- Tasks ---
  const taskIds: number[] = [];
  tasks.forEach((t, i) => {
    const tg = g(`task|${t.id}`);
    const name = label(taskName(t, i));
    const ident = stepText(nummern.get(t.id) ?? String(i + 1));
    const gruppe = istGruppe(tasks, i);
    const { start, ende, tage } = termine[i];
    if (ist4) {
      const tt = start && ende
        ? ref(w.add(`IFCTASKTIME($,$,$,.WORKTIME.,'${isoDauerTage(tage)}','${start}T${ARBEITSBEGINN}','${ende}T${ARBEITSENDE}',$,$,$,$,$,$,$,$,$,$,$,$,$)`))
        : "$";
      const pt = gruppe ? "NOTDEFINED" : TASK_TYP_IFC4[t.typ];
      taskIds.push(w.add(`IFCTASK('${tg}',${oh},${name},$,${label(typLabel(t, i))},${ident},$,$,$,.F.,$,${tt},.${pt}.)`));
    } else {
      const taskId = w.add(`IFCTASK('${tg}',${oh},${name},$,${label(typLabel(t, i))},${ident},$,$,.F.,$)`);
      taskIds.push(taskId);
      const zeit = start && ende
        ? ref(w.add(`IFCSCHEDULETIMECONTROL('${g(`time|${t.id}`)}',${oh},$,$,$,$,$,$,${ref(datumZeit2x3(start, ARBEITSBEGINN))},$,$,$,${ref(datumZeit2x3(ende, ARBEITSENDE))},${stepReal(tage * ARBEITSSTUNDEN_PRO_TAG * 3600)},$,$,$,$,$,$,$,$,$)`))
        : "$";
      // IFC2X3: jeder Task einzeln über IfcRelAssignsTasks am Terminplan (trägt zugleich die Termine)
      w.add(`IFCRELASSIGNSTASKS('${g(`rel-schedule|${t.id}`)}',${oh},$,$,(${ref(taskId)}),$,${ref(scheduleId)},${zeit})`);
    }
  });

  // --- Hierarchie ---
  const kinder = new Map<number, number[]>();
  elternIdx.forEach((p, i) => { if (p !== null) { if (!kinder.has(p)) kinder.set(p, []); kinder.get(p)!.push(i); } });
  for (const [p, ks] of kinder) {
    w.add(`IFCRELNESTS('${g(`rel-nests|${tasks[p].id}`)}',${oh},$,$,${ref(taskIds[p])},${refs(ks.map(k => taskIds[k]))})`);
  }

  if (ist4) {
    const oberste = tasks.map((_, i) => i).filter(i => elternIdx[i] === null).map(i => taskIds[i]);
    w.add(`IFCRELASSIGNSTOCONTROL('${g("rel-schedule-tasks")}',${oh},$,$,${refs(oberste)},$,${ref(scheduleId)})`);

    // Kalender: Mo–Fr 08–17 Uhr, Feiertage + Ferien als Ausnahmen (bei ausgeschaltetem Schalter "arbeitsfreie Tage berücksichtigen": Mo–So, keine Ausnahmen)
    const alleTage = kal.freieTageGelten === false;
    const periode = w.add(`IFCTIMEPERIOD('${ARBEITSBEGINN}','${ARBEITSENDE}')`);
    const muster = w.add(`IFCRECURRENCEPATTERN(.WEEKLY.,$,(${alleTage ? "1,2,3,4,5,6,7" : "1,2,3,4,5"}),$,$,$,$,(${ref(periode)}))`);
    const arbeitszeit = w.add(`IFCWORKTIME(${stepText(alleTage ? "Arbeitstage Mo-So" : "Arbeitstage Mo-Fr")},$,$,${ref(muster)},$,$)`);
    const ausnahmen: number[] = [];
    for (const f of alleTage ? [] : kal.feiertage) {
      const d = isoDatum(f.datum);
      if (d) ausnahmen.push(w.add(`IFCWORKTIME(${label(f.name || "Feiertag")},$,$,$,'${d}','${d}')`));
    }
    for (const f of alleTage ? [] : (kal.ferien ?? [])) {
      const v = isoDatum(f.von), b = isoDatum(f.bis);
      if (v && b) ausnahmen.push(w.add(`IFCWORKTIME(${label(f.name || "Ferien")},$,$,$,'${v}','${b}')`));
    }
    const kalender = w.add(`IFCWORKCALENDAR('${g("calendar")}',${oh},${stepText("Arbeitskalender")},$,$,$,(${ref(arbeitszeit)}),${ausnahmen.length ? refs(ausnahmen) : "$"},.FIRSTSHIFT.)`);
    w.add(`IFCRELASSIGNSTOCONTROL('${g("rel-calendar-tasks")}',${oh},$,$,${refs(taskIds)},$,${ref(kalender)})`);
  } else if (kal.feiertage.length || (kal.ferien ?? []).length) {
    hinweise.push("IFC2X3 kennt kein Kalender-Objekt — Feiertage/Ferien sind nur in den Dauern berücksichtigt.");
  }

  // --- Vorgänger ---
  const idxById = new Map(tasks.map((t, i) => [t.id, i]));
  let sequenzen = 0;
  tasks.forEach((t, i) => {
    if (!t.predecessorId) return;
    const p = idxById.get(t.predecessorId);
    if (p === undefined || p === i) return;
    const lag = t.lagDays ?? 0;
    const sg = g(`rel-seq|${t.predecessorId}|${t.id}`);
    if (ist4) {
      const lagRef = lag !== 0 ? ref(w.add(`IFCLAGTIME($,$,$,IFCDURATION('${isoDauerTage(lag)}'),.ELAPSEDTIME.)`)) : "$";
      w.add(`IFCRELSEQUENCE('${sg}',${oh},$,$,${ref(taskIds[p])},${ref(taskIds[i])},${lagRef},.FINISH_START.,$)`);
    } else {
      w.add(`IFCRELSEQUENCE('${sg}',${oh},$,$,${ref(taskIds[p])},${ref(taskIds[i])},${stepReal(lag * 86400)},.FINISH_START.)`);
    }
    sequenzen++;
  });

  // --- Bauteile ↔ Tasks ---
  const tasksJeBauteil = new Map<string, number[]>();
  let nichtGefunden = 0;
  tasks.forEach((t, i) => {
    const guids = [...new Set(e.bauteilGuidsJeTask.get(t.id) ?? [])];
    const gefunden: { guid: string; id: number }[] = [];
    for (const guid of guids) {
      const id = bauteilId.get(guid);
      if (id === undefined) { nichtGefunden++; continue; }
      gefunden.push({ guid, id });
      if (!tasksJeBauteil.has(guid)) tasksJeBauteil.set(guid, []);
      tasksJeBauteil.get(guid)!.push(i);
    }
    if (gefunden.length === 0) return;
    if (ist4 && !BAUTEIL_IST_INPUT[t.typ]) {
      for (const b of gefunden) {
        w.add(`IFCRELASSIGNSTOPRODUCT('${g(`rel-output|${t.id}|${b.guid}`)}',${oh},$,$,(${ref(taskIds[i])}),$,${ref(b.id)})`);
      }
    } else {
      w.add(`IFCRELASSIGNSTOPROCESS('${g(`rel-input|${t.id}`)}',${oh},$,$,${refs(gefunden.map(b => b.id))},$,${ref(taskIds[i])},$)`);
    }
  });
  if (nichtGefunden > 0) hinweise.push(`${nichtGefunden} Bauteil-Zuordnung(en) nicht in dieser Datei gefunden (GlobalId fehlt — andere Version?).`);

  // --- Property Sets ---
  const prop = (name: string, wert: string) => w.add(`IFCPROPERTYSINGLEVALUE(${stepText(name)},$,${wert},$)`);
  const vereint = (werte: string[]) => [...new Set(werte.filter(Boolean))].join(" | ");

  // Zeitstempel: IFC4 als IfcDateTime, IFC2X3 (kein Datumstyp für Properties) als lesbarer Text
  const zeitpunkt = (iso: string | undefined): string | null => {
    const d = iso ? new Date(iso) : null;
    if (!d || isNaN(d.getTime())) return null;
    const lokal = `${d.getFullYear()}-${zwei(d.getMonth() + 1)}-${zwei(d.getDate())}T${zwei(d.getHours())}:${zwei(d.getMinutes())}:${zwei(d.getSeconds())}`;
    return ist4 ? `IFCDATETIME('${lokal}')` : `IFCLABEL('${lokal.slice(0, 16).replace("T", " ")}')`;
  };
  const metaProps: [string, string][] = [];
  const m = e.meta ?? {};
  const meta = (name: string, wert: string | null) => { if (wert) metaProps.push([name, wert]); };
  meta("Simulation_erstellt_am", zeitpunkt(m.erstelltAm));
  meta("Simulation_geaendert_am", zeitpunkt(m.geaendertAm));
  meta("Simulation_geaendert_von", m.geaendertVon ? `IFCLABEL(${label(m.geaendertVon)})` : null);
  meta("Exportiert_am", zeitpunkt(jetzt.toISOString()));
  meta("Exportiert_von", m.exportiertVon ? `IFCLABEL(${label(m.exportiertVon)})` : null);
  meta("Modellversion", m.modellVersion ? `IFCIDENTIFIER(${label(m.modellVersion)})` : null);

  // Bauteil-Pset: eins je Kombination von Tasks, damit kein Bauteil zwei gleichnamige Psets bekommt
  const gruppen = new Map<string, { idx: number[]; ids: number[] }>();
  for (const [guid, idx] of tasksJeBauteil) {
    const key = [...new Set(idx)].sort((a, b) => a - b).join(",");
    if (!gruppen.has(key)) gruppen.set(key, { idx: [...new Set(idx)].sort((a, b) => a - b), ids: [] });
    gruppen.get(key)!.ids.push(bauteilId.get(guid)!);
  }
  for (const [key, { idx, ids }] of gruppen) {
    const ts = idx.map(i => tasks[i]);
    const einzel = idx.length === 1 ? idx[0] : null;
    const props: number[] = [
      prop("Vorgang", `IFCLABEL(${label(vereint(idx.map(i => taskName(tasks[i], i))))})`),
      prop("Vorgangsnummer", `IFCIDENTIFIER(${label(vereint(ts.map(t => nummern.get(t.id) ?? "")))})`),
      prop("Vorgangstyp", `IFCLABEL(${label(vereint(idx.map(i => typLabel(tasks[i], i))))})`),
    ];
    if (einzel !== null && ist4 && termine[einzel].start) {
      props.push(prop("Start", `IFCDATE('${termine[einzel].start}')`), prop("Ende", `IFCDATE('${termine[einzel].ende}')`));
    } else {
      props.push(prop("Start", `IFCLABEL(${label(vereint(idx.map(i => termine[i].start ?? "")))})`),
        prop("Ende", `IFCLABEL(${label(vereint(idx.map(i => termine[i].ende ?? "")))})`));
    }
    props.push(einzel !== null
      ? prop("Dauer_Arbeitstage", `IFCINTEGER(${termine[einzel].tage})`)
      : prop("Dauer_Arbeitstage", `IFCLABEL(${label(vereint(idx.map(i => String(termine[i].tage))))})`));
    const phase = vereint(ts.map(t => t.kranbereich ?? ""));
    const kw = (iso: string | null) => iso ? `${iso.slice(0, 4)}-KW${String(getKW(parseDateUniversal(iso)!)).padStart(2, "0")}` : "";
    props.push(prop("Start_KW", `IFCLABEL(${label(vereint(idx.map(i => kw(termine[i].start))))})`),
      prop("Ende_KW", `IFCLABEL(${label(vereint(idx.map(i => kw(termine[i].ende))))})`));
    const gruppe = vereint(idx.map(i => elternIdx[i] !== null ? taskName(tasks[elternIdx[i]!], elternIdx[i]!) : ""));
    if (gruppe) props.push(prop("Gruppe", `IFCLABEL(${label(gruppe)})`));
    const vorg = vereint(ts.map(t => {
      const p = t.predecessorId ? idxById.get(t.predecessorId) : undefined;
      return p !== undefined ? `${nummern.get(tasks[p].id) ?? ""} ${taskName(tasks[p], p)}`.trim() : "";
    }));
    if (vorg) props.push(prop("Vorgaenger", `IFCLABEL(${label(vorg)})`));
    const warte = vereint(ts.filter(t => t.predecessorId && t.lagDays).map(t => String(t.lagDays)));
    if (warte) props.push(prop("Wartetage", `IFCLABEL(${label(warte)})`));
    const kuerzel = vereint(ts.map(t => t.bauteilKuerzel ?? ""));
    if (kuerzel) props.push(prop("Kuerzel", `IFCIDENTIFIER(${label(kuerzel)})`));
    if (phase) props.push(prop("Bauphase", `IFCLABEL(${label(phase)})`));
    const kran = vereint(ts.flatMap(t => (t.kraene ?? []).map(k => kranName.get(k) ?? "")));
    if (kran) props.push(prop("Kran", `IFCLABEL(${label(kran)})`));
    const personal = vereint(ts.filter(t => t.personalSoll != null).map(t => String(t.personalSoll)));
    if (personal) props.push(prop("Personal_Soll", `IFCLABEL(${label(personal)})`));
    props.push(prop("Simulation", `IFCLABEL(${label(e.simName)})`));
    for (const [name, wert] of metaProps) props.push(prop(name, wert));
    const pset = w.add(`IFCPROPERTYSET('${g(`pset|${key}`)}',${oh},${stepText(PSET_BAUTEIL)},$,${refs(props)})`);
    w.add(`IFCRELDEFINESBYPROPERTIES('${g(`rel-pset|${key}`)}',${oh},$,$,${refs(ids)},${ref(pset)})`);
  }

  // Vorgangs-Pset: Kürzel, Bauphase, Kräne, Personal (nur wenn etwas gesetzt ist)
  tasks.forEach((t, i) => {
    const props: number[] = [];
    if (t.bauteilKuerzel) props.push(prop("Kuerzel", `IFCIDENTIFIER(${label(t.bauteilKuerzel)})`));
    if (t.kranbereich) props.push(prop("Bauphase", `IFCLABEL(${label(t.kranbereich)})`));
    const kran = vereint((t.kraene ?? []).map(k => kranName.get(k) ?? ""));
    if (kran) props.push(prop("Kran", `IFCLABEL(${label(kran)})`));
    if (t.personalSoll != null) props.push(prop("Personal_Soll", `IFCCOUNTMEASURE(${stepReal(t.personalSoll)})`));
    if (props.length === 0) return;
    const pset = w.add(`IFCPROPERTYSET('${g(`pset-task|${t.id}`)}',${oh},${stepText(PSET_VORGANG)},$,${refs(props)})`);
    w.add(`IFCRELDEFINESBYPROPERTIES('${g(`rel-pset-task|${t.id}`)}',${oh},$,$,(${ref(taskIds[i])}),${ref(pset)})`);
  });

  const nl = text.includes("\r\n") ? "\r\n" : "\n";
  return {
    schema: roh, familie,
    einfuegePos: ersetzeVon >= 0 ? ersetzeVon : endsec,
    ersetzeBis: ersetzeVon >= 0 ? endsecAlt : endsec,
    ersetzt: ersetzeVon >= 0,
    einfuegeText: markerZeile(e.simId, e.modellId) + nl + w.zeilen.join(nl) + nl,
    anzahl: { tasks: tasks.length, verknuepfteBauteile: tasksJeBauteil.size, nichtGefunden, sequenzen, entitaeten: w.zeilen.length },
    hinweise,
  };
}

/** Fügt das Ergebnis in den Text ein (für Tests / kleine Dateien; im Browser besser byteweise). */
export function fuegeIfcEin(text: string, erg: IfcExportErgebnis): string {
  return text.slice(0, erg.einfuegePos) + erg.einfuegeText + text.slice(erg.ersetzeBis);
}
