// ArbeitsablaufEditor.tsx — Tab Ressourcen → "Arbeitsablauf je Kürzel": in welcher Reihenfolge die Leistungspositionen eines
// Kürzels an einem Task arbeiten (Rate.schritt). Gleiche Schritte laufen gleichzeitig, eine Position kann sich auf mehrere
// Schritte aufteilen (z.B. Wandschalung 1. Seite → Bewehrung → 2. Seite → Beton: Schalung "1/3", Bewehrung "2", Beton "4").
// Verschieben ohne Tippen: Positionen anklicken (Ctrl = dazu/weg, Shift = Bereich), dann ▲ / ▼ rechts = einen Schritt früher/später.
import { useEffect, useState } from "react";
import type { Rate, Stammdaten } from "./stammdatenHelpers";
import { alleKuerzel, gewerkeFuerKuerzel, rateFuerKuerzel, parseSchritt, schritteFuerRate, schrittVerschieben } from "./stammdatenHelpers";
import { fmtZahl } from "./zahlFormat";

interface Props { stammdaten: Stammdaten; readOnly?: boolean; onRateAendern: (gewerkKey: string, kuerzel: string, patch: Partial<Rate>) => void;
  /** mehrere Positionen in einem Schritt ändern (ein Rückgängig-Schritt) — fehlt: je Position onRateAendern */
  onRatenAendern?: (aenderungen: { gewerkKey: string; kuerzel: string; patch: Partial<Rate> }[]) => void }

/** Ablauf eines Kürzels als lesbarer Text, z.B. "Schalung 50 % → Bewehrung → Schalung 50 % → Beton". */
export function ablaufText(stammdaten: Stammdaten, kuerzel: string): string {
  const jeSchritt = new Map<number, string[]>();
  for (const g of gewerkeFuerKuerzel(stammdaten, kuerzel)) {
    const rate = rateFuerKuerzel(g, kuerzel);
    for (const s of schritteFuerRate(stammdaten, g.key, rate)) {
      const liste = jeSchritt.get(s.schritt) ?? [];
      liste.push(s.anteil < 1 - 1e-9 ? `${g.label} ${fmtZahl(s.anteil * 100)} %` : g.label);
      jeSchritt.set(s.schritt, liste);
    }
  }
  return [...jeSchritt.entries()].sort((a, b) => a[0] - b[0]).map(([, l]) => l.join(" + ")).join(" → ");
}

const auswahlKey = (kuerzel: string, gewerkKey: string) => `${kuerzel}|${gewerkKey}`;
const pfeil: React.CSSProperties = { border: "1px solid var(--tc-border)", background: "#fff", cursor: "pointer", fontSize: 10, padding: "0 5px", lineHeight: "18px", color: "var(--tc-text-2)" };

