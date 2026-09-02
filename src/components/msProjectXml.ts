// msProjectXml.ts — Import/Export im echten MS-Project-XML-Schema
// (das Format, das MS Project über "Datei → Speichern unter → XML" liest/schreibt)
import type { Task, TaskTyp } from "../types";
import { getOutlineLevel, istGruppe, parseDateUniversal, normalizeDatum } from "../types";
import type { Kalender } from "./kalenderHelpers";
import { arbeitstageZwischen, LEERER_KALENDER } from "./kalenderHelpers";

const GUID_MARKER = "4DSIM_GUIDS:";
const MINUTEN_PRO_TAG_LAG = 4800; // MSP LinkLag-Einheit: Zehntel-Minuten, 8h-Arbeitstag

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function fmtDateTime(iso: string, time: string): string {
  const d = parseDateUniversal(iso);
  if (!d) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T${time}`;
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
    const dauerTage = arbeitstageZwischen(t.start, t.end, kalender);
    const meilenstein = t.start === t.end;
    const notesLine = t.objektGuids.length > 0 ? `${GUID_MARKER}${t.objektGuids.join(",")}` : "";

    let predXml = "";
    if (t.predecessorId) {
      const predUid = uidById.get(t.predecessorId);
      if (predUid) {
        const lag = Math.round((t.lagDays ?? 0) * MINUTEN_PRO_TAG_LAG);
        predXml = `\n      <PredecessorLink>\n        <PredecessorUID>${predUid}</PredecessorUID>\n        <Type>1</Type>\n        <CrossProject>0</CrossProject>\n        <LinkLag>${lag}</LinkLag>\n        <LagFormat>7</LagFormat>\n      </PredecessorLink>`;
      }
    }

    return `    <Task>
      <UID>${uid}</UID>
      <ID>${uid}</ID>
      <Name>${esc(t.name)}</Name>
      <Type>1</Type>
      <IsNull>0</IsNull>
      <OutlineLevel>${getOutlineLevel(t)}</OutlineLevel>
      <Priority>500</Priority>
      <Start>${fmtDateTime(t.start, "08:00:00")}</Start>
      <Finish>${fmtDateTime(t.end, "17:00:00")}</Finish>
      <Duration>PT${dauerTage * 8}H0M0S</Duration>
      <DurationFormat>7</DurationFormat>
      <Summary>${gruppe ? 1 : 0}</Summary>
      <Milestone>${meilenstein ? 1 : 0}</Milestone>
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
  <DefaultStartTime>08:00:00</DefaultStartTime>
  <DefaultFinishTime>17:00:00</DefaultFinishTime>
  <MinutesPerDay>480</MinutesPerDay>
  <MinutesPerWeek>2400</MinutesPerWeek>
  <DaysPerMonth>20</DaysPerMonth>
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
  const doc = new DOMParser().parseFromString(text, "text/xml");
  const taskEls = [...doc.querySelectorAll("Tasks > Task")];

  const g = (el: Element, tag: string) => el.querySelector(tag)?.textContent?.trim() ?? "";

  // 1. Rohdaten sammeln + lokale IDs vergeben (Projekt-Summary-Zeile mit OutlineLevel 0 überspringen)
  interface Roh { uid: string; localId: string; name: string; outlineLevel: number; summary: boolean;
    start: string; end: string; typ: TaskTyp; bauteilKuerzel: string | undefined; objektGuids: string[]; predUid: string | null; lagDays: number; }
  const roh: Roh[] = [];
  for (const el of taskEls) {
    if (g(el, "IsNull") === "1") continue;
    const outlineLevelRaw = g(el, "OutlineLevel");
    const outlineLevel = outlineLevelRaw === "" ? 1 : Number(outlineLevelRaw);
    if (outlineLevel === 0) continue; // Projekt-Summary-Zeile
    const uid = g(el, "UID") || g(el, "ID");
    const typRaw = g(el, "Text1").toLowerCase();
    const typ = (GUELTIGE_TYPEN as string[]).includes(typRaw) ? (typRaw as TaskTyp) : "neubau";
    const notes = g(el, "Notes");
    const guidMatch = notes.match(new RegExp(GUID_MARKER + "([^\\n]*)"));
    const objektGuids = guidMatch ? guidMatch[1].split(",").map(s => s.trim()).filter(Boolean) : [];
    const predLinkEl = el.querySelector("PredecessorLink");
    const predUid = predLinkEl ? (predLinkEl.querySelector("PredecessorUID")?.textContent?.trim() ?? null) : null;
    const linkLag = predLinkEl ? Number(predLinkEl.querySelector("LinkLag")?.textContent ?? "0") : 0;

    const kuerzelRaw = g(el, "Text2").trim();
    roh.push({
      uid, localId: crypto.randomUUID(), name: g(el, "Name") || "Task",
      outlineLevel, summary: g(el, "Summary") === "1",
      start: normalizeDatum(g(el, "Start")), end: normalizeDatum(g(el, "Finish") || g(el, "Start")),
      typ, bauteilKuerzel: kuerzelRaw || undefined, objektGuids, predUid, lagDays: linkLag / MINUTEN_PRO_TAG_LAG,
    });
  }

  // 2. UID → lokale ID auflösen
  const localIdByUid = new Map(roh.map(r => [r.uid, r.localId]));

  return roh.map(r => ({
    id: r.localId,
    name: r.name,
    start: r.start,
    end: r.end,
    typ: r.typ,
    bauteilKuerzel: r.bauteilKuerzel,
    objektGuids: r.objektGuids,
    outlineLevel: r.outlineLevel,
    isGroup: r.summary,
    predecessorId: r.predUid ? localIdByUid.get(r.predUid) : undefined,
    lagDays: r.predUid ? r.lagDays : undefined,
  }));
}
