import { describe, it, expect } from "vitest";
import { datumsPaarAnpassen } from "./types";

describe("datumsPaarAnpassen", () => {
  it("gültiges Paar bleibt unverändert", () => {
    expect(datumsPaarAnpassen("2026-11-05", "2026-11-06", "start")).toEqual({ start: "2026-11-05", end: "2026-11-06" });
    expect(datumsPaarAnpassen("2026-11-05", "2026-11-05", "end")).toEqual({ start: "2026-11-05", end: "2026-11-05" });
  });
  it("Start hinter dem Ende → Ende zieht auf den Start nach", () => {
    expect(datumsPaarAnpassen("2026-12-01", "2026-11-06", "start")).toEqual({ start: "2026-12-01", end: "2026-12-01" });
  });
  it("Ende vor dem Start → Start zieht auf das Ende nach", () => {
    expect(datumsPaarAnpassen("2026-11-05", "2026-11-01", "end")).toEqual({ start: "2026-11-01", end: "2026-11-01" });
  });
  it("nicht lesbare Daten werden nicht angefasst", () => {
    expect(datumsPaarAnpassen("", "2026-11-01", "start")).toEqual({ start: "", end: "2026-11-01" });
  });
});
