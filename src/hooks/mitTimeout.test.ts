import { describe, it, expect, vi, afterEach } from "vitest";
import { mitTimeout, mitTimeoutOder, fetchMitTimeout, mitWiederholung, Zeitueberschreitung } from "./mitTimeout";

const nie = () => new Promise<never>(() => {});

describe("mitTimeout", () => {
  it("liefert das Ergebnis, wenn rechtzeitig", async () => {
    expect(await mitTimeout(Promise.resolve(5), 50)).toBe(5);
  });
  it("hängender Aufruf → Zeitueberschreitung mit verständlichem Text", async () => {
    await expect(mitTimeout(nie(), 20, "Benutzer-Abfrage")).rejects.toThrow(/Benutzer-Abfrage: keine Antwort innerhalb von 0 s/);
    await expect(mitTimeout(nie(), 20)).rejects.toBeInstanceOf(Zeitueberschreitung);
  });
  it("Fehler des Aufrufs bleibt erhalten", async () => {
    await expect(mitTimeout(Promise.reject(new Error("kaputt")), 50)).rejects.toThrow("kaputt");
  });
  it("mitTimeoutOder: Ersatz bei Hängen und bei Fehler", async () => {
    expect(await mitTimeoutOder(nie(), 20, "x")).toBe("x");
    expect(await mitTimeoutOder(Promise.reject(new Error()), 20, null)).toBeNull();
  });
});

describe("fetchMitTimeout", () => {
  afterEach(() => { vi.unstubAllGlobals(); });
  it("bricht die Anfrage ab und meldet Zeitueberschreitung", async () => {
    let signal: AbortSignal | undefined;
    vi.stubGlobal("fetch", (_u: string, init: RequestInit) => {
      signal = init.signal ?? undefined;
      return new Promise((_, rej) => init.signal?.addEventListener("abort", () => rej(new DOMException("abgebrochen", "AbortError"))));
    });
    await expect(fetchMitTimeout("/x", {}, 20, "Cloud")).rejects.toThrow(/Cloud: keine Antwort/);
    expect(signal?.aborted).toBe(true);
  });
  it("Netzfehler ohne Abbruch wird durchgereicht", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("Failed to fetch")));
    await expect(fetchMitTimeout("/x", {}, 1000)).rejects.toThrow("Failed to fetch");
  });
});

describe("mitWiederholung", () => {
  it("wiederholt bis Erfolg", async () => {
    let n = 0;
    expect(await mitWiederholung(async () => { if (++n < 3) throw new Error("noch nicht"); return "ok"; }, { pauseMs: 1 })).toBe("ok");
    expect(n).toBe(3);
  });
  it("wirft nach dem letzten Versuch den letzten Fehler", async () => {
    const onFehler = vi.fn();
    await expect(mitWiederholung(async v => { throw new Error(`Versuch ${v}`); }, { versuche: 2, pauseMs: 1, onFehler })).rejects.toThrow("Versuch 2");
    expect(onFehler).toHaveBeenCalledTimes(2);
  });
});
