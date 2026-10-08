// RessourcenMenu.tsx — ⋮-Menü im Tab Ressourcen (rechts in jeder Kategorie-Kopfzeile): Export, Import,
// Kategorie hinzufügen. Ersetzt die früheren Export-/Import-Buttons und die Auswahl "+ Kategorie
// hinzufügen…" im Kopf des Tabs.
import { useRef, useState } from "react";
import type { ReactNode } from "react";
import { useClickOutside } from "../hooks/useClickOutside";
import Schwebend from "./Schwebend";

interface Props {
  readOnly?: boolean;
  exportMoeglich: boolean;
  onExportJson: () => void;
  onExportCsv: () => void;
  onImportJson: () => void;
  onImportCsv: () => void;
  /** noch nicht (vollständig) geladene Kategorien aus dem Katalog */
  kataloge: { key: string; label: string }[];
  onKategorie: (katalogKey: string) => void;
}

const titelStil = { padding: "6px 12px 3px", fontSize: 9, fontWeight: 600, color: "var(--tc-text-3)", letterSpacing: ".5px" } as const;

function Eintrag({ children, onClick, title }: { children: ReactNode; onClick: () => void; title?: string }) {
  return (
    <button title={title} onClick={onClick}
      style={{ display: "block", width: "100%", padding: "6px 12px 6px 18px", background: "none", border: "none", textAlign: "left", fontSize: 11, cursor: "pointer", fontFamily: "inherit", color: "var(--tc-text)" }}
      onMouseEnter={e => (e.currentTarget.style.background = "#f5f9fc")} onMouseLeave={e => (e.currentTarget.style.background = "")}>
      {children}
    </button>
  );
}

export default function RessourcenMenu({ readOnly, exportMoeglich, onExportJson, onExportCsv, onImportJson, onImportCsv, kataloge, onKategorie }: Props) {
  const [offen, setOffen] = useState(false);
  const knopfRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const ref = useClickOutside<HTMLDivElement>(offen, () => setOffen(false), menuRef);
  const waehlen = (fn: () => void) => () => { setOffen(false); fn(); };

  return (
    <div ref={ref} style={{ flexShrink: 0 }}>
      <button ref={knopfRef} title="Export, Import, Kategorie hinzufügen" onClick={() => setOffen(o => !o)}
        style={{ width: 26, background: "none", border: "none", cursor: "pointer", fontSize: 16, lineHeight: 1, color: "var(--tc-text-3)", padding: "0 0 2px" }}>⋮</button>
      {offen && (
        <Schwebend anker={knopfRef} menuRef={menuRef} ausrichtung="rechts" style={{
          background: "#fff", border: "0.5px solid var(--tc-border)", borderRadius: 5, boxShadow: "0 2px 8px rgba(0,0,0,.12)", minWidth: 200, paddingBottom: 4,
        }}>
          {exportMoeglich && (<>
            <div style={titelStil}>EXPORT</div>
            <Eintrag onClick={waehlen(onExportJson)} title="Alle Kategorien/Kürzel/Leistungswerte als JSON-Datei — z.B. für ein anderes Trimble-Connect-Projekt">JSON</Eintrag>
            <Eintrag onClick={waehlen(onExportCsv)} title="Raten (Kürzel/LW/Personen/CHF/Formel) als CSV — in Excel bearbeitbar, danach wieder importierbar">CSV</Eintrag>
          </>)}
          {!readOnly && (<>
            <div style={titelStil}>IMPORT</div>
            <Eintrag onClick={waehlen(onImportJson)} title="Aus einer zuvor exportierten JSON-Datei importieren">JSON</Eintrag>
            <Eintrag onClick={waehlen(onImportCsv)} title="Aus einer zuvor exportierten (in Excel bearbeiteten) CSV-Datei importieren">CSV</Eintrag>
            <div style={titelStil}>KATEGORIE HINZUFÜGEN</div>
            {kataloge.length === 0
              ? <div style={{ padding: "4px 12px 4px 18px", fontSize: 10, color: "var(--tc-text-3)" }}>Alle Kategorien sind geladen</div>
              : kataloge.map(k => <Eintrag key={k.key} onClick={waehlen(() => onKategorie(k.key))}
                  title="Legt nur Gewerke/Kürzel/Einheiten an — Werte selbst befüllen; Kategorien lassen sich danach frei umbenennen">{k.label}</Eintrag>)}
          </>)}
        </Schwebend>
      )}
    </div>
  );
}
