// fehlerMelden.ts — schickt Fehler an /api/fehler (siehe api/fehler.js), damit sie auch ankommen, wenn
// niemand die Konsole öffnet. Feuern-und-vergessen: das Melden selbst darf nie einen Fehler auslösen.
// Gedrosselt: gleiche Meldung höchstens 1× pro Minute, höchstens 20 Meldungen je Sitzung.
import type { ApiInstance } from "./useApi";
import { syncHeaders } from "./tcDateien";
import { fetchMitTimeout } from "./mitTimeout";

interface Kontext { api: ApiInstance | null; projectId: string | null; benutzer?: string | null; }
let kontext: Kontext = { api: null, projectId: null };
const zuletzt = new Map<string, number>();
let anzahl = 0;
const MAX_JE_SITZUNG = 20;
const SPERRE_MS = 60000;

export const BUILD = typeof __APP_BUILD__ !== "undefined" ? __APP_BUILD__ : "dev";

/** Wird in App.tsx gesetzt, sobald API/Projekt/Benutzer bekannt sind */
export function fehlerKontextSetzen(k: Kontext) { kontext = k; }

/** Drosselung (exportiert für Tests): true = melden */
export function sollMelden(schluessel: string, jetzt = Date.now()): boolean {
  if (anzahl >= MAX_JE_SITZUNG) return false;
  const vorher = zuletzt.get(schluessel);
  if (vorher !== undefined && jetzt - vorher < SPERRE_MS) return false;
  zuletzt.set(schluessel, jetzt);
  anzahl++;
  return true;
}
export function drosselungZuruecksetzen() { zuletzt.clear(); anzahl = 0; }

export function fehlerMelden(bereich: string, fehler: unknown) {
  try {
    const meldung = fehler instanceof Error ? fehler.message : String(fehler);
    const stack = fehler instanceof Error ? fehler.stack : undefined;
    if (!sollMelden(`${bereich}|${meldung}`)) return;
    const { api, projectId, benutzer } = kontext;
    if (!api || !projectId) return; // ohne Projekt keine Zuordnung (und keine Anmeldung möglich)
    void (async () => {
      try {
        const headers = { "Content-Type": "application/json", ...await syncHeaders(api) };
        await fetchMitTimeout("/api/fehler", {
          method: "POST", headers, keepalive: true,
          body: JSON.stringify({ projectId, bereich, meldung, stack, build: BUILD, benutzer: benutzer ?? undefined }),
        }, 10000, "Fehlermeldung");
      } catch { /* Melden ist optional */ }
    })();
  } catch { /* nie werfen */ }
}

/** Globale Auffangnetze für Fehler ausserhalb von React (Event-Handler, Promises) — einmal in main.tsx */
export function globaleFehlerAbfangen() {
  window.addEventListener("error", e => fehlerMelden("unbehandelt", e.error ?? e.message));
  window.addEventListener("unhandledrejection", e => fehlerMelden("unbehandelt (Promise)", e.reason));
}
