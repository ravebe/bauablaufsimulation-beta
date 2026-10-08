// PunkteMenu.tsx — ⋮-Menü mit zuklappbaren Abschnitten (z.B. Aktionen / Export / Import), schwebend (Schwebend.tsx).
// Verwendet in Tab Ressourcen (rechts in jeder Kategorie-Kopfzeile) und Tab Kalkulation (rechts über
// der Tabelle) anstelle einzelner Buttons.
import { useRef, useState } from "react";
import { useClickOutside } from "../hooks/useClickOutside";
import Schwebend from "./Schwebend";

export interface PunkteMenuEintrag { label: string; onClick: () => void; title?: string; disabled?: boolean }
export interface PunkteMenuAbschnitt { titel: string; eintraege: PunkteMenuEintrag[]; leerText?: string }

interface Props {
  abschnitte: PunkteMenuAbschnitt[];
  title?: string;
}

export default function PunkteMenu({ abschnitte, title }: Props) {
  const [offen, setOffen] = useState(false);
  const [offenerAbschnitt, setOffenerAbschnitt] = useState<string | null>(null);
  const knopfRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const ref = useClickOutside<HTMLDivElement>(offen, () => setOffen(false), menuRef);
  if (abschnitte.length === 0) return null;

  return (
    <div ref={ref} style={{ flexShrink: 0 }}>
      <button ref={knopfRef} title={title} onClick={() => { setOffen(o => !o); setOffenerAbschnitt(null); }}
        style={{ width: 26, background: "none", border: "none", cursor: "pointer", fontSize: 16, lineHeight: 1, color: "var(--tc-text-3)", padding: "0 0 2px", fontFamily: "inherit" }}>⋮</button>
      {offen && (
        <Schwebend anker={knopfRef} menuRef={menuRef} ausrichtung="rechts" style={{
          background: "#fff", border: "0.5px solid var(--tc-border)", borderRadius: 5, boxShadow: "0 2px 8px rgba(0,0,0,.12)", minWidth: 200, paddingBottom: 4,
        }}>
          {abschnitte.map(a => {
            const aufgeklappt = offenerAbschnitt === a.titel;
            return (
            <div key={a.titel}>
              {/* Abschnitt zugeklappt — Klick auf den Titel öffnet die Auswahl (wie ein Dropdown) */}
              <button onClick={() => setOffenerAbschnitt(aufgeklappt ? null : a.titel)}
                style={{ display: "flex", alignItems: "center", gap: 6, width: "100%", padding: "7px 12px", background: "none", border: "none", textAlign: "left",
                  fontSize: 11, fontWeight: 700, color: "var(--tc-text)", cursor: "pointer", fontFamily: "inherit" }}
                onMouseEnter={ev => (ev.currentTarget.style.background = "#f5f9fc")} onMouseLeave={ev => (ev.currentTarget.style.background = "")}>
                <span style={{ flex: 1 }}>{a.titel}</span>
                <span style={{ fontSize: 9, color: "var(--tc-text-3)" }}>{aufgeklappt ? "▾" : "▸"}</span>
              </button>
              {aufgeklappt && a.eintraege.length === 0 && a.leerText && (
                <div style={{ padding: "4px 12px 4px 18px", fontSize: 10, color: "var(--tc-text-3)" }}>{a.leerText}</div>
              )}
              {aufgeklappt && a.eintraege.map(e => (
                <button key={e.label} title={e.title} disabled={e.disabled}
                  onClick={() => { setOffen(false); e.onClick(); }}
                  style={{ display: "block", width: "100%", padding: "6px 12px 6px 18px", background: "none", border: "none", textAlign: "left", fontSize: 11,
                    cursor: e.disabled ? "default" : "pointer", fontFamily: "inherit", color: e.disabled ? "#aab8c4" : "var(--tc-text)" }}
                  onMouseEnter={ev => { if (!e.disabled) ev.currentTarget.style.background = "#f5f9fc"; }}
                  onMouseLeave={ev => (ev.currentTarget.style.background = "")}>
                  {e.label}
                </button>
              ))}
            </div>
            );
          })}
        </Schwebend>
      )}
    </div>
  );
}
