// api/fehler.js — zentrale Fehlermeldungen aus der Extension (Fehlergrenzen, Speichern/Laden, unbehandelte
// Fehler). Vorher sah Fehler nur, wer die Browser-Konsole öffnete (z.B. der localStorage-Quota-Bug).
//   POST { projectId, bereich, meldung, stack?, build?, benutzer? } → speichert (letzte 500, 30 Tage) + Vercel-Log
//   GET  ?projectId                                                  → letzte Meldungen dieses Projekts
// Gleiche Anmeldung wie /api/sync (api/_auth.js).
import { zugriffErlaubt } from "./_auth.js";

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const MAX = 500;

async function redis(command) {
  const res = await fetch(`${REDIS_URL}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(command),
  });
  if (!res.ok) throw new Error(`Redis ${res.status}: ${await res.text()}`);
  return (await res.json()).result;
}

const kurz = (v, n) => (typeof v === "string" ? v.slice(0, n) : undefined);

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-TC-Region");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (!REDIS_URL || !REDIS_TOKEN) return res.status(500).json({ error: "Redis nicht konfiguriert" });

  const projectId = req.query.projectId || req.body?.projectId;
  if (!projectId || typeof projectId !== "string" || projectId.length > 100) return res.status(400).json({ error: "projectId fehlt" });
  if (!(await zugriffErlaubt(req, res, projectId))) return;

  const key = `4dsim-fehler:${projectId}`;
  try {
    if (req.method === "GET") {
      const liste = (await redis(["LRANGE", key, "0", "99"])) || [];
      return res.status(200).json({ fehler: liste.map(e => JSON.parse(e)) });
    }
    if (req.method === "POST") {
      const b = req.body || {};
      const eintrag = {
        ts: Date.now(),
        bereich: kurz(b.bereich, 100) || "unbekannt",
        meldung: kurz(b.meldung, 1000) || "(ohne Meldung)",
        stack: kurz(b.stack, 4000),
        build: kurz(b.build, 40),
        benutzer: kurz(b.benutzer, 200),
        browser: kurz(req.headers["user-agent"], 200),
      };
      console.error(`[fehler] ${projectId} · ${eintrag.bereich}: ${eintrag.meldung}`);
      await redis(["LPUSH", key, JSON.stringify(eintrag)]);
      await redis(["LTRIM", key, "0", String(MAX - 1)]);
      await redis(["EXPIRE", key, String(30 * 24 * 3600)]);
      return res.status(200).json({ ok: true });
    }
    return res.status(405).json({ error: "Method not allowed" });
  } catch (e) {
    console.error("[fehler]", e.message || e);
    return res.status(500).json({ error: e.message || "Server error" });
  }
}
