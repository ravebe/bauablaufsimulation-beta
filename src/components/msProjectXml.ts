// msProjectXml.ts — Import/Export im echten MS-Project-XML-Schema
// (das Format, das MS Project über "Datei → Speichern unter → XML" liest/schreibt)
//
// Abbildung der App-Regeln auf MS Project:
//  - Dauer = Arbeitstage (Start und Ende inklusive) → <Duration> in 8-h-Tagen, Arbeitszeit 08–12 / 13–17 Uhr
//  - Termine bleiben erhalten: jeder (Nicht-Sammel-)Vorgang erhält "Anfang nicht früher als" (ConstraintType 4) mit
//    seinem Start, sonst würde MS Project Vorgänge ohne Vorgänger "so früh wie möglich" an den Projektbeginn ziehen
//  - ein 1-Tages-Vorgang ist KEIN Meilenstein (Milestone immer 0)
//  - Wartetage = Kalendertage → LinkLag als verstrichene Tage (LagFormat 8 "ed", 1 Tag = 14400 Zehntelminuten)
//  - Kalender: Mo–Fr (bzw. Mo–So bei ausgeschaltetem Schalter "Wochenenden, Feiertage und Ferien berücksichtigen")
//    mit Feiertagen und Ferien als Ausnahmen
//  - bis zu 30 Vorgänger je Vorgang (mehrere PredecessorLink)
import type { Task, TaskTyp } from "../types";
import { getOutlineLevel, istGruppe, parseDateUniversal, normalizeDatum, vorgaengerListe, MAX_VORGAENGER } from "../types";
import type { Kalender } from "./kalenderHelpers";
import { LEERER_KALENDER } from "./kalenderHelpers";
import { dauerTage, startZeitpunkt, endZeitpunkt, minZuZeit, importZeit } from "./zeitHelpers";

const GUID_MARKER = "4DSIM_GUIDS:";
const ZEHNTELMIN_PRO_ARBEITSTAG = 4800;      // 8 h × 60 min × 10
const ZEHNTELMIN_PRO_KALENDERTAG = 14400;    // 24 h × 60 min × 10
const LAGFORMAT_ELAPSED_DAYS = 8;            // "ed" — verstrichene Tage
// MS-Project-LagFormat: gerade Werte 4, 6, 8, 10, 12 (und 20 = elapsed %) sind "verstrichen", die übrigen Arbeitszeit
const ELAPSED_LAGFORMATE = new Set([4, 6, 8, 10, 12, 20]);

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function fmtDateTime(iso: string, time: string): string {
  const d = parseDateUniversal(iso);
  if (!d) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T${time}`;
}

const ARBEITSZEITEN = `
            <WorkingTimes>
              <WorkingTime><FromTime>08:00:00</FromTime><ToTime>12:00:00</ToTime></WorkingTime>
              <WorkingTime><FromTime>13:00:00</FromTime><ToTime>17:00:00</ToTime></WorkingTime>
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
            <DayWorking>${arbeitet ? 1 : 0}</DayWorking>${arbeitet ? ARBEITSZEITEN : ""}
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
    const dauerMin = Math.round(dauerTage(t, kalender) * 480); // Arbeitszeit in Minuten (8-h-Tage)
    const sz = `${minZuZeit(startZeitpunkt(t).min)}:00`, ez = `${minZuZeit(endZeitpunkt(t).min)}:00`;
    const notesLine = t.objektGuids.length > 0 ? `${GUID_MARKER}${t.objektGuids.join(",")}` : "";

    const predXml = vorgaengerListe(t).map(v => {
      const predUid = uidById.get(v.id);
      if (!predUid) return "";
      const lag = Math.round((v.lagDays ?? 0) * ZEHNTELMIN_PRO_KALENDERTAG);
      return `\n      <PredecessorLink>\n        <PredecessorUID>${predUid}</PredecessorUID>\n        <Type>1</Type>\n        <CrossProject>0</CrossProject>\n        <LinkLag>${lag}</LinkLag>\n        <LagFormat>${LAGFORMAT_ELAPSED_DAYS}</LagFormat>\n      </PredecessorLink>`;
    }).join("");

    // Termin festhalten (Anfang nicht früher als), damit MS Project den Vorgang nicht an den Projektbeginn zieht
    const constraint = !gruppe && t.start
      ? `\n      <ConstraintType>4</ConstraintType>\n      <ConstraintDate>${fmtDateTime(t.start, sz)}</ConstraintDate>`
      : "";

    return `    <Task>
      <UID>${uid}</UID>
      <ID>${uid}</ID>
      <Name>${esc(t.name)}</Name>
      <Type>1</Type>
      <IsNull>0</IsNull>
      <OutlineLevel>${getOutlineLevel(t)}</OutlineLevel>
      <Priority>500</Priority>
      <Start>${fmtDateTime(t.start, sz)}</Start>
      <Finish>${fmtDateTime(t.end, ez)}</Finish>
      <Duration>PT${Math.floor(dauerMin / 60)}H${dauerMin % 60}M0S</Duration>
      <DurationFormat>7</DurationFormat>
      <Summary>${gruppe ? 1 : 0}</Summary>
      <Milestone>0</Milestone>
      <CalendarUID>-1</CalendarUID>${constraint}
      <Text1>${esc(t.typ)}</Text1>
      <Text2>${esc(t.bauteilKuerzel ?? "")}</Text2>${notesLine ? `\n      <Notes>${esc(notesLine)}</Notes>` : ""}${predXml}
    </Task>`;
  }).join("\n");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Project xmlns="http://schemas.microsoft.com/project">
  <SaveVersion>14</SaveVersion>
  <Name>${esc(projectName)}</Name>
  <Title>${esc(projectName)}</Title>
  <ScheduleFromStart>1</ScheduleFromStart>
  <StartDate>${fmtDateTime(minStart || heuteIso, "08:00:00")}</StartDate>
  <FinishDate>${fmtDateTime(maxEnd || heuteIso, "17:00:00")}</FinishDate>
  <CurrentDate>${fmtDateTime(heuteIso, "08:00:00")}</CurrentDate>
  <CalendarUID>1</CalendarUID>
  <DefaultStartTime>08:00:00</DefaultStartTime>
  <DefaultFinishTime>17:00:00</DefaultFinishTime>
  <MinutesPerDay>480</MinutesPerDay>
  <MinutesPerWeek>2400</MinutesPerWeek>
  <DaysPerMonth>20</DaysPerMonth>${kalenderXml(kalender)}
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

