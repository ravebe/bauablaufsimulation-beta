// tcDateien.ts — lädt eine Datei (z.B. die Original-IFC eines Modells) über die Trimble-Connect-REST-API.
// Das Access-Token kommt über die Workspace API: requestPermission("accesstoken") liefert es direkt oder
// "pending" — dann kommt es nach Zustimmung des Benutzers als Event "extension.accessToken", das
// useApi.ts über tcEventHandler hierher weiterreicht.
import type { ApiInstance } from "./useApi";

let letzterToken: string | null = null;
let tokenWartende: ((t: string) => void)[] = [];

export function tcEventHandler(event: string, args: unknown) {
  if (event !== "extension.accessToken") return;
  const data = (args as { data?: unknown })?.data ?? args;
  if (typeof data !== "string" || !data) return;
  letzterToken = data;
  tokenWartende.forEach(r => r(data));
  tokenWartende = [];
}

const pause = (ms: number) => new Promise(r => setTimeout(r, ms));

async function holeAccessToken(api: ApiInstance): Promise<string> {
  // Während der Viewer ein grosses Modell lädt, beantwortet die Workspace API Anfragen oft nicht rechtzeitig
  // ("dispatcher.ts | sendRequest(): Operation timed out.") — dann das zuletzt erhaltene Token nehmen
  // bzw. erneut versuchen.
  let res: string | undefined;
  for (let versuch = 1; ; versuch++) {
    try { res = await api.extension.requestPermission("accesstoken") as string; break; }
    catch (e) {
      if (letzterToken) return letzterToken;
      if (versuch >= 4) throw new Error(`Kein Zugriffs-Token von Trimble Connect erhalten (${e instanceof Error ? e.message : String(e)}). Bitte warten, bis das Modell geladen ist, und erneut versuchen.`);
      await pause(3000);
    }
  }
  if (res && res !== "pending" && res !== "denied") { letzterToken = res; return res; }
  if (res === "denied") throw new Error("Zugriff auf Trimble Connect wurde verweigert.");
  if (letzterToken) return letzterToken;
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Keine Freigabe für den Datei-Zugriff erhalten.")), 60000);
    tokenWartende.push(t => { clearTimeout(timer); resolve(t); });
  });
}

// Download läuft über den eigenen Proxy (api/tc-datei.js): der Browser darf die TC-REST-API bzw. den
// Datei-Speicher wegen CORS nicht direkt aufrufen ("Failed to fetch").
let letzteRegion = "";
async function projektRegion(api: ApiInstance): Promise<string> {
  try {
    const proj = await api.project.getProject() as { location?: string };
    if (proj?.location) letzteRegion = String(proj.location);
    return String(proj?.location ?? letzteRegion);
  } catch { return letzteRegion; }
}

async function fehlerText(res: Response): Promise<string> {
  const json = await res.json().catch(() => null) as { error?: string } | null;
  return json?.error ?? `HTTP ${res.status}`;
}

/** Lädt die Datei `fileId` (in der gepinnten `versionId`, sonst die aktuelle) als Bytes. */
export async function ladeTcDatei(api: ApiInstance, fileId: string, versionId?: string): Promise<Uint8Array<ArrayBuffer>> {
  const token = await holeAccessToken(api);
  const headers = { Authorization: `Bearer ${token}` };
  const params = new URLSearchParams({ fileId, location: await projektRegion(api) });
  if (versionId) params.set("versionId", versionId);

  // 1. Download-URL über den Proxy
  const urlRes = await fetch(`/api/tc-datei?${params}`, { headers });
  if (!urlRes.ok) throw new Error(`Datei konnte nicht aus Trimble Connect geladen werden: ${await fehlerText(urlRes)}`);
  const { url } = await urlRes.json() as { url?: string };

  // 2. Datei direkt vom Speicher (schnell, kein Grössenlimit) — bei CORS-Sperre über den Proxy
  if (url) {
    try {
      const direkt = await fetch(url);
      if (direkt.ok) return new Uint8Array(await direkt.arrayBuffer());
    } catch { /* CORS — weiter über Proxy */ }
  }
  params.set("mode", "datei");
  const dateiRes = await fetch(`/api/tc-datei?${params}`, { headers });
  if (!dateiRes.ok) throw new Error(`Datei-Download fehlgeschlagen: ${await fehlerText(dateiRes)}`);
  return new Uint8Array(await dateiRes.arrayBuffer());
}

/** Nur die letzten `bytes` Bytes einer Datei als Text (1 Zeichen = 1 Byte) — für die schnelle Prüfung,
 *  ob eine IFC einen Bauablauf enthält, ohne die ganze (evtl. 100 MB grosse) Datei zu laden. */
export async function ladeTcDateiEnde(api: ApiInstance, fileId: string, versionId?: string, bytes = 1000000): Promise<string> {
  const token = await holeAccessToken(api);
  const params = new URLSearchParams({ fileId, location: await projektRegion(api), mode: "ende", bytes: String(bytes) });
  if (versionId) params.set("versionId", versionId);
  const res = await fetch(`/api/tc-datei?${params}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Dateiende nicht erhalten: ${await fehlerText(res)}`);
  return new TextDecoder("windows-1252").decode(await res.arrayBuffer());
}

