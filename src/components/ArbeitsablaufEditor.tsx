// ArbeitsablaufEditor.tsx — Tab Ressourcen → "Arbeitsablauf je Kürzel": in welcher Reihenfolge die Leistungspositionen eines
// Kürzels an einem Task arbeiten (Rate.schritt). Gleiche Schritte laufen gleichzeitig, eine Position kann sich auf mehrere
// Schritte aufteilen (z.B. Wandschalung 1. Seite → Bewehrung → 2. Seite → Beton: Schalung "1/3", Bewehrung "2", Beton "4").
import type { Rate, Stammdaten } from "./stammdatenHelpers";
import { alleKuerzel, gewerkeFuerKuerzel, rateFuerKuerzel, parseSchritt, schritteFuerRate } from "./stammdatenHelpers";
import { fmtZahl } from "./zahlFormat";

interface Props { stammdaten: Stammdaten; readOnly?: boolean; onRateAendern: (gewerkKey: string, kuerzel: string, patch: Partial<Rate>) => void }

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

export default function ArbeitsablaufEditor({ stammdaten, readOnly, onRateAendern }: Props) {
  const kuerzelListe = alleKuerzel(stammdaten).filter(k => k.trim() && gewerkeFuerKuerzel(stammdaten, k).length > 0);
  if (kuerzelListe.length === 0) return <div style={{ fontSize: 11, color: "var(--tc-text-3)" }}>Noch keine Kürzel angelegt.</div>;
  return (
    <div>
      <div style={{ fontSize: 10, color: "var(--tc-text-3)", marginBottom: 8, lineHeight: 1.5 }}>
        Schritt je Leistungsposition: <b>2</b> = Schritt 2 · <b>1/3</b> = je zur Hälfte in Schritt 1 und 3 · <b>1:60/3:40</b> = 60 % in Schritt 1, 40 % in Schritt 3.
        Gleiche Schritte laufen gleichzeitig. Leer = Reihenfolge der Kategorien.
      </div>
      {kuerzelListe.map(k => (
        <div key={k} style={{ display: "flex", alignItems: "baseline", gap: 10, padding: "4px 0", borderBottom: "1px solid var(--tc-border-light)", flexWrap: "wrap" }}>
          <span style={{ width: 60, fontWeight: 700, fontSize: 12, flexShrink: 0 }}>{k}</span>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            {gewerkeFuerKuerzel(stammdaten, k).map(g => {
              const rate = rateFuerKuerzel(g, k);
              const ungueltig = parseSchritt(rate?.schritt) === null;
              const standard = stammdaten.gewerke.findIndex(x => x.key === g.key) + 1;
              return (
                <label key={g.key} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--tc-text-2)" }}
                  title={ungueltig ? "Ungültig — Beispiele: 2 · 1/3 · 1:60/3:40 (Prozente zusammen 100)" : `Schritt von ${g.label} im Ablauf von ${k}`}>
                  {g.label}
                  <input disabled={readOnly} value={rate?.schritt ?? ""} placeholder={String(standard)}
                    onChange={e => onRateAendern(g.key, k, { schritt: e.target.value.trim() ? e.target.value : undefined })}
                    style={{ width: 70, fontSize: 11, padding: "2px 5px", fontFamily: "inherit", border: `1px solid ${ungueltig ? "var(--tc-red)" : "#d4dce4"}` }} />
                </label>
              );
            })}
          </div>
          <span style={{ fontSize: 10, color: "var(--tc-text-3)", marginLeft: "auto" }}>{ablaufText(stammdaten, k)}</span>
        </div>
      ))}
    </div>
  );
}
