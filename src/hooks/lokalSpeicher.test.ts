import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { lsGet, lsSet, lsGetJson, lsSetSimsCache } from "./lokalSpeicher";

/** Minimaler localStorage mit Grössenlimit (Summe der Werte), wirft wie der Browser QuotaExceededError */
function fakeStorage(limit: number) {
  const m = new Map<string, string>();
  const groesse = () => [...m.values()].reduce((s, v) => s + v.length, 0);
  const store = {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (groesse() - (m.get(k)?.length ?? 0) + v.length > limit) throw new DOMException("voll", "QuotaExceededError");
      m.set(k, v);
    },
    removeItem: (k: string) => { m.delete(k); },
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
  };
  // Object.keys(localStorage) liefert im Browser die gespeicherten Schlüssel
  return new Proxy(store, { ownKeys: () => [...m.keys()], getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }) });
}

const g = globalThis as { localStorage?: unknown };

describe("lokalSpeicher", () => {
  let vorher: unknown;
  beforeEach(() => { vorher = g.localStorage; });
  afterEach(() => { g.localStorage = vorher; });

  it("wirft nie — auch ohne oder mit gesperrtem localStorage", () => {
    g.localStorage = undefined;
    expect(lsGet("a")).toBeNull();
    expect(lsSet("a", "1")).toBe(false);
    expect(lsGetJson("a", { x: 1 })).toEqual({ x: 1 });
  });

  it("voller Speicher: lsSet meldet false statt zu werfen", () => {
    g.localStorage = fakeStorage(5);
    expect(lsSet("a", "123456")).toBe(false);
    expect(lsSet("a", "123")).toBe(true);
  });

  it("Sims-Cache räumt Kopien anderer Projekte, behält Einstellungen", () => {
    const s = fakeStorage(15);
    g.localStorage = s;
    s.setItem("4d-sims-v3::P1", "xxxxxxxx");
    s.setItem("gantt-zoom", "6");
    lsSetSimsCache("4d-sims-v3::P2", "yyyyyyyyyy");
    expect(s.getItem("4d-sims-v3::P2")).toBe("yyyyyyyyyy");
    expect(s.getItem("4d-sims-v3::P1")).toBeNull();
    expect(s.getItem("gantt-zoom")).toBe("6");
  });

  it("Sims-Cache: passt es gar nicht, wird die eigene veraltete Kopie entfernt", () => {
    const s = fakeStorage(10);
    g.localStorage = s;
    s.setItem("4d-sims-v3::P2", "alt");
    lsSetSimsCache("4d-sims-v3::P2", "viel zu gross für den speicher");
    expect(s.getItem("4d-sims-v3::P2")).toBeNull();
  });

  it("kaputtes JSON → Fallback", () => {
    const s = fakeStorage(100);
    g.localStorage = s;
    s.setItem("k", "{kaputt");
    expect(lsGetJson("k", [])).toEqual([]);
  });
});
