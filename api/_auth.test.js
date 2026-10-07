import { describe, it, expect, afterEach, vi } from "vitest";
import { pruefeProjektZugriff, zugriffErlaubt } from "./_auth.js";

// Simuliertes Trimble Connect: Projekt P liegt in Europa, Mitglied ist nur Token "gut"
const tc = vi.fn(async (url, init) => {
  const token = init.headers.Authorization.replace("Bearer ", "");
  if (token === "abgelaufen") return { ok: false, status: 401 };
  if (!url.startsWith("https://app21.")) return { ok: false, status: 404 };
  if (!url.endsWith("/projects/P")) return { ok: false, status: 404 };
  return token === "gut" ? { ok: true, status: 200 } : { ok: false, status: 403 };
});

let n = 0; // eigene Projekt-IDs je Test, damit der Cache nicht stört
const id = () => `P${++n}`;

describe("pruefeProjektZugriff", () => {
  it("Mitglied → ok (auch wenn die Region zuerst falsch geraten wird)", async () => {
    expect(await pruefeProjektZugriff("Bearer gut", "P", "northamerica", tc)).toBe("ok");
  });
  it("ohne Token → fehlt (ohne TC zu fragen)", async () => {
    tc.mockClear();
    expect(await pruefeProjektZugriff(undefined, "P", "europe", tc)).toBe("fehlt");
    expect(tc).not.toHaveBeenCalled();
  });
  it("abgelaufenes Token → ungueltig", async () => {
    expect(await pruefeProjektZugriff("Bearer abgelaufen", "P", "europe", tc)).toBe("ungueltig");
  });
  it("kein Mitglied → kein-mitglied", async () => {
    expect(await pruefeProjektZugriff("Bearer fremd", "P", "europe", tc)).toBe("kein-mitglied");
  });
  it("Ergebnis wird gecacht", async () => {
    tc.mockClear();
    await pruefeProjektZugriff("Bearer gut", "P", "europe", tc);
    expect(tc).not.toHaveBeenCalled(); // aus erstem Test im Cache
  });
  it("TC nicht erreichbar → fehler, wird nicht gecacht", async () => {
    const kaputt = vi.fn(async () => { throw new Error("netz"); });
    const p = id();
    expect(await pruefeProjektZugriff("Bearer gut", p, "europe", kaputt)).toBe("fehler");
    expect(await pruefeProjektZugriff("Bearer gut", p, "europe", kaputt)).toBe("fehler");
    expect(kaputt.mock.calls.length).toBeGreaterThan(4);
  });
});

describe("zugriffErlaubt (Modus)", () => {
  const antwort = () => {
    const r = { headers: {}, code: 200, body: null };
    r.setHeader = (k, v) => { r.headers[k] = v; };
    r.status = c => { r.code = c; return r; };
    r.json = b => { r.body = b; return r; };
    return r;
  };
  afterEach(() => { delete process.env.SYNC_AUTH; });

  it("Protokoll-Modus (Standard): ohne Token trotzdem erlaubt, Ergebnis im Header", async () => {
    const res = antwort();
    expect(await zugriffErlaubt({ headers: {} }, res, id())).toBe(true);
    expect(res.headers["X-Sync-Auth"]).toBe("fehlt; modus=protokoll");
  });
  it("Pflicht-Modus: ohne Token → 401", async () => {
    process.env.SYNC_AUTH = "pflicht";
    const res = antwort();
    expect(await zugriffErlaubt({ headers: {} }, res, id())).toBe(false);
    expect(res.code).toBe(401);
  });
  it("Aus-Modus: keine Prüfung, kein Header", async () => {
    process.env.SYNC_AUTH = "aus";
    const res = antwort();
    expect(await zugriffErlaubt({ headers: {} }, res, id())).toBe(true);
    expect(res.headers["X-Sync-Auth"]).toBeUndefined();
  });
});
