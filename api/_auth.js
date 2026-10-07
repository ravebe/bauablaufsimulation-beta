// api/_auth.js — Prüft, ob der Aufrufer Mitglied des Trimble-Connect-Projekts ist (Datei mit "_" =
// kein eigener Endpunkt bei Vercel). Vorher konnte jeder, der eine Projekt-ID kennt, über /api/sync alle
// Simulationen lesen und überschreiben — die Zugriffskontrolle lief nur im Browser.
// Geprüft wird mit dem Access-Token des Benutzers (Workspace API, wie bei api/tc-datei.js): Trimble
// Connect liefert das Projekt nur an Mitglieder aus. Ergebnis wird je Token+Projekt kurz gecacht.
//
// Modus über Umgebungsvariable SYNC_AUTH (Vercel → Settings → Environment Variables):
//   "pflicht" (Standard)   — ohne gültiges Token/Mitgliedschaft → 401/403 (seit 2026-10-07, nachdem
//                            der Protokoll-Modus im echten TC "ok" gemeldet hat)
//   "protokoll"            — prüfen und im Header X-Sync-Auth melden, aber nichts sperren (Notschalter)
//   "aus"                  — gar nicht prüfen
import { createHash } from "node:crypto";

const HOSTS = {
  northamerica: "https://app.connect.trimble.com",
  europe: "https://app21.connect.trimble.com",
  asia: "https://app31.connect.trimble.com",
  australia: "https://app32.connect.trimble.com",
};
const CACHE_MS = 5 * 60 * 1000;
const cache = new Map(); // sha256(token|projekt) → { ergebnis, bis }

export const authModus = () => {
  const m = String(process.env.SYNC_AUTH || "pflicht").toLowerCase();
  return m === "protokoll" || m === "aus" ? m : "pflicht";
};

/** @returns {"ok" | "fehlt" | "ungueltig" | "kein-mitglied" | "fehler"} */
export async function pruefeProjektZugriff(authHeader, projectId, region, fetchFn = fetch) {
  if (!authHeader || !/^Bearer \S+$/.test(authHeader)) return "fehlt";
  const schluessel = createHash("sha256").update(`${authHeader}|${projectId}`).digest("hex");
  const treffer = cache.get(schluessel);
  if (treffer && treffer.bis > Date.now()) return treffer.ergebnis;

  const r = String(region || "").toLowerCase().replace(/[^a-z]/g, "");
  const regionen = HOSTS[r] ? [r, ...Object.keys(HOSTS).filter(k => k !== r)] : Object.keys(HOSTS);
  let ergebnis = "kein-mitglied";
  for (const reg of regionen) {
    try {
      const res = await fetchFn(`${HOSTS[reg]}/tc/api/2.0/projects/${encodeURIComponent(projectId)}`, {
        headers: { Authorization: authHeader },
      });
      if (res.ok) { ergebnis = "ok"; break; }
      if (res.status === 401) { ergebnis = "ungueltig"; break; } // Token abgelaufen/gefälscht — gilt in allen Regionen
      // 403/404: in dieser Region nicht Mitglied bzw. Projekt liegt in anderer Region → nächste versuchen
    } catch {
      ergebnis = "fehler"; // TC nicht erreichbar — nicht cachen
    }
  }
  if (ergebnis !== "fehler") cache.set(schluessel, { ergebnis, bis: Date.now() + CACHE_MS });
  if (cache.size > 1000) cache.clear();
  return ergebnis;
}

/**
 * Prüft je nach Modus und schreibt das Ergebnis in den Header X-Sync-Auth.
 * @returns true = weiter, false = Antwort (401/403) wurde bereits gesendet
 */
export async function zugriffErlaubt(req, res, projectId) {
  const modus = authModus();
  if (modus === "aus") return true;
  const ergebnis = await pruefeProjektZugriff(req.headers.authorization, projectId, req.headers["x-tc-region"]);
  res.setHeader("X-Sync-Auth", `${ergebnis}; modus=${modus}`);
  if (ergebnis !== "ok") console.warn(`[auth] ${projectId}: ${ergebnis} (modus ${modus})`);
  if (modus !== "pflicht" || ergebnis === "ok") return true;
  // TC selbst nicht erreichbar → nicht aussperren (sonst legt ein TC-Ausfall das Speichern lahm)
  if (ergebnis === "fehler") return true;
  res.status(ergebnis === "kein-mitglied" ? 403 : 401).json({
    error: ergebnis === "kein-mitglied" ? "Kein Zugriff auf dieses Projekt" : "Nicht angemeldet (Trimble-Connect-Token fehlt oder ist abgelaufen)",
  });
  return false;
}
