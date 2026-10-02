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

async function holeAccessToken(api: ApiInstance): Promise<string> {
  const res = await api.extension.requestPermission("accesstoken");
  if (res && res !== "pending" && res !== "denied") return res;
  if (res === "denied") throw new Error("Zugriff auf Trimble Connect wurde verweigert.");
  if (letzterToken) return letzterToken;
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Keine Freigabe für den Datei-Zugriff erhalten.")), 60000);
    tokenWartende.push(t => { clearTimeout(timer); resolve(t); });
  });
}

// TC-Regionen — die Projekt-Region (falls die API sie liefert) zuerst, die übrigen als Fallback
const REGION_HOSTS: Record<string, string> = {
  northamerica: "https://app.connect.trimble.com",
  europe: "https://app21.connect.trimble.com",
  asia: "https://app31.connect.trimble.com",
  australia: "https://app32.connect.trimble.com",
};

async function hostReihenfolge(api: ApiInstance): Promise<string[]> {
  const alle = Object.values(REGION_HOSTS);
  try {
    const proj = await api.project.getProject() as { location?: string };
    const host = REGION_HOSTS[String(proj?.location ?? "").toLowerCase().replace(/[^a-z]/g, "")];
    if (host) return [host, ...alle.filter(h => h !== host)];
  } catch { /* Region unbekannt */ }
  return alle;
}

/** Lädt die Datei `fileId` (in der gepinnten `versionId`, sonst die aktuelle) als Bytes. */
export async function ladeTcDatei(api: ApiInstance, fileId: string, versionId?: string): Promise<Uint8Array<ArrayBuffer>> {
  const token = await holeAccessToken(api);
  const headers = { Authorization: `Bearer ${token}` };
  const query = versionId ? `?versionId=${encodeURIComponent(versionId)}` : "";
  let letzterFehler = "";
  for (const host of await hostReihenfolge(api)) {
    for (const pfad of [`/tc/api/2.0/files/fs/${fileId}/downloadurl`, `/tc/api/2.0/files/${fileId}/downloadurl`]) {
      try {
        const res = await fetch(`${host}${pfad}${query}`, { headers });
        if (!res.ok) { letzterFehler = `HTTP ${res.status}`; continue; }
        const { url } = await res.json() as { url?: string };
        if (!url) { letzterFehler = "keine Download-URL"; continue; }
        const datei = await fetch(url);
        if (!datei.ok) { letzterFehler = `Download HTTP ${datei.status}`; continue; }
        return new Uint8Array(await datei.arrayBuffer());
      } catch (e) {
        letzterFehler = e instanceof Error ? e.message : String(e);
      }
    }
  }
  throw new Error(`Datei konnte nicht aus Trimble Connect geladen werden (${letzterFehler}).`);
}
