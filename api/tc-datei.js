// api/tc-datei.js — Proxy für Datei-Operationen in Trimble Connect (IFC-4D-Export / -Übernahme).
// Der Browser darf die TC-REST-API wegen CORS nicht direkt aufrufen ("Failed to fetch") —
// Server-zu-Server gilt das nicht. Das Access-Token des Benutzers (aus der Workspace API) wird nur
// durchgereicht, nicht gespeichert. Bewusst nur diese festen Operationen, kein allgemeiner Proxy.
//   GET  ?fileId&versionId&location&mode=info   → { region, file }  (Name, parentId, versionId, status …)
//   GET  ?fileId&location&mode=versions          → { region, versions }  (alle Versionen der Datei)
//   GET  ?fileId&versionId&location              → { region, url }   (Download-URL)
//   GET  ?fileId&versionId&location&mode=datei   → Datei-Bytes (gestreamt)
//   GET  ?fileId&versionId&location&mode=ende&bytes=N → nur die letzten N Bytes (Bauablauf-Erkennung)
//   GET  ?projectId&location&mode=explorer       → { region, rootId, eintraege, unvollstaendig }  (Ordnerbaum
//        des Projekts, nur Ordner mit Modellen darin — für die Modellauswahl im Tab Projekt)
//   POST ?aktion=initiate  { region, parentId, name } → { uploadURL, uploadId }  (Upload = neue Version
//        bei gleichem Namen im gleichen Ordner, Ablauf wie im offiziellen trimble-connect-sdk)
//   POST ?aktion=commit    { region, uploadId }        → FileEntry der neuen Version
import { Readable } from "node:stream";

const HOSTS = {
  northamerica: "https://app.connect.trimble.com",
  europe: "https://app21.connect.trimble.com",
  asia: "https://app31.connect.trimble.com",
  australia: "https://app32.connect.trimble.com",
};
const ID = /^[A-Za-z0-9_-]{1,100}$/;
export const config = { maxDuration: 60 }; // grosse IFC-Dateien brauchen beim Streamen länger als der Default

const regionKey = (s) => String(s || "").toLowerCase().replace(/[^a-z]/g, "");
function hostsFuer(location) {
  const r = regionKey(location);
  const alle = Object.keys(HOSTS);
  return HOSTS[r] ? [r, ...alle.filter(k => k !== r)] : alle;
}

/** Ruft `pfad` auf der ersten Region auf, die erfolgreich antwortet. */
async function tcAufruf(regionen, pfad, auth, init = {}) {
  const fehler = [];
  for (const region of regionen) {
    try {
      const r = await fetch(`${HOSTS[region]}/tc/api/2.0/${pfad}`, {
        ...init, headers: { Authorization: auth, ...(init.body ? { "Content-Type": "application/json" } : {}) },
      });
      if (r.ok) return { region, json: await r.json() };
      fehler.push(`${region}: HTTP ${r.status}`);
    } catch (e) {
      fehler.push(`${region}: ${e?.message || e}`);
    }
  }
  throw new Error(fehler.join("; "));
}

// Dateien, die der TC-Viewer als Modell laden kann
const MODELL_ENDUNG = /\.(ifc|ifczip|ifcxml|trb|dwg|dxf|dgn|skp|rvt|nwd|nwc|step|stp|igs|iges|obj|fbx|3ds|dae|stl|ply|glb|gltf|las|laz|e57|tekla)$/i;
const MAX_ORDNER = 3000, PARALLEL = 8;

/** Durchsucht den ganzen Explorer ab dem Stammordner (Ebene für Ebene, je PARALLEL Abfragen gleichzeitig,
 *  max. MAX_ORDNER Ordner) und gibt nur die Ordner zurück, in denen (auch weiter unten) Modelle liegen,
 *  plus diese Modelle. */
