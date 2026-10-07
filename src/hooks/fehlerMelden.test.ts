import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { sollMelden, drosselungZuruecksetzen, fehlerMelden, fehlerKontextSetzen } from "./fehlerMelden";

describe("Drosselung", () => {
  beforeEach(() => drosselungZuruecksetzen());

  it("gleiche Meldung höchstens 1× pro Minute", () => {
    expect(sollMelden("a", 0)).toBe(true);
    expect(sollMelden("a", 30000)).toBe(false);
    expect(sollMelden("a", 61000)).toBe(true);
  });
  it("verschiedene Meldungen unabhängig", () => {
    expect(sollMelden("a", 0)).toBe(true);
    expect(sollMelden("b", 0)).toBe(true);
  });
  it("höchstens 20 je Sitzung", () => {
    for (let i = 0; i < 20; i++) expect(sollMelden(`m${i}`, 0)).toBe(true);
    expect(sollMelden("m20", 0)).toBe(false);
  });
});

describe("fehlerMelden", () => {
  beforeEach(() => drosselungZuruecksetzen());
  afterEach(() => { vi.unstubAllGlobals(); fehlerKontextSetzen({ api: null, projectId: null }); });

  it("ohne Projekt: nichts senden, nicht werfen", () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    expect(() => fehlerMelden("Test", new Error("x"))).not.toThrow();
    expect(f).not.toHaveBeenCalled();
  });

  it("wirft nie — auch bei seltsamen Fehlerwerten", () => {
    expect(() => fehlerMelden("Test", undefined)).not.toThrow();
    expect(() => fehlerMelden("Test", { toString() { throw new Error("böse"); } })).not.toThrow();
  });
});
