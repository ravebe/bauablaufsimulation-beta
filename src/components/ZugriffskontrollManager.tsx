// ZugriffskontrollManager.tsx — Fenster im Organizer-Design zur Zugriffskontrolle pro Projektmitglied.
// Trimble Connect stellt über die Workspace-API keine Connect-Gruppen bereit (Gruppen leben in der separaten
// Core-REST-API, die einen eigenen OAuth-Login bräuchte) — echte Connect-Gruppen sind einzelnen Nutzern
// (project.getMembers()) gewichen. Auswahl wird aktuell nur lokal gehalten, noch nicht gespeichert/durchgesetzt.
import { useState, useEffect } from "react";
import type { ApiInstance, TcProjectMember } from "../hooks/useApi";
import type { SimProjekt } from "../types";
import { useClickOutside } from "../hooks/useClickOutside";

type Zugriff = "edit" | "read" | "none";
interface Zeile { id: string; name: string; email?: string; zugriff: Zugriff; }

const OPTIONEN = [
  { key: "edit" as const, label: "Zugriff bearbeiten", icon: "✏", desc: "Inhalt hinzufügen, bearbeiten oder entfernen" },
  { key: "read" as const, label: "Schreibgeschützt", icon: "👁", desc: "Nur Anzeigen von Inhalt" },
  { key: "none" as const, label: "Kein Zugriff", icon: "🚫", desc: "Kein Zugriff auf diese Simulation" },
];

function mitgliedName(m: TcProjectMember): string {
  const n = [m.firstName, m.lastName].filter(Boolean).join(" ").trim();
  return n || m.email || m.id;
}

interface Props {
  api: ApiInstance | null;
  onClose: () => void;
  sims: SimProjekt[];
  aktivId: string | null;
  onWechsel: (id: string) => void;
}

