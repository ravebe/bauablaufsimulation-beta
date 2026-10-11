import { describe, it, expect } from "vitest";
import type { Task } from "./types";
import { kaskadiereNachfolger, mitVorgaengern, verschiebeAufStart, zeitraumVerschieben, normalisiereAufArbeitstage } from "./types";
import type { Kalender } from "./components/kalenderHelpers";
import { dauerTage, endPos, startPos } from "./components/zeitHelpers";
import { exportZeilen } from "./components/ganttTabelle";
import { gleicheGanttAb } from "./components/ganttAbgleich";
import { generateMsProjectXml } from "./components/msProjectXml";

const KAL: Kalender = { feiertage: [], ferien: [] };
// 2026-11-13 = Freitag
const task = (id: string, start: string, end: string, p: Partial<Task> = {}): Task =>
  ({ id, name: id, start, end, typ: "neubau", objektGuids: [], ...p });

describe("Meilensteine", () => {
  it("Dauer 0, Start = Ende auf der Zeitachse", () => {
    const m = task("M", "2026-11-13", "2026-11-13", { meilenstein: true, startZeit: "17:00" });
    expect(dauerTage(m, KAL)).toBe(0);
    const min = new Date(2026, 10, 13);
    expect(startPos(m, min)).toBe(1);
    expect(endPos(m, min)).toBe(1);
  });
  it("liegt auf dem Ende des Vorgängers (Fr 17:00); sein Nachfolger beginnt am nächsten Arbeitstag", () => {
    const tasks = [
      task("A", "2026-11-12", "2026-11-13"),
      mitVorgaengern(task("M", "2026-11-01", "2026-11-01", { meilenstein: true }), [{ id: "A", lagDays: 0 }]),
      mitVorgaengern(task("B", "2026-11-01", "2026-11-01"), [{ id: "M", lagDays: 0 }]),
    ];
    const r = kaskadiereNachfolger(tasks, "A", KAL);
    expect(r[1]).toMatchObject({ start: "2026-11-13", end: "2026-11-13", startZeit: "17:00" });
    expect(r[2]).toMatchObject({ start: "2026-11-16", end: "2026-11-16", startZeit: undefined });
  });
  it("Verschieben und Datumswahl halten Ende = Start", () => {
    const m = task("M", "2026-11-13", "2026-11-13", { meilenstein: true });
    expect(verschiebeAufStart([m], "M", "2026-11-18", KAL)[0]).toMatchObject({ start: "2026-11-18", end: "2026-11-18" });
    expect(zeitraumVerschieben(m, "2026-11-14", "start", KAL)).toMatchObject({ start: "2026-11-16", end: "2026-11-16" }); // Sa → Mo
  });
  it("Import-Normalisierung: Meilenstein auf freiem Tag rückt auf den nächsten Arbeitstag, Ende = Start", () => {
    const r = normalisiereAufArbeitstage([task("M", "2026-11-14", "2026-11-20", { meilenstein: true })], KAL);
    expect(r.tasks[0]).toMatchObject({ start: "2026-11-16", end: "2026-11-16" });
  });
  it("Excel-Export: Ende = Start, Kennzeichen Meilenstein", () => {
    const z = exportZeilen([task("M", "2026-11-13", "2026-11-13", { meilenstein: true, startZeit: "17:00" })], KAL);
    expect(z[0]).toMatchObject({ meilenstein: true, start: "13.11.2026 17:00", ende: "13.11.2026 17:00" });
  });
  it("MS Project: Milestone 1 mit Dauer 0", () => {
    const xml = generateMsProjectXml([task("M", "2026-11-13", "2026-11-13", { meilenstein: true, startZeit: "17:00" })], "T", KAL);
    expect(xml).toContain("<Milestone>1</Milestone>");
    expect(xml).toContain("<Duration>PT0H0M0S</Duration>");
    expect(xml).toContain("<Finish>2026-11-13T17:00:00</Finish>");
  });
});

describe("MS Project: Wiedererkennung und Felder", () => {
  it("Task-ID im GUID-Feld, Typ/Kürzel als benannte Felder, ohne Vorgänger manuell geplant", () => {
    const id = "1b4e28ba-2fa1-11d2-883f-0016d3cca427";
    const xml = generateMsProjectXml([task(id, "2026-11-09", "2026-11-10", { bauteilKuerzel: "WB" })], "T", KAL);
    expect(xml).toContain(`<GUID>${id.toUpperCase()}</GUID>`);
    expect(xml).toContain("<Alias>4D-Typ</Alias>");
    expect(xml).toContain("<FieldID>188743734</FieldID><Value>WB</Value>");
    expect(xml).toContain("<Manual>1</Manual>");
    expect(xml).not.toContain("<Text1>");
  });
  it("Re-Import erkennt umbenannte Vorgänge über die Task-ID und behält ihre Kalkulationsdaten", () => {
    const alt = [task("id-1", "2026-11-09", "2026-11-10", { mengen: { sch: 5 }, personalSoll: 4 })];
    const neu = [task("id-1", "2026-11-09", "2026-11-11", { name: "Wand neu benannt" })];
    const r = gleicheGanttAb(alt, neu);
    expect(r.zugeordnet).toBe(1);
    expect(r.tasks[0]).toMatchObject({ id: "id-1", name: "Wand neu benannt", end: "2026-11-11", mengen: { sch: 5 }, personalSoll: 4 });
  });
});
