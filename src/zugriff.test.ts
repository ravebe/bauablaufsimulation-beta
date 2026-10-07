import { describe, it, expect } from "vitest";
import { zugriffFuer, darfBearbeiten, istSichtbar, darfRechteVerwalten, mitBearbeitungGeteilt } from "./zugriff";
import type { Zugriff } from "./types";

const sim = (erstellerId: string | undefined, zugriff?: Record<string, Zugriff>) => ({ erstellerId, zugriff });

describe("zugriffFuer", () => {
  it("Ersteller → edit, auch wenn ein Eintrag etwas anderes sagt", () => {
    expect(zugriffFuer(sim("u1", { u1: "read" }), "u1")).toBe("edit");
  });
  it("individueller Eintrag vor Standard", () => {
    expect(zugriffFuer(sim("x", { __default__: "read", u2: "edit" }), "u2")).toBe("edit");
    expect(zugriffFuer(sim("x", { __default__: "edit", u2: "none" }), "u2")).toBe("none");
  });
  it("ohne Eintrag → Standard, ohne Standard → read", () => {
    expect(zugriffFuer(sim("x", { __default__: "edit" }), "u2")).toBe("edit");
    expect(zugriffFuer(sim("x"), "u2")).toBe("read");
  });
  it("Benutzer unbekannt → read; keine Sim → read", () => {
    expect(zugriffFuer(sim("x", { __default__: "edit" }), null)).toBe("read");
    expect(zugriffFuer(null, "u1")).toBe("read");
  });
});

describe("abgeleitete Regeln", () => {
  it("darfBearbeiten nur bei edit", () => {
    expect(darfBearbeiten(sim("x", { u2: "edit" }), "u2")).toBe(true);
    expect(darfBearbeiten(sim("x", { u2: "read" }), "u2")).toBe(false);
  });
  it("istSichtbar: none blendet aus, unbekannter Benutzer sieht alles, Ersteller immer", () => {
    expect(istSichtbar(sim("x", { u2: "none" }), "u2")).toBe(false);
    expect(istSichtbar(sim("x", { __default__: "none" }), null)).toBe(true);
    expect(istSichtbar(sim("u1", { __default__: "none" }), "u1")).toBe(true);
  });
  it("Rechte verwalten: Admin oder Ersteller, nicht blosser Bearbeiter", () => {
    expect(darfRechteVerwalten(sim("u1"), "u1", false)).toBe(true);
    expect(darfRechteVerwalten(sim("x", { u2: "edit" }), "u2", false)).toBe(false);
    expect(darfRechteVerwalten(sim("x"), "u2", true)).toBe(true);
    expect(darfRechteVerwalten(null, "u2", true)).toBe(false);
  });
  it("mitBearbeitungGeteilt: anderer Bearbeiter, Standard edit oder anderer Ersteller", () => {
    expect(mitBearbeitungGeteilt(sim("u1"), "u1")).toBe(false);
    expect(mitBearbeitungGeteilt(sim("u1", { u2: "edit" }), "u1")).toBe(true);
    expect(mitBearbeitungGeteilt(sim("u1", { __default__: "edit" }), "u1")).toBe(true);
    expect(mitBearbeitungGeteilt(sim("u1", { u2: "edit" }), "u2")).toBe(true); // Ersteller u1 kann auch
  });
});
