// VersionsVerlauf.tsx — frühere Stände des Projekts (Schnappschüsse, die der Server beim Speichern
// höchstens alle 10 min anlegt, siehe api/sync.js) ansehen und einzelne Simulationen daraus zurückholen.
// Bewusst je Simulation statt "ganzes Projekt zurücksetzen": so überschreibt niemand die Arbeit anderer.
import { useEffect, useState } from "react";
import type { SimProjekt } from "../types";
import type { ApiInstance, VerlaufEintrag } from "../hooks/useApi";
import { cloudVerlaufListe, cloudVerlaufLaden } from "../hooks/useApi";

interface Props {
  api: ApiInstance | null;
  sims: SimProjekt[];
  darfBearbeiten: (sim: SimProjekt) => boolean;
  /** nur diese Simulation zeigen (aus dem ⋮ der Simulationskarte) — null = alle */
  nurSimId?: string | null;
  onWiederherstellen: (frueher: SimProjekt, modus: "kopie" | "ersetzen", standZeit: number) => void;
  onClose: () => void;
}

const zeit = (ts: number) => new Date(ts).toLocaleString("de-CH", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
const groesse = (b: number) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

export default function VersionsVerlauf({ api, sims, darfBearbeiten, nurSimId = null, onWiederherstellen, onClose }: Props) {
  const [eintraege, setEintraege] = useState<VerlaufEintrag[] | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [gewaehlt, setGewaehlt] = useState<VerlaufEintrag | null>(null);
  const [stand, setStand] = useState<SimProjekt[] | null>(null);
  const [laedt, setLaedt] = useState(false);
  const [erledigt, setErledigt] = useState<string | null>(null);
  const [alleZeigen, setAlleZeigen] = useState(!nurSimId);
  const filterSimId = alleZeigen ? null : nurSimId;
  const filterName = filterSimId ? sims.find(s => s.id === filterSimId)?.name : null;

  useEffect(() => {
    if (!api) return;
    cloudVerlaufListe(api).then(setEintraege).catch(e => setFehler(e instanceof Error ? e.message : String(e)));
  }, [api]);

  async function waehle(e: VerlaufEintrag) {
    if (!api) return;
    setGewaehlt(e); setStand(null); setFehler(null); setErledigt(null); setLaedt(true);
    try {
      const data = await cloudVerlaufLaden(api, e.index);
      setStand(Array.isArray(data.sims) ? data.sims as SimProjekt[] : []);
    } catch (err) { setFehler(err instanceof Error ? err.message : String(err)); }
    finally { setLaedt(false); }
  }

  function zurueckholen(frueher: SimProjekt, modus: "kopie" | "ersetzen") {
    if (!gewaehlt) return;
    if (modus === "ersetzen" && !confirm(`"${frueher.name}" durch den Stand vom ${zeit(gewaehlt.ts)} ersetzen?\n\nÄnderungen seither gehen in dieser Simulation verloren (sie bleiben aber hier im Verlauf).`)) return;
    onWiederherstellen(frueher, modus, gewaehlt.ts);
    setErledigt(modus === "kopie" ? `"${frueher.name}" als Kopie wiederhergestellt` : `"${frueher.name}" auf den Stand vom ${zeit(gewaehlt.ts)} zurückgesetzt`);
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={onClose}>
      <div style={{ background: "#fff", width: 480, maxWidth: "94vw", maxHeight: "86vh", display: "flex", flexDirection: "column", boxShadow: "0 8px 30px rgba(0,0,0,.25)", fontFamily: "var(--tc-font)" }}
        onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px", borderBottom: "1px solid var(--tc-border-light)" }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: "var(--tc-text)" }}>Frühere Versionen{filterName ? ` — ${filterName}` : ""}</div>
          <button className="tc-btn-ghost" style={{ fontSize: 14, padding: "2px 8px" }} onClick={onClose}>✕</button>
        </div>
        <div style={{ padding: "12px 18px", overflowY: "auto", fontSize: 12 }}>
          <div style={{ fontSize: 11, color: "var(--tc-text-2)", marginBottom: 10, lineHeight: 1.5 }}>
            Beim Speichern wird höchstens alle 10 Minuten ein Stand aufbewahrt (die letzten 30, je 60 Tage).
            Einzelne Simulationen lassen sich daraus als Kopie zurückholen oder zurücksetzen.
          </div>
          {filterSimId && (
            <div style={{ fontSize: 11, marginBottom: 10 }}>
              <span style={{ color: "var(--tc-blue)", cursor: "pointer", textDecoration: "underline" }} onClick={() => setAlleZeigen(true)}>
                Alle Simulationen anzeigen</span>
              <span style={{ color: "var(--tc-text-3)" }}> (z.B. um eine gelöschte zurückzuholen)</span>
            </div>
          )}
          {fehler && <div className="alert err" style={{ marginBottom: 8 }}>{fehler}</div>}
          {erledigt && <div className="alert ok" style={{ marginBottom: 8 }}>✓ {erledigt}</div>}
          {!eintraege && !fehler && <div style={{ color: "var(--tc-text-3)" }}>⟳ Lade Versionen …</div>}
          {eintraege?.length === 0 && <div style={{ color: "var(--tc-text-3)" }}>Noch keine früheren Versionen — sie entstehen ab jetzt beim Speichern.</div>}
          {eintraege?.map(e => (
            <div key={e.index}>
              <div onClick={() => waehle(e)}
                style={{ display: "flex", justifyContent: "space-between", padding: "6px 8px", cursor: "pointer", borderBottom: "1px solid var(--tc-border-light)",
                  background: gewaehlt?.index === e.index ? "#e3f0fb" : undefined }}>
                <span>Stand bis {zeit(e.ts)}</span>
                <span style={{ color: "var(--tc-text-3)", fontSize: 10 }}>Version {e.version} · {groesse(e.bytes)}</span>
              </div>
              {gewaehlt?.index === e.index && (
                <div style={{ padding: "6px 8px 10px 16px", background: "#f7fafc" }}>
                  {laedt && <div style={{ color: "var(--tc-text-3)" }}>⟳ Lade Stand …</div>}
                  {stand?.length === 0 && <div style={{ color: "var(--tc-text-3)" }}>Keine Simulationen in diesem Stand.</div>}
                  {stand && stand.length > 0 && filterSimId && !stand.some(s => s.id === filterSimId) && (
                    <div style={{ color: "var(--tc-text-3)" }}>Diese Simulation gab es in diesem Stand noch nicht.</div>
                  )}
                  {stand?.filter(s => !filterSimId || s.id === filterSimId).map(s => {
                    const heute = sims.find(x => x.id === s.id);
                    const ersetzenErlaubt = heute ? darfBearbeiten(heute) : true;
                    return (
                      <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 0" }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</div>
                          <div style={{ fontSize: 10, color: "var(--tc-text-3)" }}>
                            {s.tasks.length} Tasks{heute ? ` (heute ${heute.tasks.length})` : " · heute gelöscht"}
                          </div>
                        </div>
                        <button className="tc-btn-secondary" style={{ height: 22, fontSize: 10 }} onClick={() => zurueckholen(s, "kopie")}>Als Kopie</button>
                        <button className="tc-btn-secondary" style={{ height: 22, fontSize: 10 }} disabled={!ersetzenErlaubt}
                          title={ersetzenErlaubt ? undefined : "Nur mit Bearbeitungsrecht auf diese Simulation"}
                          onClick={() => zurueckholen(s, "ersetzen")}>{heute ? "Ersetzen" : "Wiederherstellen"}</button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
