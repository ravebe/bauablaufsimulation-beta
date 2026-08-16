// api/presence.js — leichte "wer bearbeitet gerade mit"-Anzeige via Upstash Redis
// Kurzlebige Eintraege (TTL), ein POST pro Heartbeat liefert gleich die aktuelle Liste zurueck

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const TTL_MS = 45000; // Eintraege aelter als 45s gelten als nicht mehr da

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

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (!REDIS_URL || !REDIS_TOKEN) {
    return res.status(500).json({ error: "Redis nicht konfiguriert" });
  }
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { projectId, simId, userId, name } = req.body || {};
  if (!projectId || !simId || !userId || typeof projectId !== "string" || projectId.length > 100) {
    return res.status(400).json({ error: "Felder fehlen" });
  }

  const key = `4dsim-presence:${projectId}`;

  try {
    const raw = await redis(["GET", key]);
    const map = raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : {};
    const now = Date.now();
    for (const uid of Object.keys(map)) {
      if (now - (map[uid]?.ts || 0) > TTL_MS) delete map[uid];
    }
    map[userId] = { name: String(name || "Kollege").slice(0, 80), simId: String(simId), ts: now };
    await redis(["SET", key, JSON.stringify(map), "EX", "90"]);
    return res.status(200).json({ presence: map });
  } catch (e) {
    console.error("[presence]", e.message || e);
    return res.status(500).json({ error: e.message || "Server error" });
  }
}