async function explorerBaum(regionen, projectId, auth) {
  const { region, json: projekt } = await tcAufruf(regionen, `projects/${projectId}`, auth);
  const rootId = projekt?.rootId;
  if (!rootId) throw new Error("Stammordner des Projekts unbekannt");
  const ordner = new Map(); // id → { id, name, parentId }
  const modelle = [];
  let ebene = [rootId], gelesen = 0, unvollstaendig = false;
  while (ebene.length > 0) {
    const naechste = [];
    for (let i = 0; i < ebene.length; i += PARALLEL) {
      const teil = ebene.slice(i, i + PARALLEL);
      const antworten = await Promise.allSettled(teil.map(id => tcAufruf([region], `folders/${id}/items`, auth)));
      antworten.forEach((a, j) => {
        if (a.status !== "fulfilled") { unvollstaendig = true; return; }
        const json = a.value.json;
        const items = Array.isArray(json) ? json : (json?.items ?? json?.data ?? []);
        for (const it of items) {
          if (!it?.id || !it?.name) continue;
          if (String(it.type).toUpperCase() === "FOLDER") {
            ordner.set(it.id, { id: it.id, name: it.name, parentId: teil[j] });
            naechste.push(it.id);
          } else if (MODELL_ENDUNG.test(it.name)) {
            modelle.push({ id: it.id, name: it.name, parentId: teil[j], versionId: it.versionId });
          }
        }
      });
      gelesen += teil.length;
      if (gelesen >= MAX_ORDNER) { unvollstaendig = true; naechste.length = 0; break; }
    }
    ebene = naechste;
  }
  // nur Ordner behalten, die (direkt oder weiter unten) Modelle enthalten
  const behalten = new Set();
  for (const m of modelle) {
    for (let id = m.parentId; id && id !== rootId && !behalten.has(id); id = ordner.get(id)?.parentId) behalten.add(id);
  }
  const eintraege = [
    ...[...ordner.values()].filter(o => behalten.has(o.id)).map(o => ({ ...o, typ: "ordner" })),
    ...modelle.map(m => ({ ...m, typ: "modell" })),
  ];
  return { region, rootId, eintraege, unvollstaendig };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const auth = req.headers.authorization;
  if (!auth || !/^Bearer \S+$/.test(auth)) return res.status(401).json({ error: "Access-Token fehlt" });

  try {
    if (req.method === "POST") {
      const { aktion } = req.query || {};
      const body = req.body || {};
      if (!HOSTS[regionKey(body.region)]) return res.status(400).json({ error: "Region fehlt" });
      const regionen = [regionKey(body.region)];
      if (aktion === "initiate") {
        if (!ID.test(String(body.parentId || "")) || typeof body.name !== "string" || !body.name || body.name.length > 255) {
          return res.status(400).json({ error: "parentId/name ungültig" });
        }
        const { json } = await tcAufruf(regionen, "files/fs/initiate", auth,
          { method: "POST", body: JSON.stringify({ parentId: body.parentId, parentType: "FOLDER", name: body.name }) });
        return res.status(200).json({ uploadURL: json.uploadURL, uploadId: json.uploadId });
      }
      if (aktion === "commit") {
        if (typeof body.uploadId !== "string" || !body.uploadId || body.uploadId.length > 500) return res.status(400).json({ error: "uploadId ungültig" });
        const { json } = await tcAufruf(regionen, "files/fs/commit", auth, { method: "POST", body: JSON.stringify({ uploadId: body.uploadId }) });
        return res.status(200).json(json);
      }
      return res.status(400).json({ error: "Unbekannte Aktion" });
    }
    if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

    const { fileId, versionId, location, mode } = req.query || {};
    if (mode === "explorer") {
      const projectId = String(req.query.projectId || "");
      if (!ID.test(projectId)) return res.status(400).json({ error: "Ungültige projectId" });
      return res.status(200).json(await explorerBaum(hostsFuer(location), projectId, auth));
    }
    if (!ID.test(String(fileId || "")) || (versionId && !ID.test(String(versionId)))) {
      return res.status(400).json({ error: "Ungültige fileId/versionId" });
    }
    const query = versionId ? `?versionId=${encodeURIComponent(versionId)}` : "";
    const regionen = hostsFuer(location);

    if (mode === "versions") {
      const { region, json } = await tcAufruf(regionen, `files/${fileId}/versions`, auth);
      return res.status(200).json({ region, versions: Array.isArray(json) ? json : (json?.items ?? json?.data ?? []) });
    }
    if (mode === "info") {
      const { region, json } = await tcAufruf(regionen, `files/${fileId}${query}`, auth);
      return res.status(200).json({ region, file: json });
    }

    const { region, json } = await tcAufruf(regionen, `files/fs/${fileId}/downloadurl${query}`, auth);
    if (!json?.url) return res.status(502).json({ error: "Keine Download-URL erhalten" });
    if (mode === "ende") {
      // Nur das Dateiende (angehängte 4D-Daten liegen dort) — per Range-Request, sonst Stream mitlesen
      const n = Math.min(Math.max(Number(req.query.bytes) || 1000000, 1000), 4000000);
      const r = await fetch(json.url, { headers: { Range: `bytes=-${n}` } });
      if (!r.ok || !r.body) return res.status(502).json({ error: `Datei-Download HTTP ${r.status}` });
      let ende;
      if (r.status === 206) {
        ende = Buffer.from(await r.arrayBuffer());
      } else {
        const teile = []; let laenge = 0;
        for await (const chunk of r.body) {
          teile.push(Buffer.from(chunk)); laenge += chunk.length;
          while (teile.length > 1 && laenge - teile[0].length >= n) laenge -= teile.shift().length;
        }
        ende = Buffer.concat(teile);
        ende = ende.subarray(Math.max(0, ende.length - n));
      }
      res.setHeader("Content-Type", "application/octet-stream");
      return res.status(200).send(ende);
    }
    if (mode !== "datei") return res.status(200).json({ region, url: json.url });

    const datei = await fetch(json.url);
    if (!datei.ok || !datei.body) return res.status(502).json({ error: `Datei-Download HTTP ${datei.status}` });
    res.setHeader("Content-Type", "application/octet-stream");
    const laenge = datei.headers.get("content-length");
    if (laenge) res.setHeader("Content-Length", laenge);
    res.status(200);
    Readable.fromWeb(datei.body).pipe(res);
  } catch (e) {
    return res.status(502).json({ error: `Trimble Connect: ${e?.message || e}` });
  }
}
