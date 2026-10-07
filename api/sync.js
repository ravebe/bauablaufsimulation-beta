// api/sync.js — Vercel Serverless Function für Cloud-Sync via Upstash Redis
import { zugriffErlaubt } from "./_auth.js";
import { gzipSync } from "node:zlib";

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

async function redis(command) {
  const res = await fetch(`${REDIS_URL}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${REDIS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
  });
  if (!res.ok) throw new Error(`Redis ${res.status}: ${await res.text()}`);
  return (await res.json()).result;
}

// Versionsprüfung + Schreiben in EINEM atomaren Schritt (Lua läuft in Redis ununterbrochen). Vorher
// GET → prüfen → SET in drei Requests: speicherten zwei Personen fast gleichzeitig, bestanden beide die
// Prüfung und die zweite überschrieb die erste stillschweigend.
// KEYS[1] = Daten, KEYS[2] = Version (eigener Schlüssel — so muss Lua die mehrere MB grossen Daten nicht
// lesen). Fehlt der Versions-Schlüssel (Einträge von vor dieser Änderung), wird die Version einmalig aus
// dem gespeicherten JSON gelesen — dort steht "version" immer als LETZTES Feld (tiefer verschachtelte
// "version"-Felder, z.B. ganttImport.version, kommen davor).
// ARGV[1] = baseVersion ("" = ohne Prüfung), ARGV[2] = gz (base64, JSON-sicher), ARGV[3] = jetzt (ms)
// Versionsgeschichte: vor dem Überschreiben wird der bisherige Stand als Schnappschuss abgelegt — höchstens
// alle 10 min (gespeichert wird bei jeder Änderung), die letzten 30, 60 Tage lang. KEYS[3] = Schnappschüsse,
// KEYS[4] = Metadaten dazu (klein, für die Auflistung), KEYS[5] = Zeitpunkt des letzten Schnappschusses.
// Rückgabe: { 1, neueVersion } gespeichert | { 0, aktuelleVersion } Konflikt
export const SPEICHERN_LUA = `
local cur = redis.call('GET', KEYS[2])
if cur then
  cur = tonumber(cur)
else
  cur = 0
  local raw = redis.call('GET', KEYS[1])
  if raw then
    for v in string.gmatch(raw, '"version":(%d+)') do cur = tonumber(v) end
  end
end
if ARGV[1] ~= '' and tonumber(ARGV[1]) ~= cur then
  return { 0, cur }
end
local now = tonumber(ARGV[3])
local letzter = tonumber(redis.call('GET', KEYS[5]) or 0) or 0
if now - letzter >= 600000 then
  local alt = redis.call('GET', KEYS[1])
  if alt then
    redis.call('LPUSH', KEYS[3], alt)
    redis.call('LTRIM', KEYS[3], 0, 29)
    redis.call('LPUSH', KEYS[4], '{"ts":' .. now .. ',"version":' .. cur .. ',"bytes":' .. #alt .. '}')
    redis.call('LTRIM', KEYS[4], 0, 29)
    redis.call('EXPIRE', KEYS[3], 5184000)
    redis.call('EXPIRE', KEYS[4], 5184000)
    redis.call('SET', KEYS[5], tostring(now))
  end
end
local nv = cur + 1
redis.call('SET', KEYS[1], '{"gz":"' .. ARGV[2] .. '","version":' .. nv .. '}')
redis.call('SET', KEYS[2], tostring(nv))
return { 1, nv }
`;

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-TC-Region");
  res.setHeader("Access-Control-Expose-Headers", "X-Sync-Auth");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (!REDIS_URL || !REDIS_TOKEN) {
    return res.status(500).json({ error: "Redis nicht konfiguriert" });
  }

  const projectId = req.query.projectId || req.body?.projectId;
  if (!projectId || typeof projectId !== "string" || projectId.length > 100) {
    return res.status(400).json({ error: "projectId fehlt" });
  }

  if (!(await zugriffErlaubt(req, res, projectId))) return;

  const key = `4dsim:${projectId}`;
  const versionKey = `4dsim-version:${projectId}`;
  const histKey = `4dsim-hist:${projectId}`;
  const histMetaKey = `4dsim-hist-meta:${projectId}`;
  const histZeitKey = `4dsim-hist-ts:${projectId}`;

  try {
    // Gespeichert wird entweder { ...data, version } (alt, unkomprimiert) oder { gz, version } (gzip+base64,
    // seit grosse Projekte das 4.5-MB-Limit von Vercel für Request-Bodies sprengten). Antworten liefern
    // immer komprimiert zurück ({ gz }, alte Einträge werden dafür hier gepackt) — auch Antworten
    // dürfen bei Vercel höchstens 4.5 MB gross sein. Der Client entpackt.
    const antwort = (stored) => ({ gz: stored?.gz ?? gzipSync(JSON.stringify(stored)).toString("base64") });

    // Versionsgeschichte: ?verlauf=liste → Schnappschüsse (neueste zuerst), ?verlauf=<index> → dieser Stand
    if (req.method === "GET" && req.query.verlauf !== undefined) {
      if (req.query.verlauf === "liste") {
        const meta = (await redis(["LRANGE", histMetaKey, "0", "-1"])) || [];
        return res.status(200).json({ eintraege: meta.map((m, index) => ({ index, ...JSON.parse(m) })) });
      }
      const index = Number(req.query.verlauf);
      if (!Number.isInteger(index) || index < 0 || index > 29) return res.status(400).json({ error: "verlauf ungültig" });
      const raw = await redis(["LINDEX", histKey, String(index)]);
      if (!raw) return res.status(404).json({ error: "Stand nicht (mehr) vorhanden" });
      const stored = typeof raw === "string" ? JSON.parse(raw) : raw;
      return res.status(200).json({ ...antwort(stored), version: stored.version ?? 0 });
    }

    if (req.method === "GET") {
      const raw = await redis(["GET", key]);
      if (!raw) return res.status(200).json({ data: null });
      const stored = typeof raw === "string" ? JSON.parse(raw) : raw;
      return res.status(200).json({ ...antwort(stored), version: stored.version ?? 0 });
    }

    if (req.method === "POST") {
      const { data, gz, baseVersion } = req.body;
      if (!data && typeof gz !== "string") return res.status(400).json({ error: "data fehlt" });
      // Unkomprimiert gesendete Daten (alte Clients) hier packen — gespeichert wird immer { gz, version }
      const gzWert = typeof gz === "string" ? gz : gzipSync(JSON.stringify(data)).toString("base64");
      if (!/^[A-Za-z0-9+/=]*$/.test(gzWert)) return res.status(400).json({ error: "gz ungültig" });

      const [ok, version] = await redis(["EVAL", SPEICHERN_LUA, "5", key, versionKey, histKey, histMetaKey, histZeitKey,
        typeof baseVersion === "number" ? String(baseVersion) : "", gzWert, String(Date.now())]);

      if (ok !== 1) {
        // Konflikt: jemand anderes hat seit dem letzten Laden des Clients gespeichert
        const raw = await redis(["GET", key]);
        const stored = raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : null;
        return res.status(409).json({ error: "conflict", ...antwort(stored), version });
      }
      return res.status(200).json({ ok: true, version });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (e) {
    console.error("[sync]", e.message || e);
    return res.status(500).json({ error: e.message || "Server error" });
  }
}
