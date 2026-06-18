// api/sync.js — Vercel Serverless Function für Cloud-Sync via Upstash Redis

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

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (!REDIS_URL || !REDIS_TOKEN) {
    return res.status(500).json({ error: "Redis nicht konfiguriert" });
  }

  const projectId = req.query.projectId || req.body?.projectId;
  if (!projectId || typeof projectId !== "string" || projectId.length > 100) {
    return res.status(400).json({ error: "projectId fehlt" });
  }

  const key = `4dsim:${projectId}`;

  try {
    if (req.method === "GET") {
      const raw = await redis(["GET", key]);
      if (!raw) return res.status(200).json({ data: null });
      const data = typeof raw === "string" ? JSON.parse(raw) : raw;
      return res.status(200).json({ data });
    }

    if (req.method === "POST") {
      const { data } = req.body;
      if (!data) return res.status(400).json({ error: "data fehlt" });
      await redis(["SET", key, JSON.stringify(data)]);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (e) {
    console.error("[sync]", e.message || e);
    return res.status(500).json({ error: e.message || "Server error" });
  }
}
