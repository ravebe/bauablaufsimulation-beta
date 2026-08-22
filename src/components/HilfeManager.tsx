// HilfeManager.tsx — Kontextuelle Hilfe als Overlay (gleiches Fenster-Design wie ZugriffskontrollManager).
// Öffnet direkt auf dem Thema des aktuell aktiven Tabs, links lassen sich alle anderen Themen anwählen.
import { useState } from "react";
import type { Tab, TabGruppe } from "../App";

interface Thema {
  key: Tab;
  gruppe: TabGruppe;
  label: string;
  zusammenfassung: string;
  punkte: string[];
}

const THEMEN: Thema[] = [
  {
    key: "projekte", gruppe: "haupt", label: "Projekte",
    zusammenfassung: "Verwaltung der 4D-Simulationen dieses Projekts: anlegen, umbenennen, Modelle zuweisen, Bauablauf importieren oder exportieren.",
    punkte: [
      "Jede Simulation hat eigene Tasks, Stammdaten und einen eigenen Kalender.",
      "Über \"Modelle auswählen\" wird festgelegt, aus welchen Trimble-Connect-Modellen die Bauteile stammen.",
      "Gantt-Import liest einen bestehenden Bauablauf ein, Gantt-Export schreibt ihn wieder heraus.",
      "Auto-Verknüpfung kann Abhängigkeiten zwischen Tasks automatisch vorschlagen.",
      "Nur die als \"Aktiv\" markierte Simulation wird in den anderen Tabs bearbeitet.",
    ],
  },
  {
    key: "bauteile", gruppe: "haupt", label: "Bauteile",
    zusammenfassung: "Verknüpft Modell-Objekte mit Tasks: Task-Liste, IFC-Attribut-Filter und Gantt-Ansicht mit Selektions-Tracking im 3D-Modell.",
    punkte: [
      "Objekte im 3D-Modell auswählen — die zugehörigen Tasks werden erkannt und markiert.",
      "Der IFC-Attribut-Filter grenzt die Task-Liste nach Modell-Eigenschaften ein.",
      "Über \"☰ Liste\" / \"▤ Gantt\" zwischen Tabellen- und Gantt-Ansicht umschalten.",
      "Die Suche findet Tasks anhand ihres Namens.",
    ],
  },
  {
    key: "abspielen", gruppe: "haupt", label: "Abspielen",
    zusammenfassung: "Spielt den Bauablauf zeitlich ab und färbt Bauteile im 3D-Modell je nach Status ein.",
    punkte: [
      "Farbcodierung: grün = Neubau, grau = Bestand, gelb = Abbruch, braun = temporär.",
      "Der Player steuert das Datum, zu dem der Modellzustand angezeigt wird.",
      "Der Zeitverlauf basiert auf Start- und Enddatum der Tasks im Bauablauf.",
    ],
  },
  {
    key: "kalkulation", gruppe: "erweitert", label: "Kalkulation",
    zusammenfassung: "Erfasst je Task ein Bauteil-Kürzel und Mengen. Daraus wird eine berechnete Dauer ermittelt und der geplanten Dauer aus dem Bauablauf gegenübergestellt.",
    punkte: [
      "Spalten: Nr., Task, Kürzel, Mengen, Geplant, Berechnet, WBS.",
      "Ein Kürzel muss in den Stammdaten (Tab Ressourcen) hinterlegt sein, sonst fehlt der Leistungswert.",
      "\"Berechnet\" ergibt sich aus Leistungswert × Menge sowie Arbeitszeit/Personen aus den Stammdaten.",
      "Abweichungen zwischen Geplant und Berechnet zeigen mögliche Kalkulationsrisiken.",
      "Mengen lassen sich manuell erfassen oder per Formel (ƒx-Button) aus IFC-Attributen berechnen.",
    ],
  },
  {
    key: "ressourcen", gruppe: "erweitert", label: "Ressourcen",
    zusammenfassung: "Pflege der Stammdaten: Kategorien/Gewerke mit Kürzeln, Leistungswerten, Personenzahl und CHF-Ansätzen — Grundlage für Kalkulation, AVOR und Kosten.",
    punkte: [
      "Arbeitszeit pro Tag und Umsatz CHF/Mannstunde gelten global für die gesamte Simulation.",
      "Kategorien lassen sich aus vorgefertigten Katalogen laden oder frei anlegen und umbenennen.",
      "\"kranpflichtig\" markiert Gewerke, deren Mengen in die Kranauslastung (Tab AVOR) einfließen.",
      "Ein Kürzel darf innerhalb derselben Kategorie nur einmal vorkommen — bei Duplikaten zählt nur die erste Zeile.",
    ],
  },
  {
    key: "avor", gruppe: "erweitert", label: "AVOR",
    zusammenfassung: "Cockpit mit Personal- und Kranauslastung, Mengen-Filter je Gewerk und Ertragsoptik über die Zeit — abgeleitet aus den Kalkulationsmengen und den Stammdaten.",
    punkte: [
      "Setzt Stammdaten (Ressourcen) sowie erfasste Mengen/Kürzel (Kalkulation) voraus, sonst bleibt die Ansicht leer.",
      "Die Kranauslastung erscheint nur, wenn mindestens ein Gewerk als \"kranpflichtig\" markiert ist.",
      "Die Ertragsoptik vergleicht den kumulierten Ertrag mit den kumulierten Kosten.",
    ],
  },
  {
    key: "kosten", gruppe: "erweitert", label: "Kosten",
    zusammenfassung: "Rein lesende Kostenauswertung aus Mengen × Stammdaten-Raten je Task, aggregiert nach Bauteil-Kürzel.",
    punkte: [
      "Keine Eingabe in diesem Tab — Mengen/Kürzel werden in Kalkulation, Ansätze in Ressourcen gepflegt.",
      "Zeigt die Kostenverteilung über die Zeit und nach Kategorie.",
    ],
  },
];