export interface TcDateiInfo {
  region: string; // Region-Key des Proxys (für Upload/Commit auf derselben Region)
  id: string;
  name: string;
  parentId?: string;
  versionId?: string;
  status?: string; // PENDING | PROCESSING | DONE | ERROR | …
}

/** Metadaten einer Datei (ohne versionId: aktuellste Version). */
export async function tcDateiInfo(api: ApiInstance, fileId: string, versionId?: string): Promise<TcDateiInfo> {
  const token = await holeAccessToken(api);
  const params = new URLSearchParams({ fileId, location: await projektRegion(api), mode: "info" });
  if (versionId) params.set("versionId", versionId);
  const res = await fetch(`/api/tc-datei?${params}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Datei-Infos nicht erhalten: ${await fehlerText(res)}`);
  const { region, file } = await res.json() as { region: string; file: Omit<TcDateiInfo, "region"> };
  return { region, ...file };
}

export interface TcVersion {
  versionId: string;
  revision?: number;
  createdOn?: string;
  modifiedOn?: string;
  createdBy?: { firstName?: string; lastName?: string };
  modifiedBy?: { firstName?: string; lastName?: string };
}

/** Alle Versionen einer Datei, neueste zuerst */
export async function tcDateiVersionen(api: ApiInstance, fileId: string): Promise<TcVersion[]> {
  const token = await holeAccessToken(api);
  const params = new URLSearchParams({ fileId, location: await projektRegion(api), mode: "versions" });
  const res = await fetch(`/api/tc-datei?${params}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Versionen nicht erhalten: ${await fehlerText(res)}`);
  const { versions } = await res.json() as { versions: TcVersion[] };
  return versions.filter(v => v?.versionId).sort((a, b) =>
    (b.revision ?? 0) - (a.revision ?? 0) || String(b.createdOn ?? b.modifiedOn ?? "").localeCompare(String(a.createdOn ?? a.modifiedOn ?? "")));
}

/** Lädt `inhalt` als neue Version hoch (gleicher Name im gleichen Ordner wie `ziel`) — Ablauf wie
 *  trimble-connect-sdk: initiate → PUT an die vorsignierte URL → commit. Der PUT geht direkt an den
 *  Speicher (über Vercel ginge nur bis 4.5 MB). */
export async function ladeTcVersionHoch(api: ApiInstance, ziel: TcDateiInfo, inhalt: Blob): Promise<TcDateiInfo> {
  if (!ziel.parentId) throw new Error("Ordner der Datei unbekannt — Upload nicht möglich.");
  const token = await holeAccessToken(api);
  const post = (aktion: string, body: object) => fetch(`/api/tc-datei?aktion=${aktion}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ region: ziel.region, ...body }),
  });

  const init = await post("initiate", { parentId: ziel.parentId, name: ziel.name });
  if (!init.ok) throw new Error(`Upload konnte nicht gestartet werden: ${await fehlerText(init)}`);
  const { uploadURL, uploadId } = await init.json() as { uploadURL?: string; uploadId?: string };
  if (!uploadURL || !uploadId) throw new Error("Upload konnte nicht gestartet werden (keine Upload-URL).");

  let put: Response;
  try {
    put = await fetch(uploadURL, { method: "PUT", body: inhalt });
  } catch (e) {
    throw new Error(`Hochladen der Datei blockiert (${e instanceof Error ? e.message : e}).`, { cause: e });
  }
  if (!put.ok) throw new Error(`Hochladen der Datei fehlgeschlagen (HTTP ${put.status}).`);

  const commit = await post("commit", { uploadId });
  if (!commit.ok) throw new Error(`Upload konnte nicht abgeschlossen werden: ${await fehlerText(commit)}`);
  const datei = await commit.json() as Omit<TcDateiInfo, "region">;
  return { region: ziel.region, ...datei };
}

/** Wartet, bis Trimble Connect die Version verarbeitet hat (Viewer kann sie erst dann laden). */
export async function warteAufVerarbeitung(api: ApiInstance, fileId: string, versionId: string,
  onStatus: (s: string) => void, maxMinuten = 20): Promise<void> {
  const ende = Date.now() + maxMinuten * 60000;
  while (Date.now() < ende) {
    const info = await tcDateiInfo(api, fileId, versionId).catch(() => null);
    const status = String(info?.status ?? "").toUpperCase();
    if (status === "DONE" || (info && !status)) return; // ohne Status-Feld: Laden im Viewer wird ohnehin wiederholt
    if (status === "ERROR" || status === "CANCELLED") throw new Error(`Trimble Connect konnte die Datei nicht verarbeiten (Status ${status}).`);
    onStatus(status || "unbekannt");
    await new Promise(r => setTimeout(r, 10000));
  }
  throw new Error(`Verarbeitung dauert länger als ${maxMinuten} Minuten.`);
}
