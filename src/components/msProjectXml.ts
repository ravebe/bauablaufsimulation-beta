// msProjectXml.ts — Import/Export im echten MS-Project-XML-Schema
// (das Format, das MS Project über "Datei → Speichern unter → XML" liest/schreibt)
//
// Abbildung der App-Regeln auf MS Project:
//  - Dauer = Arbeitszeit (Start und Ende inklusive) → <Duration>, Arbeitszeit aus Tab Ressourcen (Standard 08–12 / 13–17 Uhr)
//  - Termine bleiben erhalten:
//      · Vorgänge OHNE Vorgänger werden "manuell geplant" exportiert — MS Project lässt sie, wo sie sind
//      · Vorgänge MIT Vorgänger rechnet MS Project über die Verknüpfung (gleiche Regeln wie die App); nur wenn der Vorgang
//        bewusst später liegt, kommt "Anfang nicht früher als" dazu
//  - Meilensteine (Task.meilenstein) ↔ Milestone, Dauer 0; ein gewöhnlicher 1-Tages-Vorgang ist kein Meilenstein
//  - Wartetage = Kalendertage → LinkLag als verstrichene Tage (LagFormat 8 "ed", 1 Tag = 14400 Zehntelminuten)
//  - Kalender: Mo–Fr (bzw. Mo–So bei ausgeschaltetem Schalter "Wochenenden, Feiertage und Ferien berücksichtigen")
//    mit Feiertagen und Ferien als Ausnahmen; beim Import werden die Ausnahmen wieder zu Feiertagen/Ferien
//  - bis zu 30 Vorgänger je Vorgang (mehrere PredecessorLink)
//  - Task-ID der App im GUID-Feld des Vorgangs → beim Re-Import wird jeder Vorgang wiedererkannt, auch umbenannt
//  - Typ und Kürzel in den benannten Feldern "4D-Typ" (Text1) und "4D-Kürzel" (Text2), Bauteil-Bezug in den Notizen
import type { Task, TaskTyp } from "../types";
import { getOutlineLevel, istGruppe, parseDateUniversal, normalizeDatum, vorgaengerListe, vorgaengerStart, MAX_VORGAENGER } from "../types";
import type { Kalender, Feiertag, Ferienzeitraum } from "./kalenderHelpers";
import { LEERER_KALENDER } from "./kalenderHelpers";
import { dauerTage, startZeitpunkt, endZeitpunkt, minZuZeit, importZeit, vergleicheZeitpunkte, ARBEITSBEGINN_MIN, MITTAG_VON_MIN, MITTAG_BIS_MIN, ARBEITSENDE_MIN, MIN_PRO_ARBEITSTAG } from "./zeitHelpers";

