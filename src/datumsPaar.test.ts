import { describe, it, expect } from "vitest";
import { datumsPaarVerschieben } from "./types";

describe("datumsPaarVerschieben", () => {
  it("Start verschieben → Ende wandert mit, Dauer bleibt", () => {
    // 5.11.–8.11. (3 Tage) → Start auf 10.11.
    expect(datumsPaarVerschieben("2026-11-05", "2026-11-08", "2026-11-10", "start")).toEqual({ start: "2026-11-10", end: "2026-11-13" });
  });
  it("Ende verschieben → Start wandert mit, Dauer bleibt", () => {
    expect(datumsPaarVerschieben("2026-11-05", "2026-11-08", "2026-11-20", "end")).toEqual({ start: "2026-11-17", end: "2026-11-20" });
  });
  it("auch nach vorne und über Monatsgrenzen", () => {
    expect(datumsPaarVerschieben("2026-12-05", "2026-12-08", "2026-11-28", "start")).toEqual({ start: "2026-11-28", end: "2026-12-01" });
  });
  it("Dauer 0 (ein Tag) bleibt ein Tag", () => {
    expect(datumsPaarVerschieben("2026-11-05", "2026-11-05", "2026-11-09", "end")).toEqual({ start: "2026-11-09", end: "2026-11-09" });
  });
  it("fehlerhaftes Paar (Ende vor Start) wird auf einen Tag gebracht", () => {
    expect(datumsPaarVerschieben("2026-12-01", "2026-11-06", "2026-12-03", "start")).toEqual({ start: "2026-12-03", end: "2026-12-03" });
  });
  it("nicht lesbare Daten: nur das geänderte Datum wird gesetzt", () => {
    expect(datumsPaarVerschieben("", "2026-11-01", "2026-11-09", "start")).toEqual({ start: "2026-11-09", end: "2026-11-01" });
  });
});
