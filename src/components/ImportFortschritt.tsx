// ImportFortschritt.tsx — Fenster mit Ladebalken für Importe (Tab Ressourcen → ⋮ → Importieren JSON/CSV): bleibt offen, bis der
// Import fertig ist — Schritte mit Haken, Ladebalken, Rückfrage (z.B. «bestehende Ressourcen ersetzen?») und am Ende das Ergebnis
// bzw. der Fehler mit «Schliessen». Der Balken läuft als CSS-Animation (transform) auch dann weiter, wenn das Übernehmen den
// Browser kurz blockiert.

export interface ImportStand {
  titel: string; datei: string;
  schritte: string[];
  /** Index des laufenden Schritts (schritte.length = alle erledigt) */
  schritt: number;
  /** Rückfrage vor dem Weitermachen (mit «Ersetzen» / «Abbrechen») */
  frage?: string;
  fertig?: string;
  fehler?: string;
}

export default function ImportFortschritt({ stand, onAntwort, onSchliessen }: {
  stand: ImportStand; onAntwort: (ja: boolean) => void; onSchliessen: () => void;
}) {
  const abgeschlossen = !!stand.fertig || !!stand.fehler;
  const anteil = abgeschlossen ? 1 : (stand.schritt + 0.5) / stand.schritte.length;
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.35)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div role="dialog" aria-modal="true" style={{ background: "#fff", width: 380, maxWidth: "92%", padding: "16px 18px", boxShadow: "0 6px 24px rgba(0,0,0,.25)", fontSize: 12 }}>
        <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 2 }}>{stand.titel}</div>
        <div style={{ color: "var(--tc-text-3)", marginBottom: 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{stand.datei}</div>

        {/* Ladebalken: Fortschritt nach Schritten, darüber ein laufender Streifen, solange nicht abgeschlossen */}
        <div style={{ position: "relative", height: 8, background: "#e6eaee", overflow: "hidden", marginBottom: 10 }}>
          <div style={{ position: "absolute", inset: 0, width: `${anteil * 100}%`, transition: "width .3s",
            background: stand.fehler ? "var(--tc-red)" : abgeschlossen ? "var(--tc-green-dark, #2e7d32)" : "var(--tc-blue)" }} />
          {!abgeschlossen && !stand.frage && <div className="ladebalken-laeuft" />}
        </div>

        {stand.schritte.map((s, i) => {
          const erledigt = i < stand.schritt || !!stand.fertig;
          const laeuft = i === stand.schritt && !abgeschlossen;
          return (
            <div key={s} style={{ display: "flex", gap: 6, color: erledigt ? "var(--tc-text-2)" : laeuft ? "var(--tc-text)" : "var(--tc-text-3)", fontWeight: laeuft ? 600 : 400, lineHeight: 1.7 }}>
              <span style={{ width: 14, textAlign: "center" }}>{erledigt ? "✓" : laeuft ? "…" : "·"}</span>{s}
            </div>
          );
        })}

        {stand.frage && (
          <div style={{ marginTop: 10, padding: "6px 8px", background: "#fff7e6", border: "1px solid #f5d9a8", color: "#8a5a00" }}>
            {stand.frage}
            <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", marginTop: 6 }}>
              <button type="button" className="tc-btn-secondary" style={{ fontSize: 11, padding: "3px 10px" }} onClick={() => onAntwort(false)}>Abbrechen</button>
              <button type="button" className="tc-btn-primary" style={{ fontSize: 11, padding: "3px 10px" }} onClick={() => onAntwort(true)}>Ersetzen</button>
            </div>
          </div>
        )}
        {!abgeschlossen && !stand.frage && stand.schritt >= 2 && (
          <div style={{ marginTop: 8, color: "var(--tc-text-3)", fontSize: 11 }}>Bei grossen Projekten kann das einige Sekunden dauern — bitte warten.</div>
        )}
        {stand.fertig && <div style={{ marginTop: 10, color: "var(--tc-green-dark, #2e7d32)", fontWeight: 600 }}>✓ {stand.fertig}</div>}
        {stand.fehler && <div style={{ marginTop: 10, color: "var(--tc-red)", fontWeight: 600 }}>! {stand.fehler}</div>}
        {abgeschlossen && (
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
            <button type="button" className="tc-btn-primary" style={{ fontSize: 11, padding: "4px 14px" }} onClick={onSchliessen} autoFocus>Schliessen</button>
          </div>
        )}
      </div>
    </div>
  );
}