const GUID_MARKER = "4DSIM_GUIDS:";
const ZEHNTELMIN_PRO_KALENDERTAG = 14400;    // 24 h × 60 min × 10
const LAGFORMAT_ELAPSED_DAYS = 8;            // "ed" — verstrichene Tage
// MS-Project-Formate (LagFormat / DurationFormat): 4, 6, 8, 10, 12 und die geschätzten 36…44 sind "verstrichen" (laufen auch über
// freie Tage), 19/20 bzw. 51/52 sind Prozent
const VERSTRICHENE_FORMATE = new Set([4, 6, 8, 10, 12, 36, 38, 40, 42, 44]);
const PROZENT_FORMATE = new Set([19, 20, 51, 52]);
// Feld-IDs der Vorgangsfelder Text1/Text2 in MS Project
const FELD_TEXT1 = "188743731", FELD_TEXT2 = "188743734";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function fmtDateTime(iso: string, time: string): string {
  const d = parseDateUniversal(iso);
  if (!d) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T${time}`;
}

// Arbeitszeit aus Tab Ressourcen (siehe zeitHelpers.ts), Zeiten als "HH:MM:SS"
const zeitXml = (min: number) => `${minZuZeit(min)}:00`;
const arbeitszeitenXml = () => `
            <WorkingTimes>
              <WorkingTime><FromTime>${zeitXml(ARBEITSBEGINN_MIN)}</FromTime><ToTime>${zeitXml(MITTAG_VON_MIN)}</ToTime></WorkingTime>
              <WorkingTime><FromTime>${zeitXml(MITTAG_BIS_MIN)}</FromTime><ToTime>${zeitXml(ARBEITSENDE_MIN)}</ToTime></WorkingTime>
            </WorkingTimes>`;

/** Projektkalender (UID 1): Wochentage + Feiertage/Ferien als arbeitsfreie Ausnahmen */
function kalenderXml(kalender: Kalender): string {
  const alleTage = kalender.freieTageGelten === false;
  // MS Project: DayType 1 = Sonntag … 7 = Samstag
  const wochentage = [1, 2, 3, 4, 5, 6, 7].map(tag => {
    const arbeitet = alleTage || (tag !== 1 && tag !== 7);
    return `
          <WeekDay>
            <DayType>${tag}</DayType>
            <DayWorking>${arbeitet ? 1 : 0}</DayWorking>${arbeitet ? arbeitszeitenXml() : ""}
          </WeekDay>`;
  }).join("");
  const ausnahmen = alleTage ? [] : [
    ...kalender.feiertage.map(f => ({ von: f.datum, bis: f.datum, name: f.name || "Feiertag" })),
    ...(kalender.ferien ?? []).map(f => ({ von: f.von, bis: f.bis, name: f.name || "Ferien" })),
  ].filter(a => parseDateUniversal(a.von) && parseDateUniversal(a.bis));
  const ausnahmenXml = ausnahmen.length ? `
        <Exceptions>${ausnahmen.map(a => `
          <Exception>
            <EnteredByOccurrences>0</EnteredByOccurrences>
            <TimePeriod><FromDate>${fmtDateTime(a.von, "00:00:00")}</FromDate><ToDate>${fmtDateTime(a.bis, "23:59:00")}</ToDate></TimePeriod>
            <Occurrences>1</Occurrences>
            <Name>${esc(a.name)}</Name>
            <Type>1</Type>
            <DayWorking>0</DayWorking>
          </Exception>`).join("")}
        </Exceptions>` : "";
  return `
  <Calendars>
    <Calendar>
      <UID>1</UID>
      <Name>Standard</Name>
      <IsBaseCalendar>1</IsBaseCalendar>
      <BaseCalendarUID>-1</BaseCalendarUID>
      <WeekDays>${wochentage}
      </WeekDays>${ausnahmenXml}
    </Calendar>
  </Calendars>`;
}

/** Benannte Felder: in MS Project erscheinen Text1/Text2 als "4D-Typ" und "4D-Kürzel" */
const FELD_DEFINITIONEN = `
  <ExtendedAttributes>
    <ExtendedAttribute><FieldID>${FELD_TEXT1}</FieldID><FieldName>Text1</FieldName><Alias>4D-Typ</Alias></ExtendedAttribute>
    <ExtendedAttribute><FieldID>${FELD_TEXT2}</FieldID><FieldName>Text2</FieldName><Alias>4D-Kürzel</Alias></ExtendedAttribute>
  </ExtendedAttributes>`;

const dauerXml = (min: number) => `PT${Math.floor(min / 60)}H${min % 60}M0S`;

export function generateMsProjectXml(tasks: Task[], projectName: string, kalender: Kalender = LEERER_KALENDER): string {
  const uidById = new Map<string, number>();
  tasks.forEach((t, i) => uidById.set(t.id, i + 1));

  let minStart = "", maxEnd = "";
  for (const t of tasks) {
    if (t.start && (!minStart || t.start < minStart)) minStart = t.start;
    if (t.end && (!maxEnd || t.end > maxEnd)) maxEnd = t.end;
  }
  const heute = new Date();
  const heuteIso = `${heute.getFullYear()}-${String(heute.getMonth() + 1).padStart(2, "0")}-${String(heute.getDate()).padStart(2, "0")}`;

  const taskXml = tasks.map((t, i) => {
    const uid = i + 1;
    const gruppe = istGruppe(tasks, i);
    const meilenstein = !gruppe && !!t.meilenstein;
    const dauerMin = meilenstein ? 0 : Math.round(dauerTage(t, kalender) * MIN_PRO_ARBEITSTAG); // Arbeitszeit in Minuten
    const sz = `${minZuZeit(startZeitpunkt(t).min)}:00`, ez = `${minZuZeit(endZeitpunkt(t).min)}:00`;
    const notesLine = t.objektGuids.length > 0 ? `${GUID_MARKER}${t.objektGuids.join(",")}` : "";
    const links = vorgaengerListe(t).filter(v => uidById.has(v.id));

    const predXml = links.map(v => {
      const lag = Math.round((v.lagDays ?? 0) * ZEHNTELMIN_PRO_KALENDERTAG);
      return `\n      <PredecessorLink>\n        <PredecessorUID>${uidById.get(v.id)}</PredecessorUID>\n        <Type>1</Type>\n        <CrossProject>0</CrossProject>\n        <LinkLag>${lag}</LinkLag>\n        <LagFormat>${LAGFORMAT_ELAPSED_DAYS}</LagFormat>\n      </PredecessorLink>`;
    }).join("");

    // Planung in MS Project: ohne Vorgänger manuell (bleibt am Termin), mit Vorgänger automatisch über die Verknüpfung —
    // "Anfang nicht früher als" nur, wenn der Vorgang später liegt, als die Verknüpfung ergibt
    const manuell = !gruppe && links.length === 0;
    const berechnet = !gruppe && links.length > 0 ? vorgaengerStart(tasks, t, kalender) : null;
    const spaeter = !!berechnet && vergleicheZeitpunkte(startZeitpunkt(t), berechnet) > 0;
    const constraint = spaeter
      ? `\n      <ConstraintType>4</ConstraintType>\n      <CalendarUID>-1</CalendarUID>\n      <ConstraintDate>${fmtDateTime(t.start, sz)}</ConstraintDate>`
      : `\n      <ConstraintType>0</ConstraintType>\n      <CalendarUID>-1</CalendarUID>`;
    const felder = [
      t.typ && !gruppe ? `\n      <ExtendedAttribute><FieldID>${FELD_TEXT1}</FieldID><Value>${esc(t.typ)}</Value></ExtendedAttribute>` : "",
      t.bauteilKuerzel ? `\n      <ExtendedAttribute><FieldID>${FELD_TEXT2}</FieldID><Value>${esc(t.bauteilKuerzel)}</Value></ExtendedAttribute>` : "",
    ].join("");

    return `    <Task>
      <UID>${uid}</UID>${UUID.test(t.id) ? `\n      <GUID>${t.id.toUpperCase()}</GUID>` : ""}
      <ID>${uid}</ID>
      <Name>${esc(t.name)}</Name>
      <Active>1</Active>
      <Manual>${manuell ? 1 : 0}</Manual>
      <Type>1</Type>
      <IsNull>0</IsNull>
      <OutlineLevel>${getOutlineLevel(t)}</OutlineLevel>
      <Priority>500</Priority>
      <Start>${fmtDateTime(t.start, sz)}</Start>
      <Finish>${fmtDateTime(meilenstein ? t.start : t.end, meilenstein ? sz : ez)}</Finish>
      <Duration>${dauerXml(dauerMin)}</Duration>${manuell ? `\n      <ManualStart>${fmtDateTime(t.start, sz)}</ManualStart>\n      <ManualFinish>${fmtDateTime(meilenstein ? t.start : t.end, meilenstein ? sz : ez)}</ManualFinish>\n      <ManualDuration>${dauerXml(dauerMin)}</ManualDuration>` : ""}
      <DurationFormat>7</DurationFormat>
      <Milestone>${meilenstein ? 1 : 0}</Milestone>
      <Summary>${gruppe ? 1 : 0}</Summary>${constraint}${notesLine ? `\n      <Notes>${esc(notesLine)}</Notes>` : ""}${predXml}${felder}
    </Task>`;
  }).join("\n");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Project xmlns="http://schemas.microsoft.com/project">
  <SaveVersion>14</SaveVersion>
  <Name>${esc(projectName)}</Name>
  <Title>${esc(projectName)}</Title>
  <ScheduleFromStart>1</ScheduleFromStart>
  <StartDate>${fmtDateTime(minStart || heuteIso, zeitXml(ARBEITSBEGINN_MIN))}</StartDate>
  <FinishDate>${fmtDateTime(maxEnd || heuteIso, zeitXml(ARBEITSENDE_MIN))}</FinishDate>
  <CurrentDate>${fmtDateTime(heuteIso, zeitXml(ARBEITSBEGINN_MIN))}</CurrentDate>
  <CalendarUID>1</CalendarUID>
  <DefaultStartTime>${zeitXml(ARBEITSBEGINN_MIN)}</DefaultStartTime>
  <DefaultFinishTime>${zeitXml(ARBEITSENDE_MIN)}</DefaultFinishTime>
  <MinutesPerDay>${MIN_PRO_ARBEITSTAG}</MinutesPerDay>
  <MinutesPerWeek>${MIN_PRO_ARBEITSTAG * 5}</MinutesPerWeek>
  <DaysPerMonth>20</DaysPerMonth>${FELD_DEFINITIONEN}${kalenderXml(kalender)}
  <Tasks>
${taskXml}
  </Tasks>
</Project>`;
}