/** Import mit Hinweisen auf alles, was die App (noch) anders macht als MS Project — erscheinen nach dem Import als Meldung. */
export function parseMsProjectXmlMitHinweisen(text: string): { tasks: Task[]; hinweise: string[] } {
  const doc = new DOMParser().parseFromString(text, "text/xml");
  const taskEls = [...doc.querySelectorAll("Tasks > Task")];

  const g = (el: Element, tag: string) => el.querySelector(`:scope > ${tag}`)?.textContent?.trim() ?? "";

  // Zähler für die Hinweise
  let andereVerknuepfungsarten = 0, zuVieleVorgaenger = 0, lagInArbeitstagen = 0, mitGuids = 0, unbekannterTyp = 0, mitUhrzeit = 0;

  // 1. Rohdaten sammeln + lokale IDs vergeben (Projekt-Summary-Zeile mit OutlineLevel 0 überspringen)
  interface Roh { uid: string; localId: string; name: string; outlineLevel: number; summary: boolean;
    start: string; end: string; startZeit?: string; endZeit?: string; typ: TaskTyp; bauteilKuerzel: string | undefined; objektGuids: string[]; links: { uid: string; lag: number }[]; }
  const roh: Roh[] = [];
  for (const el of taskEls) {
    if (g(el, "IsNull") === "1") continue;
    const outlineLevelRaw = g(el, "OutlineLevel");
    const outlineLevel = outlineLevelRaw === "" ? 1 : Number(outlineLevelRaw);
    if (outlineLevel === 0) continue; // Projekt-Summary-Zeile
    const uid = g(el, "UID") || g(el, "ID");
    const typRaw = g(el, "Text1").toLowerCase();
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
      const typLink = Number(pl.querySelector("Type")?.textContent ?? "1");
      if (typLink !== 1) andereVerknuepfungsarten++;
      const linkLag = Number(pl.querySelector("LinkLag")?.textContent ?? "0") || 0;
      const lagFormat = Number(pl.querySelector("LagFormat")?.textContent ?? "7");
      let lagTage: number;
      if (ELAPSED_LAGFORMATE.has(lagFormat)) lagTage = linkLag / ZEHNTELMIN_PRO_KALENDERTAG;
      else { lagTage = linkLag / ZEHNTELMIN_PRO_ARBEITSTAG; if (linkLag !== 0) lagInArbeitstagen++; }
      if (links.length >= MAX_VORGAENGER) { zuVieleVorgaenger++; continue; }
      links.push({ uid: predUid, lag: Math.round(lagTage) });
    }

    const startRoh = g(el, "Start"), finishRoh = g(el, "Finish") || startRoh;
    const zeit = (s: string) => s.match(/T(\d{2}:\d{2})/)?.[1];
    if ((zeit(startRoh) && zeit(startRoh) !== "08:00") || (zeit(finishRoh) && zeit(finishRoh) !== "17:00")) mitUhrzeit++;

    const kuerzelRaw = g(el, "Text2").trim();
    roh.push({
      uid, localId: crypto.randomUUID(), name: g(el, "Name") || "Task",
      outlineLevel, summary: g(el, "Summary") === "1",
      start: normalizeDatum(startRoh), end: normalizeDatum(finishRoh),
      startZeit: importZeit(startRoh, "start"), endZeit: importZeit(finishRoh, "ende"),
      typ, bauteilKuerzel: kuerzelRaw || undefined, objektGuids, links,
    });
  }

  // 2. UID → lokale ID auflösen
  const localIdByUid = new Map(roh.map(r => [r.uid, r.localId]));

  const tasks: Task[] = roh.map(r => {
    const links = r.links.map(l => ({ id: localIdByUid.get(l.uid), lagDays: l.lag })).filter((l): l is { id: string; lagDays: number } => !!l.id);
    const [erster, ...rest] = links;
    return {
      id: r.localId,
      name: r.name,
      start: r.start,
      end: r.end,
      ...(r.startZeit ? { startZeit: r.startZeit } : {}),
      ...(r.endZeit ? { endZeit: r.endZeit } : {}),
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

  // 3. Hinweise
  const hinweise: string[] = [];
  if (andereVerknuepfungsarten) hinweise.push(`${andereVerknuepfungsarten} Verknüpfung(en) vom Typ Anfang-Anfang, Ende-Ende oder Anfang-Ende wurden als Ende-Anfang übernommen — weitere Verknüpfungsarten folgen später.`);
  if (zuVieleVorgaenger) hinweise.push(`${zuVieleVorgaenger} Vorgänger über dem Maximum von ${MAX_VORGAENGER} je Vorgang wurden nicht übernommen.`);
  if (lagInArbeitstagen) hinweise.push(`${lagInArbeitstagen} Wartezeit(en) waren in Arbeitstagen angegeben und wurden als Kalendertage übernommen (in der App zählen Wartetage als Kalendertage).`);
  if (mitGuids) hinweise.push(`${mitGuids} Vorgang/Vorgänge mit Bauteil-Verknüpfungen aus den Notizen übernommen — diese gelten nur für dieselbe Modellversion. Text1 (Typ), Text2 (Kürzel) und die Notizen sind in MS Project für die App reserviert.`);
  if (unbekannterTyp) hinweise.push(`${unbekannterTyp} Vorgang/Vorgänge mit unbekanntem Wert in Text1 — als Neubau übernommen (Text1 ist für den Task-Typ reserviert).`);
  void mitUhrzeit; // Uhrzeiten werden übernommen; die Zeiteinheit stellt der Import automatisch um (siehe TabProjekte)

  // Kalender der Datei: Wochenendarbeit erlaubt?
  const projektKalUid = doc.querySelector("Project > CalendarUID")?.textContent?.trim();
  const kal = [...doc.querySelectorAll("Calendars > Calendar")].find(c => c.querySelector(":scope > UID")?.textContent?.trim() === projektKalUid);
  if (kal) {
    const wochenende = [...kal.querySelectorAll("WeekDays > WeekDay")].some(w =>
      ["1", "7"].includes(w.querySelector("DayType")?.textContent?.trim() ?? "") && w.querySelector("DayWorking")?.textContent?.trim() === "1");
    if (wochenende) hinweise.push("Der Kalender der Datei erlaubt Wochenendarbeit. In der App gelten Wochenenden als arbeitsfrei — Tasks am Wochenende werden auf Arbeitstage verschoben. Für Wochenendarbeit im Kalender-Dialog den Schalter «Wochenenden, Feiertage und Ferien berücksichtigen» ausschalten und erneut importieren.");
  }

  return { tasks, hinweise };
}
