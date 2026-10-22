import { describe, it, expect } from "vitest";
import type { Task } from "./types";
import { kaskadiereNachfolger, mitVorgaengern, verschiebeAufStart, zeitraumVerschieben, parseDateUniversal } from "./types";
import type { Kalender } from "./components/kalenderHelpers";
import { arbeitsMinutenZwischen, endeAusArbeitsMinuten, startAusArbeitsMinuten, folgeStartZeitpunkt, fmtDauer, rundeZeitenAufEinheit,
  benoetigteZeiteinheit, importZeit, leseUhrzeit, dauerTage, tagesAnteil, rundeAufEinheit } from "./components/zeitHelpers";
import { rundeDauer } from "./components/stammdatenHelpers";
import { exportZeilen } from "./components/ganttTabelle";
import { generateMsProjectXml } from "./components/msProjectXml";

const KAL: Kalender = { feiertage: [], ferien: [] };
// 2026-11-09 = Montag, 2026-11-13 = Freitag
const task = (id: string, start: string, end: string, p: Partial<Task> = {}): Task =>
  ({ id, name: id, start, end, typ: "neubau", objektGuids: [], ...p });
const zp = (datum: string, hhmm: string) => ({ datum, min: Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3)) });

describe("Arbeitszeit 08–12 / 13–17", () => {
  it("Arbeitsminuten zwischen zwei Zeitpunkten", () => {
    expect(arbeitsMinutenZwischen(zp("2026-11-09", "08:00"), zp("2026-11-09", "12:00"), KAL)).toBe(240);
    expect(arbeitsMinutenZwischen(zp("2026-11-09", "13:00"), zp("2026-11-10", "12:00"), KAL)).toBe(480);
    expect(arbeitsMinutenZwischen(zp("2026-11-13", "13:00"), zp("2026-11-16", "12:00"), KAL)).toBe(480); // Fr NM – Mo VM
    expect(arbeitsMinutenZwischen(zp("2026-11-09", "08:00"), zp("2026-11-11", "17:00"), KAL)).toBe(3 * 480);
  });
  it("Ende und Start aus Arbeitsminuten", () => {
    expect(endeAusArbeitsMinuten(zp("2026-11-09", "13:00"), 480, KAL)).toEqual(zp("2026-11-10", "12:00"));
    expect(endeAusArbeitsMinuten(zp("2026-11-13", "13:00"), 360, KAL)).toEqual(zp("2026-11-16", "10:00"));
    expect(startAusArbeitsMinuten(zp("2026-11-10", "12:00"), 480, KAL)).toEqual(zp("2026-11-09", "13:00"));
  });
  it("Nachfolger wie MS Project: Ende 12:00 → 13:00 am selben Tag, Ende 17:00 → nächster Arbeitstag 08:00", () => {
    expect(folgeStartZeitpunkt(zp("2026-11-09", "12:00"), 0, KAL)).toEqual(zp("2026-11-09", "13:00"));
    expect(folgeStartZeitpunkt(zp("2026-11-13", "17:00"), 0, KAL)).toEqual(zp("2026-11-16", "08:00"));
    expect(folgeStartZeitpunkt(zp("2026-11-13", "12:00"), 1, KAL)).toEqual(zp("2026-11-16", "08:00")); // Sa 12:00 → Mo
    expect(folgeStartZeitpunkt(zp("2026-11-13", "17:00"), 3, KAL)).toEqual(zp("2026-11-17", "08:00")); // wie Tages-Regel: Di
  });
  it("Anzeige der Dauer", () => {
    expect(fmtDauer(3, "tage")).toBe("3d");
    expect(fmtDauer(2.5, "halbtage")).toBe("2,5d");
    expect(fmtDauer(2.375, "stunden")).toBe("2d 3h");
    expect(fmtDauer(0.25, "stunden")).toBe("2h");
    expect(tagesAnteil(13 * 60)).toBe(0.5);
  });
});