export default function ArbeitsablaufEditor({ stammdaten, readOnly, onRateAendern, onRatenAendern }: Props) {
  const [auswahl, setAuswahl] = useState<string[]>([]);
  const [anker, setAnker] = useState<string | null>(null); // für Shift-Klick
  useEffect(() => {
    if (auswahl.length === 0) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setAuswahl([]); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [auswahl.length]);

  const kuerzelListe = alleKuerzel(stammdaten).filter(k => k.trim() && gewerkeFuerKuerzel(stammdaten, k).length > 0);
  if (kuerzelListe.length === 0) return <div style={{ fontSize: 11, color: "var(--tc-text-3)" }}>Noch keine Leistungspositionen angelegt.</div>;
  // alle Positionen in Anzeige-Reihenfolge (Zeile für Zeile) — für Shift-Klick
  const reihe = kuerzelListe.flatMap(k => gewerkeFuerKuerzel(stammdaten, k).map(g => auswahlKey(k, g.key)));

  function anklicken(key: string, e: React.MouseEvent) {
    if (readOnly) return;
    if (e.shiftKey && anker) {
      const [a, b] = [reihe.indexOf(anker), reihe.indexOf(key)].sort((x, y) => x - y);
      const bereich = reihe.slice(a, b + 1);
      setAuswahl(e.ctrlKey || e.metaKey ? [...new Set([...auswahl, ...bereich])] : bereich);
      return;
    }
    if (e.ctrlKey || e.metaKey) setAuswahl(auswahl.includes(key) ? auswahl.filter(x => x !== key) : [...auswahl, key]);
    else setAuswahl(auswahl.length === 1 && auswahl[0] === key ? [] : [key]);
    setAnker(key);
  }

  /** markierte Positionen einen Schritt früher (−1) / später (+1) — alle Teile einer aufgeteilten Position gemeinsam */
  function verschieben(delta: number) {
    const aenderungen: { gewerkKey: string; kuerzel: string; patch: Partial<Rate> }[] = [];
    for (const key of auswahl) {
      const [kuerzel, gewerkKey] = key.split("|");
      const g = stammdaten.gewerke.find(x => x.key === gewerkKey);
      if (!g) continue;
      const neu = schrittVerschieben(schritteFuerRate(stammdaten, gewerkKey, rateFuerKuerzel(g, kuerzel)), delta);
      if (neu === null) return; // eine kann nicht früher → keine (Abstände untereinander bleiben)
      aenderungen.push({ gewerkKey, kuerzel, patch: { schritt: neu } });
    }
    if (aenderungen.length === 0) return;
    if (onRatenAendern) onRatenAendern(aenderungen);
    else for (const a of aenderungen) onRateAendern(a.gewerkKey, a.kuerzel, a.patch);
  }
  const kannFrueher = auswahl.length > 0 && auswahl.every(key => {
    const [kuerzel, gewerkKey] = key.split("|");
    const g = stammdaten.gewerke.find(x => x.key === gewerkKey);
    return !!g && schritteFuerRate(stammdaten, gewerkKey, rateFuerKuerzel(g, kuerzel)).every(t => t.schritt > 1);
  });

  return (
    <div>
      <div style={{ fontSize: 10, color: "var(--tc-text-3)", marginBottom: 8, lineHeight: 1.5 }}>
        Schritt je Leistungsposition: <b>2</b> = Schritt 2 · <b>1/3</b> = je zur Hälfte in Schritt 1 und 3 · <b>1:70/4:30</b> = 70 % in Schritt 1 (z.B. Schalen),
        30 % in Schritt 4 (Ausschalen). Gleiche Schritte laufen gleichzeitig. Leer = Reihenfolge der Kategorien.
        {!readOnly && <> Verschieben: Position anklicken (Ctrl = weitere, Shift = Bereich, auch über mehrere Kürzel), dann ▲ / ▼ rechts = einen Schritt früher / später.</>}
      </div>
      {kuerzelListe.map(k => {
        const zeileMarkiert = auswahl.some(a => a.startsWith(`${k}|`));
        return (
          <div key={k} style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 0", borderBottom: "1px solid var(--tc-border-light)", flexWrap: "wrap" }}>
            <span style={{ width: 60, fontWeight: 700, fontSize: 12, flexShrink: 0 }}>{k}</span>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              {gewerkeFuerKuerzel(stammdaten, k).map(g => {
                const rate = rateFuerKuerzel(g, k);
                const ungueltig = parseSchritt(rate?.schritt) === null;
                const standard = stammdaten.gewerke.findIndex(x => x.key === g.key) + 1;
                const key = auswahlKey(k, g.key);
                const markiert = auswahl.includes(key);
                return (
                  <div key={g.key} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--tc-text-2)", padding: "1px 3px",
                    outline: markiert ? "1.5px solid var(--tc-blue)" : "none", background: markiert ? "var(--tc-blue-bg)" : "transparent" }}
                    title={ungueltig ? "Ungültig — Beispiele: 2 · 1/3 · 1:70/4:30 (Prozente zusammen 100)" : `Schritt von ${g.label} im Ablauf von ${k}${readOnly ? "" : " — Name anklicken zum Markieren (Ctrl/Shift für mehrere)"}`}>
                    <span onClick={e => anklicken(key, e)} style={{ cursor: readOnly ? "default" : "pointer", userSelect: "none", color: markiert ? "var(--tc-blue)" : undefined, fontWeight: markiert ? 600 : undefined }}>
                      {g.label}
                    </span>
                    <input disabled={readOnly} value={rate?.schritt ?? ""} placeholder={String(standard)}
                      onChange={e => onRateAendern(g.key, k, { schritt: e.target.value.trim() ? e.target.value : undefined })}
                      style={{ width: 70, fontSize: 11, padding: "2px 5px", fontFamily: "inherit", border: `1px solid ${ungueltig ? "var(--tc-red)" : "#d4dce4"}` }} />
                  </div>
                );
              })}
            </div>
            <span style={{ fontSize: 10, color: "var(--tc-text-3)", marginLeft: "auto" }}>{ablaufText(stammdaten, k)}</span>
            {!readOnly && (
              <span style={{ display: "inline-flex", gap: 2, visibility: zeileMarkiert ? "visible" : "hidden" }}>
                <button type="button" style={pfeil} disabled={!kannFrueher} title={`Markierte Position${auswahl.length === 1 ? "" : "en"} einen Schritt früher`}
                  onClick={() => verschieben(-1)}>▲</button>
                <button type="button" style={pfeil} title={`Markierte Position${auswahl.length === 1 ? "" : "en"} einen Schritt später`}
                  onClick={() => verschieben(1)}>▼</button>
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