export function istMsProjectXml(text: string): boolean {
  return /<Project[\s>]/.test(text) && text.includes("schemas.microsoft.com/project");
}

const GUELTIGE_TYPEN: TaskTyp[] = ["neubau", "bestand", "abbruch", "temporaer", "baustelleneinrichtung", "drittprojekt"];

export function parseMsProjectXml(text: string): Task[] {
  return parseMsProjectXmlMitHinweisen(text).tasks;
}

export interface MsProjectImport {
  tasks: Task[];
  hinweise: string[];
  /** Feiertage/Ferien aus den Ausnahmen des Projektkalenders (leer, wenn die Datei keine hat) */
  kalender?: Kalender;
}

/** Import mit Hinweisen auf alles, was die App (noch) anders macht als MS Project — erscheinen nach dem Import als Meldung. */
export function parseMsProjectXmlMitHinweisen(text: string): MsProjectImport {
  const doc = new DOMParser().parseFromString(text, "text/xml");
  const taskEls = [...doc.querySelectorAll("Tasks > Task")];
  // Wartezeiten in Arbeitstagen beziehen sich auf die Arbeitszeit der Datei (MinutesPerDay, MS-Project-Standard 480)
  const zehntelMinProArbeitstag = (Number(doc.querySelector("Project > MinutesPerDay")?.textContent) || 480) * 10;

  const g = (el: Element, tag: string) => el.querySelector(`:scope > ${tag}`)?.textContent?.trim() ?? "";
  // Wert eines benannten Felds (ExtendedAttribute mit FieldID), ältere Dateien der App schrieben <Text1>/<Text2> direkt
  const feld = (el: Element, fieldId: string, alt: string) => {
    const ea = [...el.querySelectorAll(":scope > ExtendedAttribute")].find(x => x.querySelector("FieldID")?.textContent?.trim() === fieldId);
    return (ea?.querySelector("Value")?.textContent ?? g(el, alt)).trim();
  };

  // Zähler für die Hinweise
  let andereVerknuepfungsarten = 0, zuVieleVorgaenger = 0, lagInArbeitstagen = 0, lagInProzent = 0, mitGuids = 0, unbekannterTyp = 0;
  let inaktiv = 0, verstricheneDauer = 0, meilensteine = 0, externeVerknuepfungen = 0;

  // 1. Rohdaten sammeln + lokale IDs vergeben (Projekt-Summary-Zeile mit OutlineLevel 0 überspringen)
  interface Roh { uid: string; localId: string; name: string; outlineLevel: number; summary: boolean; meilenstein: boolean;
    start: string; end: string; startZeit?: string; endZeit?: string; typ: TaskTyp; bauteilKuerzel: string | undefined; objektGuids: string[]; links: { uid: string; lag: number }[]; }
  const roh: Roh[] = [];
  const verwendeteIds = new Set<string>();
  for (const el of taskEls) {
    if (g(el, "IsNull") === "1") continue;
    const outlineLevelRaw = g(el, "OutlineLevel");
    const outlineLevel = outlineLevelRaw === "" ? 1 : Number(outlineLevelRaw);
    if (outlineLevel === 0) continue; // Projekt-Summary-Zeile
    if (g(el, "Active") === "0") { inaktiv++; continue; } // in MS Project deaktivierte Vorgänge
    const uid = g(el, "UID") || g(el, "ID");
    const summary = g(el, "Summary") === "1";
    const meilenstein = !summary && g(el, "Milestone") === "1";
    if (meilenstein) meilensteine++;
    if (!summary && VERSTRICHENE_FORMATE.has(Number(g(el, "DurationFormat")))) verstricheneDauer++;
    const typRaw = feld(el, FELD_TEXT1, "Text1").toLowerCase();
    const typBekannt = (GUELTIGE_TYPEN as string[]).includes(typRaw);
    if (typRaw && !typBekannt) unbekannterTyp++;
    const typ = typBekannt ? (typRaw as TaskTyp) : "neubau";
    const notes = g(el, "Notes");
    const guidMatch = notes.match(new RegExp(GUID_MARKER + "([^\\n]*)"));
    const objektGuids = guidMatch ? guidMatch[1].split(",").map(s => s.trim()).filter(Boolean) : [];
    if (objektGuids.length) mitGuids++;

    const links: { uid: string; lag: number }[] = [];
    for (const pl of [...el.querySelectorAll(":scope > PredecessorLink")]) {
      const predUid = pl.querySelector("PredecessorUID")?.textContent?.trim();
      if (!predUid) continue;
      if (pl.querySelector("CrossProject")?.textContent?.trim() === "1") { externeVerknuepfungen++; continue; }
      const typLink = Number(pl.querySelector("Type")?.textContent ?? "1");
      if (typLink !== 1) andereVerknuepfungsarten++;
      const linkLag = Number(pl.querySelector("LinkLag")?.textContent ?? "0") || 0;
      const lagFormat = Number(pl.querySelector("LagFormat")?.textContent ?? "7");
      let lagTage: number;
      if (PROZENT_FORMATE.has(lagFormat)) { lagTage = 0; if (linkLag !== 0) lagInProzent++; }
      else if (VERSTRICHENE_FORMATE.has(lagFormat)) lagTage = linkLag / ZEHNTELMIN_PRO_KALENDERTAG;
      else { lagTage = linkLag / zehntelMinProArbeitstag; if (linkLag !== 0) lagInArbeitstagen++; }
      if (links.length >= MAX_VORGAENGER) { zuVieleVorgaenger++; continue; }
      links.push({ uid: predUid, lag: Math.round(lagTage) });
    }

    const startRoh = g(el, "Start"), finishRoh = g(el, "Finish") || startRoh;
    // Task-ID der App aus dem GUID-Feld (Wiedererkennung beim Re-Import), sonst neu
    const guid = g(el, "GUID").replace(/[{}]/g, "").toLowerCase();
    const localId = UUID.test(guid) && !verwendeteIds.has(guid) ? guid : crypto.randomUUID();
    verwendeteIds.add(localId);
    const kuerzelRaw = feld(el, FELD_TEXT2, "Text2");
    roh.push({
      uid, localId, name: g(el, "Name") || "Task",
      outlineLevel, summary, meilenstein,
      start: normalizeDatum(startRoh), end: normalizeDatum(meilenstein ? startRoh : finishRoh),
      startZeit: importZeit(startRoh, "start"), endZeit: meilenstein ? undefined : importZeit(finishRoh, "ende"),
      typ, bauteilKuerzel: kuerzelRaw || undefined, objektGuids, links,
    });
  }

  // 2. UID → lokale ID auflösen
  const localIdByUid = new Map(roh.map(r => [r.uid, r.localId]));
  let unbekannteVorgaenger = 0;

  const tasks: Task[] = roh.map(r => {
    const links = r.links.map(l => ({ id: localIdByUid.get(l.uid), lagDays: l.lag })).filter((l): l is { id: string; lagDays: number } => {
      if (!l.id) unbekannteVorgaenger++;
      return !!l.id;
    });
    const [erster, ...rest] = links;
    return {
      id: r.localId,
      name: r.name,
      start: r.start,
      end: r.end,
      ...(r.startZeit ? { startZeit: r.startZeit } : {}),
      ...(r.endZeit ? { endZeit: r.endZeit } : {}),
      ...(r.meilenstein ? { meilenstein: true } : {}),
      typ: r.typ,
      bauteilKuerzel: r.bauteilKuerzel,
      objektGuids: r.objektGuids,
      outlineLevel: r.outlineLevel,
      isGroup: r.summary,
      predecessorId: erster?.id,
      lagDays: erster ? erster.lagDays : undefined,
      ...(rest.length ? { weitereVorgaenger: rest } : {}),
    };
  });

  // 3. Kalender der Datei: Ausnahmen → Feiertage (ein Tag) / Ferien (mehrere Tage); Wochenendarbeit?
  const hinweise: string[] = [];
  let kalender: Kalender | undefined;
  const projektKalUid = doc.querySelector("Project > CalendarUID")?.textContent?.trim();
  const kal = [...doc.querySelectorAll("Calendars > Calendar")].find(c => c.querySelector(":scope > UID")?.textContent?.trim() === projektKalUid);
  if (kal) {
    const wochenende = [...kal.querySelectorAll("WeekDays > WeekDay")].some(w =>
      ["1", "7"].includes(w.querySelector("DayType")?.textContent?.trim() ?? "") && w.querySelector("DayWorking")?.textContent?.trim() === "1");
    if (wochenende) hinweise.push("Der Kalender der Datei erlaubt Wochenendarbeit. In der App gelten Wochenenden als arbeitsfrei — Tasks am Wochenende werden auf Arbeitstage verschoben. Für Wochenendarbeit im Kalender-Dialog den Schalter «Wochenenden, Feiertage und Ferien berücksichtigen» ausschalten und erneut importieren.");
    const feiertage: Feiertag[] = [], ferien: Ferienzeitraum[] = [];
    const zeitraeume: { von: string; bis: string; name: string }[] = [];
    // neuere Dateien: <Exceptions>, ältere: <WeekDay> mit DayType 0 und TimePeriod
    for (const ex of [...kal.querySelectorAll("Exceptions > Exception")]) {
      if (ex.querySelector(":scope > DayWorking")?.textContent?.trim() === "1") continue;
      const von = ex.querySelector("TimePeriod > FromDate")?.textContent?.trim(), bis = ex.querySelector("TimePeriod > ToDate")?.textContent?.trim();
      if (von && bis) zeitraeume.push({ von: normalizeDatum(von), bis: normalizeDatum(bis), name: ex.querySelector(":scope > Name")?.textContent?.trim() ?? "" });
    }
    if (zeitraeume.length === 0) {
      for (const w of [...kal.querySelectorAll("WeekDays > WeekDay")]) {
        if (w.querySelector("DayType")?.textContent?.trim() !== "0" || w.querySelector("DayWorking")?.textContent?.trim() === "1") continue;
        const von = w.querySelector("TimePeriod > FromDate")?.textContent?.trim(), bis = w.querySelector("TimePeriod > ToDate")?.textContent?.trim();
        if (von && bis) zeitraeume.push({ von: normalizeDatum(von), bis: normalizeDatum(bis), name: "" });
      }
    }
    for (const z of zeitraeume) {
      if (!parseDateUniversal(z.von) || !parseDateUniversal(z.bis)) continue;
      if (z.von === z.bis) feiertage.push({ datum: z.von, name: z.name || "Feiertag" });
      else ferien.push({ von: z.von, bis: z.bis, name: z.name || "Ferien" });
    }
    if (feiertage.length || ferien.length) kalender = { feiertage, ferien };
  }

  // 4. Hinweise
  if (inaktiv) hinweise.push(`${inaktiv} in MS Project deaktivierte(r) Vorgang/Vorgänge wurde(n) nicht übernommen.`);
  if (andereVerknuepfungsarten) hinweise.push(`${andereVerknuepfungsarten} Verknüpfung(en) vom Typ Anfang-Anfang, Ende-Ende oder Anfang-Ende wurden als Ende-Anfang übernommen — weitere Verknüpfungsarten folgen später.`);
  if (externeVerknuepfungen) hinweise.push(`${externeVerknuepfungen} Verknüpfung(en) auf Vorgänge in anderen Projekten wurden nicht übernommen.`);
  if (unbekannteVorgaenger) hinweise.push(`${unbekannteVorgaenger} Verknüpfung(en) auf Vorgänge, die in der Datei fehlen, wurden nicht übernommen.`);
  if (zuVieleVorgaenger) hinweise.push(`${zuVieleVorgaenger} Vorgänger über dem Maximum von ${MAX_VORGAENGER} je Vorgang wurden nicht übernommen.`);
  if (lagInArbeitstagen) hinweise.push(`${lagInArbeitstagen} Wartezeit(en) waren in Arbeitstagen angegeben und wurden als Kalendertage übernommen (in der App zählen Wartetage als Kalendertage).`);
  if (lagInProzent) hinweise.push(`${lagInProzent} Wartezeit(en) in Prozent der Vorgänger-Dauer werden nicht unterstützt und wurden als 0 Wartetage übernommen.`);
  if (verstricheneDauer) hinweise.push(`${verstricheneDauer} Vorgang/Vorgänge mit verstrichener Dauer (läuft in MS Project auch über freie Tage) — in der App zählen nur Arbeitstage, der Vorgang kann dadurch kürzer werden. Für Arbeit an freien Tagen im Kalender-Dialog den Schalter ausschalten.`);
  if (meilensteine) hinweise.push(`${meilensteine} Meilenstein(e) übernommen (Dauer 0, Raute im Gantt).`);
  if (mitGuids) hinweise.push(`${mitGuids} Vorgang/Vorgänge mit Bauteil-Verknüpfungen aus den Notizen übernommen — diese gelten nur für dieselbe Modellversion. Die Felder «4D-Typ» (Text1), «4D-Kürzel» (Text2) und die Notizen sind in MS Project für die App reserviert.`);
  if (unbekannterTyp) hinweise.push(`${unbekannterTyp} Vorgang/Vorgänge mit unbekanntem Wert im Feld «4D-Typ» (Text1) — als Neubau übernommen.`);
  if (kalender) hinweise.push(`Der Kalender der Datei enthält ${kalender.feiertage.length} Feiertag(e) und ${kalender.ferien?.length ?? 0} Ferienzeitraum/-zeiträume.`);

  return { tasks, hinweise, kalender };
}