// Auf Modulebene definiert (nicht mehr innerhalb von ZugriffskontrollManager) — sonst entstünde bei
// jedem Render der Elternkomponente ein neuer Komponenten-Typ, der React zwingt, dieses Dropdown
// (und ein offen stehendes Menü) komplett neu zu mounten statt es nur zu aktualisieren.
function AccessDropdown({ id, aktuell, onSelect, offenerDropdown, setOffenerDropdown }: {
  id: string; aktuell: Zugriff; onSelect: (v: Zugriff) => void;
  offenerDropdown: string | null; setOffenerDropdown: (v: string | null | ((prev: string | null) => string | null)) => void;
}) {
  const opt = OPTIONEN.find(o => o.key === aktuell)!;
  const ref = useClickOutside<HTMLDivElement>(offenerDropdown === id, () => setOffenerDropdown(null));
  return (
    <div ref={ref} style={{ position: "relative" }} onClick={e => e.stopPropagation()}>
      <button className="tc-btn-secondary" style={{ fontSize: 11, padding: "5px 10px", minWidth: 150, justifyContent: "space-between", display: "flex" }}
        onClick={() => setOffenerDropdown(d => d === id ? null : id)}>
        <span>{opt.icon} {opt.label}</span>
        <span>{offenerDropdown === id ? "▲" : "▼"}</span>
      </button>
      {offenerDropdown === id && (
        <div className="tc-header-dropdown" style={{ top: "100%", left: 0, right: "auto", minWidth: 230 }}>
          {OPTIONEN.map(o => (
            <div key={o.key} className={`tc-header-dropdown-item ${aktuell === o.key ? "active" : ""}`}
              onClick={() => { onSelect(o.key); setOffenerDropdown(null); }}>
              <div>
                <div style={{ fontWeight: 500 }}>{o.icon} {o.label}</div>
                <div style={{ fontSize: 9, color: "var(--tc-text-3)" }}>{o.desc}</div>
              </div>
              {aktuell === o.key && <span>✓</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ZugriffskontrollManager({ api, onClose, sims, aktivId, onWechsel }: Props) {
  const aktiveSim = sims.find(s => s.id === aktivId) ?? null;
  const [standard, setStandard] = useState<Zugriff>("read");
  const [mitglieder, setMitglieder] = useState<Zeile[] | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [offenerDropdown, setOffenerDropdown] = useState<string | null>(null);
  const [simDropdownOffen, setSimDropdownOffen] = useState(false);
  const simDropdownRef = useClickOutside<HTMLDivElement>(simDropdownOffen, () => setSimDropdownOffen(false));

  useEffect(() => {
    if (!api?.project.getMembers) { setFehler("Projektmitglieder nicht verfügbar"); return; }
    (async () => {
      try {
        const liste = await api.project.getMembers!();
        const aktive = liste.filter(m => m.status !== "REMOVED");
        setMitglieder(aktive.map(m => ({ id: m.id, name: mitgliedName(m), email: m.email, zugriff: "read" as Zugriff })));
      } catch {
        setFehler("Projektmitglieder konnten nicht geladen werden");
      }
    })();
  }, [api]);

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={onClose}>
      <div style={{ background: "#fff", width: 520, maxWidth: "92vw", maxHeight: "85vh", overflowY: "auto",
        boxShadow: "0 8px 30px rgba(0,0,0,.25)", fontFamily: "var(--tc-font)" }}
        onClick={e => { e.stopPropagation(); setOffenerDropdown(null); setSimDropdownOffen(false); }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px", borderBottom: "1px solid var(--tc-border-light)" }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "var(--tc-text)" }}>Zugriffskontrollmanager</div>
            <div ref={simDropdownRef} style={{ position: "relative" }}>
              <div style={{ fontSize: 11, color: "var(--tc-text-3)", cursor: sims.length > 1 ? "pointer" : "default", userSelect: "none", marginTop: 2 }}
                onClick={e => { if (sims.length > 1) { e.stopPropagation(); setSimDropdownOffen(o => !o); } }}>
                {aktiveSim ? aktiveSim.name : "Keine Simulation"} {sims.length > 1 && (simDropdownOffen ? "▲" : "▼")}
              </div>
              {simDropdownOffen && (
                <div className="tc-header-dropdown" style={{ top: "100%", left: 0, right: "auto", minWidth: 220 }} onClick={e => e.stopPropagation()}>
                  {sims.map(s => (
                    <div key={s.id} className={`tc-header-dropdown-item ${s.id === aktivId ? "active" : ""}`}
                      onClick={() => { onWechsel(s.id); setSimDropdownOffen(false); }}>
                      <div style={{ fontWeight: 500 }}>{s.name}</div>
                      {s.id === aktivId && <span>✓</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          <button className="tc-btn-ghost" style={{ fontSize: 14, padding: "2px 8px" }} onClick={onClose}>✕</button>
        </div>

        <div style={{ padding: "14px 18px" }}>
          <div style={{ fontSize: 11, color: "var(--tc-text-2)", lineHeight: 1.5, marginBottom: 12 }}>
            Legt fest, welche Projektmitglieder wie auf die 4D-Simulationen dieses Projekts zugreifen dürfen.
            Für ein Mitglied angewendete Zugriffskontrolle setzt den Standardzugriff außer Kraft.
          </div>

          <div style={{ fontSize: 9, fontWeight: 600, color: "var(--tc-text-3)", letterSpacing: ".5px", marginBottom: 6 }}>STANDARDZUGRIFF</div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 10px",
            border: "1px solid var(--tc-border-light)", marginBottom: 16, background: "var(--tc-bg-hover)" }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600 }}>Standardzugriff</div>
              <div style={{ fontSize: 10, color: "var(--tc-text-3)" }}>Alle Projektmitglieder ohne eigene Regel</div>
            </div>
            <AccessDropdown id="standard" aktuell={standard} onSelect={setStandard}
              offenerDropdown={offenerDropdown} setOffenerDropdown={setOffenerDropdown} />
          </div>

          <div style={{ fontSize: 9, fontWeight: 600, color: "var(--tc-text-3)", letterSpacing: ".5px", marginBottom: 6 }}>ZUGRIFF PRO MITGLIED</div>
          {fehler && <div style={{ fontSize: 11, color: "var(--tc-red)" }}>{fehler}</div>}
          {!fehler && mitglieder === null && <div style={{ fontSize: 11, color: "var(--tc-text-3)" }}>Lade Projektmitglieder…</div>}
          {!fehler && mitglieder?.length === 0 && <div style={{ fontSize: 11, color: "var(--tc-text-3)" }}>Keine weiteren Projektmitglieder gefunden</div>}
          {mitglieder?.map(m => (
            <div key={m.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 10px",
              borderBottom: "1px solid var(--tc-border-light)" }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 500 }}>👤 {m.name}</div>
                {m.email && m.email !== m.name && <div style={{ fontSize: 9, color: "var(--tc-text-3)" }}>{m.email}</div>}
              </div>
              <AccessDropdown id={m.id} aktuell={m.zugriff}
                onSelect={v => setMitglieder(prev => prev!.map(x => x.id === m.id ? { ...x, zugriff: v } : x))}
                offenerDropdown={offenerDropdown} setOffenerDropdown={setOffenerDropdown} />
            </div>
          ))}

          <div style={{ fontSize: 9, color: "var(--tc-text-3)", marginTop: 14, fontStyle: "italic" }}>
            Einstellungen werden noch nicht gespeichert oder durchgesetzt — Vorschau.
          </div>
        </div>
      </div>
    </div>
  );
}