const GRUPPEN_LABEL: Record<TabGruppe, string> = { haupt: "Hauptbereich", erweitert: "Erweitert (Auswertung)" };

interface Props {
  initialTab: Tab;
  onClose: () => void;
}

export default function HilfeManager({ initialTab, onClose }: Props) {
  const [aktivesThema, setAktivesThema] = useState<Tab>(initialTab);
  const thema = THEMEN.find(t => t.key === aktivesThema)!;

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={onClose}>
      <div style={{ background: "#fff", width: 720, maxWidth: "92vw", maxHeight: "85vh", display: "flex",
        boxShadow: "0 8px 30px rgba(0,0,0,.25)", fontFamily: "var(--tc-font)" }}
        onClick={e => e.stopPropagation()}>
        <div style={{ width: 190, flexShrink: 0, borderRight: "1px solid var(--tc-border-light)", padding: "14px 10px", overflowY: "auto" }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: "var(--tc-text)", padding: "0 6px 12px" }}>Hilfe</div>
          {(["haupt", "erweitert"] as TabGruppe[]).map(gruppe => (
            <div key={gruppe} style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 9, fontWeight: 600, color: "var(--tc-text-3)", letterSpacing: ".5px", padding: "0 6px 6px" }}>
                {GRUPPEN_LABEL[gruppe].toUpperCase()}
              </div>
              {THEMEN.filter(t => t.gruppe === gruppe).map(t => (
                <div key={t.key} onClick={() => setAktivesThema(t.key)}
                  style={{ fontSize: 12, padding: "7px 8px", cursor: "pointer", marginBottom: 2,
                    fontWeight: aktivesThema === t.key ? 600 : 400,
                    color: aktivesThema === t.key ? "#fff" : "var(--tc-text)",
                    background: aktivesThema === t.key ? "var(--tc-blue)" : "transparent" }}>
                  {t.label}
                </div>
              ))}
            </div>
          ))}
        </div>

        <div style={{ flex: 1, minWidth: 0, overflowY: "auto" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px", borderBottom: "1px solid var(--tc-border-light)" }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: "var(--tc-text)" }}>{thema.label}</div>
            <button className="tc-btn-ghost" style={{ fontSize: 14, padding: "2px 8px" }} onClick={onClose}>✕</button>
          </div>
          <div style={{ padding: "16px 18px" }}>
            <div style={{ fontSize: 9, fontWeight: 600, color: "var(--tc-text-3)", letterSpacing: ".5px", marginBottom: 6 }}>ZUSAMMENFASSUNG</div>
            <div style={{ fontSize: 12, color: "var(--tc-text-2)", lineHeight: 1.5, marginBottom: 18 }}>{thema.zusammenfassung}</div>

            <div style={{ fontSize: 9, fontWeight: 600, color: "var(--tc-text-3)", letterSpacing: ".5px", marginBottom: 8 }}>WICHTIGE PUNKTE</div>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: "var(--tc-text-2)", lineHeight: 1.7 }}>
              {thema.punkte.map((p, i) => <li key={i}>{p}</li>)}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
