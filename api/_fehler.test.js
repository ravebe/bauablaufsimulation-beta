import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

// Redis über fetch simuliert; Anmeldung aus (getestet in _auth.test.js)
const listen = new Map();
beforeAll(() => {
  process.env.UPSTASH_REDIS_REST_URL = "http://redis";
  process.env.UPSTASH_REDIS_REST_TOKEN = "t";
  process.env.SYNC_AUTH = "aus";
  vi.stubGlobal("fetch", async (_u, init) => {
    const [cmd, key, a, b] = JSON.parse(init.body);
    const l = listen.get(key) ?? [];
    let result = "OK";
    if (cmd === "LPUSH") { l.unshift(a); listen.set(key, l); }
    if (cmd === "LTRIM") listen.set(key, l.slice(Number(a), Number(b) + 1));
    if (cmd === "LRANGE") result = l.slice(Number(a), Number(b) + 1);
    return { ok: true, json: async () => ({ result }) };
  });
});
afterAll(() => { vi.unstubAllGlobals(); delete process.env.SYNC_AUTH; });

const aufruf = async (handler, method, query, body) => {
  const r = { code: 200, body: null, setHeader() {}, status(c) { r.code = c; return r; }, json(b) { r.body = b; return r; }, end() { return r; } };
  await handler({ method, query, body, headers: { "user-agent": "Test" } }, r);
  return r;
};

describe("api/fehler", () => {
  it("speichert eine Meldung und liefert sie wieder (neueste zuerst, gekürzt)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { default: handler } = await import("./fehler.js");
    await aufruf(handler, "POST", {}, { projectId: "P", bereich: "Cloud-Speichern", meldung: "erste" });
    await aufruf(handler, "POST", {}, { projectId: "P", bereich: "Anzeige", meldung: "x".repeat(5000), build: "2026-10-07T12:00" });
    const r = await aufruf(handler, "GET", { projectId: "P" });
    expect(r.code).toBe(200);
    expect(r.body.fehler.map(f => f.bereich)).toEqual(["Anzeige", "Cloud-Speichern"]);
    expect(r.body.fehler[0].meldung.length).toBe(1000);
    expect(r.body.fehler[0].build).toBe("2026-10-07T12:00");
    expect(r.body.fehler[0].browser).toBe("Test");
  });
  it("ohne projectId → 400", async () => {
    const { default: handler } = await import("./fehler.js");
    expect((await aufruf(handler, "POST", {}, { meldung: "x" })).code).toBe(400);
  });
});
