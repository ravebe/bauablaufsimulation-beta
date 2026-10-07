// ModellVersionen.tsx — Versions-Badge je Modell in Tab Projekte (z.B. "v2 ▾"). Klick öffnet die Liste
// aller Versionen der Datei in Trimble Connect; Klick auf eine Version stellt die Simulation darauf um
// (inkl. Übertragung der Bauteil-Zuordnungen, siehe modellVersionHelpers.ts). "Zuordnungen reparieren"
// ist für den Fall, dass früher ohne Übertragung gewechselt wurde: dort wählt man die Version, in der
// die Bauteile ursprünglich zugeordnet wurden.
import { useEffect, useState } from "react";
import type { SimModell } from "../types";
import type { ApiInstance } from "../hooks/useApi";
import { tcDateiVersionen } from "../hooks/tcDateien";
import type { TcVersion } from "../hooks/tcDateien";
import { useClickOutside } from "../hooks/useClickOutside";

interface Props {
  api: ApiInstance | null;
  modell: SimModell;
  darfBearbeiten: boolean;
  beschaeftigt: boolean;
  onWechseln: (zielVersionId: string) => void;
  onReparieren: (quelleVersionId: string) => void;
}

// Versionslisten kurz cachen — die Karte rendert oft neu, die Liste ändert sich selten
const cache = new Map<string, { zeit: number; versionen: TcVersion[] }>();