describe("Tasks mit Halbtagen / Uhrzeit", () => {
  it("Dauer eines Halbtags-Tasks", () => {
    expect(dauerTage(task("A", "2026-11-09", "2026-11-10", { startZeit: "13:00", endZeit: "12:00" }), KAL)).toBe(1);
    expect(dauerTage(task("A", "2026-11-09", "2026-11-09", { endZeit: "12:00" }), KAL)).toBe(0.5);
  });
  it("Verschieben behält Startzeit und Dauer in Arbeitszeit", () => {
    const r = verschiebeAufStart([task("A", "2026-11-09", "2026-11-10", { startZeit: "13:00", endZeit: "12:00" })], "A", "2026-11-11", KAL);
    expect(r[0]).toMatchObject({ start: "2026-11-11", end: "2026-11-12", startZeit: "13:00", endZeit: "12:00" });
  });
  it("Startzeit ändern verschiebt das Ende mit", () => {
    const r = zeitraumVerschieben(task("A", "2026-11-09", "2026-11-09", { endZeit: "12:00" }), "2026-11-09", "start", KAL, 13 * 60);
    expect(r).toEqual({ start: "2026-11-09", end: "2026-11-09", startZeit: "13:00", endZeit: undefined }); // 13–17
  });
  it("Kaskade: Nachfolger eines Vormittag-Tasks beginnt am Nachmittag", () => {
    const tasks = [task("A", "2026-11-09", "2026-11-09", { endZeit: "12:00" }), mitVorgaengern(task("B", "2026-11-09", "2026-11-09", { endZeit: "12:00" }), [{ id: "A", lagDays: 0 }])];
    const r = kaskadiereNachfolger(tasks, "A", KAL);
    expect(r[1]).toMatchObject({ start: "2026-11-09", end: "2026-11-09", startZeit: "13:00", endZeit: undefined });
  });
  it("Tage-Tasks bleiben unverändert (keine Uhrzeiten)", () => {
    const tasks = [task("A", "2026-11-09", "2026-11-10"), mitVorgaengern(task("B", "2026-11-09", "2026-11-09"), [{ id: "A", lagDays: 0 }])];
    const r = kaskadiereNachfolger(tasks, "A", KAL);
    expect(r[1]).toEqual({ ...tasks[1], start: "2026-11-11", end: "2026-11-11", startZeit: undefined, endZeit: undefined });
  });
});

describe("Zeiteinheit umstellen und Import", () => {
  it("Runden: Uhrzeit → Halbtage → Tage", () => {
    const t = task("A", "2026-11-09", "2026-11-10", { startZeit: "10:30", endZeit: "14:00" });
    expect(rundeZeitenAufEinheit(t, "halbtage")).toMatchObject({ startZeit: undefined, endZeit: undefined });
    expect(rundeZeitenAufEinheit(task("A", "2026-11-09", "2026-11-10", { startZeit: "13:30", endZeit: "11:00" }), "halbtage")).toMatchObject({ startZeit: "13:00", endZeit: "12:00" });
    expect(rundeZeitenAufEinheit(t, "tage")).toMatchObject({ startZeit: undefined, endZeit: undefined });
  });
  it("Benötigte Zeiteinheit erkennen", () => {
    expect(benoetigteZeiteinheit([task("A", "2026-11-09", "2026-11-09")])).toBe("tage");
    expect(benoetigteZeiteinheit([task("A", "2026-11-09", "2026-11-09", { endZeit: "12:00" })])).toBe("halbtage");
    expect(benoetigteZeiteinheit([task("A", "2026-11-09", "2026-11-09", { startZeit: "09:30" })])).toBe("stunden");
  });
  it("Uhrzeiten aus Importwerten", () => {
    expect(leseUhrzeit("2026-11-09T13:00:00")).toBe("13:00");
    expect(leseUhrzeit("09.11.2026 13:30")).toBe("13:30");
    expect(leseUhrzeit(46335.5)).toBe("12:00");          // Excel-Seriennummer mit halbem Tag
    expect(leseUhrzeit(46335)).toBeUndefined();
    expect(importZeit("2026-11-09T08:00:00", "start")).toBeUndefined();
    expect(importZeit("2026-11-09T17:00:00", "ende")).toBeUndefined();
    expect(parseDateUniversal("09.11.2026 13:00")?.getDate()).toBe(9);
  });
  it("Kalkulation rundet auf die Zeiteinheit", () => {
    expect(rundeDauer(2.3, "tage")).toBe(3);
    expect(rundeDauer(2.3, "halbtage")).toBe(2.5);
    expect(rundeDauer(2.3, "stunden")).toBe(2.375);
    expect(rundeAufEinheit(0.2, "stunden")).toBe(0.25);
  });
  it("Kalkulation: keine Mindestdauer von 2 Tagen mehr — mindestens ein Schritt der Zeiteinheit, 0 nur ohne Aufwand", () => {
    expect(rundeDauer(0.96, "tage")).toBe(1);
    expect(rundeDauer(0.03, "tage")).toBe(1);
    expect(rundeDauer(1.2, "tage")).toBe(2);
    expect(rundeDauer(0.03, "halbtage")).toBe(0.5);
    expect(rundeDauer(0.71, "halbtage")).toBe(1);
    expect(rundeDauer(0.03, "stunden")).toBe(0.125); // 1 Stunde bei 8 h/Tag (Standard-Arbeitszeit der Tests)
    expect(rundeDauer(0, "tage")).toBe(0);
  });
  it("Export: Uhrzeit hinter dem Datum, MS Project mit Uhrzeiten und Dauer in Stunden", () => {
    const tasks = [task("A", "2026-11-09", "2026-11-10", { startZeit: "13:00", endZeit: "12:00" })];
    const z = exportZeilen(tasks, KAL);
    expect(z[0].start).toBe("09.11.2026 13:00");
    expect(z[0].ende).toBe("10.11.2026 12:00");
    const xml = generateMsProjectXml(tasks, "T", KAL);
    expect(xml).toContain("<Start>2026-11-09T13:00:00</Start>");
    expect(xml).toContain("<Finish>2026-11-10T12:00:00</Finish>");
    expect(xml).toContain("<Duration>PT8H0M0S</Duration>");
  });
});