const nameVon = (u?: { firstName?: string; lastName?: string }) => [u?.firstName, u?.lastName].filter(Boolean).join(" ");
const datum = (iso?: string) => {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleString("de-CH", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
};

export default function ModellVersionen({ api, modell, darfBearbeiten, beschaeftigt, onWechseln, onReparieren }: Props) {
  const [versionen, setVersionen] = useState<TcVersion[] | null>(cache.get(modell.id)?.versionen ?? null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [offen, setOffen] = useState(false);
  const [reparatur, setReparatur] = useState(false);
  const ref = useClickOutside<HTMLDivElement>(offen, () => { setOffen(false); setReparatur(false); });

  async function laden() {
    if (!api) return;
    const c = cache.get(modell.id);
    if (c && Date.now() - c.zeit < 60000) { setVersionen(c.versionen); return; }
    try {
      const v = await tcDateiVersionen(api, modell.id);
      cache.set(modell.id, { zeit: Date.now(), versionen: v });
      setVersionen(v); setFehler(null);
    } catch (e) {
      setFehler(e instanceof Error ? e.message : String(e));
    }
  }

  // Beim Anzeigen + nach jedem Versionswechsel neu laden (neue Version könnte hochgeladen worden sein)
  useEffect(() => {
    if (!api) return;
    let abgebrochen = false;
    tcDateiVersionen(api, modell.id)
      .then(v => { cache.set(modell.id, { zeit: Date.now(), versionen: v }); if (!abgebrochen) { setVersionen(v); setFehler(null); } })
      .catch(e => { if (!abgebrochen) setFehler(e instanceof Error ? e.message : String(e)); });
    return () => { abgebrochen = true; };
  }, [api, modell.id, modell.versionId]);

  const anzahl = versionen?.length ?? 0;
  const nummer = (v: TcVersion, i: number) => v.revision ?? anzahl - i;
  const aktivIdx = versionen?.findIndex(v => v.versionId === modell.versionId) ?? -1;
  const aktiv = versionen && aktivIdx >= 0 ? versionen[aktivIdx] : null;
  const badge = aktiv ? `v${nummer(aktiv, aktivIdx)}` : modell.versionId ? "Version" : "neueste";
  const istNeueste = aktivIdx === 0 || !modell.versionId;

  return (
    <div ref={ref} style={{ position: "relative", flexShrink: 0 }} onClick={e => e.stopPropagation()}>
      <button className="tc-btn-secondary"
        style={{ fontSize: 10, padding: "2px 8px", fontWeight: 600, color: istNeueste ? "#2d7dbd" : "#b8860b", borderColor: istNeueste ? "#b9d3ea" : "#e8c66b" }}
        title={fehler ? `Versionen nicht geladen: ${fehler}` : istNeueste ? "Aktive Version (neueste) — klicken für alle Versionen" : "Aktive Version ist nicht die neueste — klicken für alle Versionen"}
        disabled={beschaeftigt}
        onClick={() => { setOffen(o => !o); setReparatur(false); if (!offen) laden(); }}>
        {badge}{anzahl > 0 && !istNeueste ? ` / v${nummer(versionen![0], 0)}` : ""} ▾
      </button>

      {offen && (
        <div style={{
          position: "absolute", right: 0, top: "100%", marginTop: 4, background: "#fff", minWidth: 260, maxHeight: 300, overflowY: "auto",
          border: "0.5px solid var(--tc-border)", borderRadius: 5, boxShadow: "0 2px 8px rgba(0,0,0,.12)", zIndex: 100,
        }}>
          <div style={{ padding: "6px 10px", fontSize: 9, fontWeight: 600, color: "var(--tc-text-3)", letterSpacing: ".5px", borderBottom: "0.5px solid #eef1f4" }}>
            {reparatur ? "IN WELCHER VERSION WURDEN DIE BAUTEILE ZUGEORDNET?" : "VERSIONEN IN TRIMBLE CONNECT"}
          </div>
          {reparatur && (
            <div style={{ padding: "6px 10px", fontSize: 10, color: "var(--tc-text-2)", lineHeight: 1.4, borderBottom: "0.5px solid #eef1f4" }}>
              Nach einem Versionswechsel ohne Übertragung zeigen die Zuordnungen auf falsche Bauteile. Wähle die Version,
              in der die Tasks ihre Bauteile erhalten haben — sie werden dann in der aktiven Version ({badge}) wiedergefunden.
            </div>
          )}
          {!versionen && !fehler && <div style={{ padding: "8px 10px", fontSize: 10, color: "var(--tc-text-3)" }}>⟳ Lade Versionen…</div>}
          {fehler && (
            <div style={{ padding: "8px 10px", fontSize: 10, color: "#c0392b" }}>
              {fehler}
              <button className="tc-btn-secondary" style={{ display: "block", marginTop: 6, fontSize: 10, padding: "3px 8px" }}
                onClick={() => { setFehler(null); laden(); }}>
                ⟳ Erneut versuchen
              </button>
            </div>
          )}
          {versionen?.map((v, i) => {
            const istAktiv = v.versionId === modell.versionId || (!modell.versionId && i === 0);
            const klickbar = darfBearbeiten && !beschaeftigt && !istAktiv;
            const wer = nameVon(v.modifiedBy) || nameVon(v.createdBy);
            return (
              <button key={v.versionId} disabled={!klickbar}
                style={{
                  display: "flex", width: "100%", alignItems: "center", gap: 8, padding: "7px 10px", border: "none",
                  borderBottom: "0.5px solid #eef1f4", background: istAktiv ? "#eef5fb" : "none", textAlign: "left",
                  cursor: klickbar ? "pointer" : "default", fontFamily: "inherit",
                }}
                title={klickbar ? (reparatur ? "Zuordnungen stammen aus dieser Version" : "Simulation auf diese Version umstellen") : undefined}
                onClick={() => {
                  setOffen(false); setReparatur(false);
                  if (reparatur) onReparieren(v.versionId); else onWechseln(v.versionId);
                }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: istAktiv ? "#2d7dbd" : "var(--tc-text)", minWidth: 26 }}>v{nummer(v, i)}</span>
                <span style={{ flex: 1, minWidth: 0, fontSize: 10, color: "var(--tc-text-2)" }}>
                  {datum(v.modifiedOn ?? v.createdOn)}{wer ? ` · ${wer}` : ""}
                  {modell.vierD?.versionId === v.versionId && <span style={{ color: "#2e7d32" }}> · mit 4D-Daten</span>}
                </span>
                {istAktiv && <span style={{ fontSize: 9, fontWeight: 600, color: "#2d7dbd" }}>AKTIV</span>}
                {i === 0 && !istAktiv && <span style={{ fontSize: 9, color: "var(--tc-text-3)" }}>neueste</span>}
              </button>
            );
          })}
          {darfBearbeiten && versionen && versionen.length > 1 && (
            <button style={{ display: "block", width: "100%", padding: "6px 10px", border: "none", background: "none", textAlign: "left", fontSize: 10, color: "var(--tc-text-3)", cursor: "pointer", fontFamily: "inherit" }}
              onClick={() => setReparatur(r => !r)}>
              {reparatur ? "← Zurück zur Versionsliste" : "🔧 Bauteil-Zuordnungen reparieren…"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
