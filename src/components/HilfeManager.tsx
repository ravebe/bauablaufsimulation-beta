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
      "Gantt-Import liest einen bestehenden Bauablauf ein (xlsx, csv, xml, json oder MS-Project-XML). Ein erneuter Import erkennt die Tasks wieder — auch umbenannte aus MS Project —, Kalkulationsdaten bleiben erhalten.",
      "Auto-Verknüpfung ordnet die Bauteile automatisch den Tasks zu; alternativ lassen sich Tasks aus IFC-Attributen erzeugen (nur eine der beiden Arten gleichzeitig).",
      "Nur die als \"Aktiv\" markierte Simulation wird in den anderen Tabs bearbeitet.",
      "⋮ der Simulationskarte: Umbenennen, Gantt-Vorlage, Export (Excel, CSV, XML, JSON, MS Project, IFC 4D), Zeiteinheit, Kalender / Feiertage / Ferien, Frühere Versionen, Projekt kopieren, Löschen und Info.",
      "Zeiteinheit: Tage (Standard), Halbtage oder Uhrzeit (Arbeitszeit aus Tab Ressourcen) — bestimmt das Raster beim Ziehen und die Anzeige der Dauer. Gröber stellen rundet die Termine nach Rückfrage.",
      "Kalender: Wochenenden, Feiertage und Ferien sind arbeitsfrei. Tasks beginnen und enden nur an Arbeitstagen; die Dauer zählt Arbeitstage inklusive Start- und Endtag.",
      "IFC 4D: \"In Connect übernehmen\" ergänzt die Original-IFC um den Bauablauf, lädt sie als neue Version hoch und stellt die Simulation darauf um. Meldet Connect bei der Verarbeitung einen Fehler, wird die Version trotzdem geladen, sofern der Viewer sie öffnen kann.",
      "Info öffnet ein eigenes Fenster mit der Zusammenfassung der Simulation: Ersteller, letzte Änderung, Terminplan (Tasks, Zeitraum, Vorgänger, Zeiteinheit, Kalender), Bauteile & Modelle sowie Kalkulation.",
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
      "Termine ändern: Datum in der Liste anklicken oder im Gantt den Balken ziehen (Mitte = verschieben, Enden = Start/Ende). Die Dauer in Arbeitstagen bleibt beim Verschieben erhalten.",
      "Vorgänger: in der Spalte hinter der Task-Nummer. Mehrere mit Komma (z.B. 26, 27+2); das Feld \"Wartetage\" gilt für alle Nummern ohne eigenes +n und bleibt beim erneuten Öffnen stehen. Ein Klick ins Feld markiert die Zahl zum direkten Überschreiben.",
      "Tasks, die einen Zirkelbezug ergäben, sind in der Vorgänger-Auswahl ausgegraut, mit der Kette (z.B. ⟲ 48 → 47 → 46) und Erklärung beim Darüberfahren.",
      "Ein Nachfolger beginnt am Tag nach dem Ende seines Vorgängers plus Wartetage; bei mehreren Vorgängern zählt der späteste.",
      "Meilenstein: Task ohne Dauer (Raute im Gantt), z.B. Abnahme oder Rohbau fertig.",
      "Werkzeuge (🔧): \"Auto-Vorgänger\" verkettet Tasks und Gruppen der Reihenfolge nach, setzt aber nur bei Tasks ohne Vorgänger einen — bestehende bleiben erhalten. \"Folge-Tasks neu ausrichten\" richtet alle Nachfolger nach ihren Vorgängern aus. \"Berechnete Dauer übernehmen\" überträgt die Dauer aus Tab Kalkulation.",
      "Gantt-⋮ → Optionen: \"Wochenende, Ferien und Feiertage ausblenden\" klappt die arbeitsfreien Tage (graue Bänder) ein; derselbe Eintrag blendet sie wieder ein. Gilt auch in Tab Abspielen.",
      "Strg + Mausrad oder die Knöpfe + / − unten rechts zoomen das Gantt.",
      "\"Noch nicht verknüpft\" (Bauteile ohne Task) und \"Aus Simulation entfernt\" stehen als aufklappbarer Bereich unter \"Bauteile zugewiesen\". Entfernte Bauteile werden beim Aktivieren der Simulation ausgeblendet, nirgends gerechnet und von Auto-Verknüpfung/Attribut-Tasks übergangen.",
      "Entfernen: im Modell markieren → \"Noch nicht verknüpft\" → \"⊘ Markierte entfernen\", oder in der Bauteil-Liste eines Tasks \"⊘\". Wieder aufnehmen unter \"Aus Simulation entfernt\" (\"↩\") — das Bauteil kommt zurück in seinen bisherigen Task.",
    ],
  },
  {
    key: "abspielen", gruppe: "haupt", label: "Abspielen",
    zusammenfassung: "Spielt den Bauablauf zeitlich ab und färbt Bauteile im 3D-Modell je nach Status ein.",
    punkte: [
      "Farbcodierung: grün = Neubau, grau = Bestand, gelb = Abbruch, braun = Bauhilfsmassnahme, blau = Baustelleneinrichtung, violett = Drittprojekt.",
      "\"Starten\" spielt den Bauablauf ab; das Feld rechts daneben legt die Sekunden pro Tag fest. Slider, Klick in den Gantt oder Ziehen der roten Nadel springen zu einem Datum.",
      "Der Zeitverlauf basiert auf Start- und Enddatum der Tasks; bei Zeiteinheit Halbtage/Uhrzeit läuft er auch innerhalb des Tages.",
      "Unter der Liste bzw. dem Gantt erscheinen nur Ablauf-Meldungen (Bereit machen / Bereit / abgeschlossen).",
      "Ein im Modell markiertes Bauteil holt den verknüpften Task in Liste und Gantt in die Mitte.",
      "Gantt-⋮ → Optionen: Wochenende, Ferien und Feiertage aus- bzw. wieder einblenden (wie in Tab Bauteile).",
    ],
  },
  {
    key: "kalkulation", gruppe: "erweitert", label: "Kalkulation",
    zusammenfassung: "Erfasst je Task ein Bauteil-Kürzel und Mengen. Daraus wird eine berechnete Dauer ermittelt und der geplanten Dauer aus dem Bauablauf gegenübergestellt.",
    punkte: [
      "Spalten: Nr., Task, Kürzel, Mengen, Geplant, Berechnet, WBS.",
      "Ein Kürzel muss in den Stammdaten (Tab Ressourcen) hinterlegt sein, sonst fehlt der Leistungswert.",
      "\"Berechnet\" ergibt sich aus Leistungswert × Menge sowie Arbeitszeit/Personen aus den Stammdaten — lässt sich bei Bedarf manuell übersteuern (schwarz statt blau).",
      "Abweichungen zwischen Geplant und Berechnet zeigen mögliche Kalkulationsrisiken.",
      "Mengen lassen sich manuell erfassen oder per Formel (ƒx-Button) aus IFC-Attributen berechnen.",
      "\"Personal (Soll)\" ist die vorgesehene Gesamt-Personenzahl je Task, unabhängig von den Kolonnengrössen je Kürzel in Tab Ressourcen — ergibt die rote Referenzlinie über der Personalauslastung in Tab AVOR.",
      "Spalte \"Kräne\": einem Task lassen sich mehrere Kräne zuweisen (Schnittstellen-Task zwischen zwei Kränen) — der Anteil wird dabei immer automatisch gleichmässig verteilt (2 Kräne → je 50%), keine manuelle Eingabe. Kräne selbst werden in Tab AVOR über \"Kran-Verfügbarkeit\" angelegt.",
      "\"Kranbereich\" bleibt ein freies Textfeld zur Gruppierung/Bauphase (z.B. für den Kapazitäts-Check) — für die eigentliche Kranauswertung (Kranoptik) zählt ausschliesslich die Spalte \"Kräne\".",
      "Export/Import (CSV oder JSON, im ⋮ rechts über der Tabelle) übertragen Kürzel/Kranbereich/Kräne/Personal (Soll)/Mengen aller Tasks, z.B. zum Bearbeiten in Excel.",
    ],
  },
  {
    key: "ressourcen", gruppe: "erweitert", label: "Ressourcen",
    zusammenfassung: "Pflege der Stammdaten: Kategorien/Gewerke mit Kürzeln, Leistungswerten, Personenzahl und CHF-Ansätzen — Grundlage für Kalkulation, AVOR und Kosten.",
    punkte: [
      "Arbeitszeit (Beginn, Mittagspause, Ende) und Umsatz CHF/Mannstunde gelten global für die gesamte Simulation. Aus der Arbeitszeit ergeben sich die Std./Tag (z.B. 07:00–12:00 / 13:00–16:30 = 8,5 h) — sie gelten überall: Kalkulation, Gantt-Uhrzeiten und Halbtage, Personal, Kran, Ertrag sowie MS-Project- und IFC-Export. Halbtage zählen nach echten Stunden (Vormittag 5 h ≠ Nachmittag 3,5 h).",
      "Kategorien lassen sich aus vorgefertigten Katalogen laden oder frei anlegen und umbenennen.",
      "\"kranpflichtig\" markiert je Kürzel, ob dessen Mengen in die Kranauslastung (Tab AVOR) einfließen.",
      "Ein Kürzel darf innerhalb derselben Kategorie nur einmal vorkommen — bei Duplikaten zählt nur die erste Zeile.",
    ],
  },
  {
    key: "avor", gruppe: "erweitert", label: "AVOR",
    zusammenfassung: "Cockpit mit Personal- und Kranauslastung, Mengen-Filter je Gewerk und Ertragsoptik über die Zeit — abgeleitet aus den Kalkulationsmengen und den Stammdaten.",
    punkte: [
      "Setzt Stammdaten (Ressourcen) sowie erfasste Mengen/Kürzel (Kalkulation) voraus, sonst bleibt die Ansicht leer.",
      "Über \"Kran-Verfügbarkeit\" Kräne anlegen und ihren Einsatzzeitraum (von/bis) festlegen — Grundlage für Kranoptik und Kapazitäts-Check.",
      "Grundlage aller Auswertungen ist der Aufwand je Task: Menge × Leistungswert (Personenstunden). Daraus folgen Personal (÷ Std./Tag), Ertrag (× Umsatz/Mannstunde), Kranstunden (Aufwand der kranpflichtigen Gewerke ÷ Kolonne — eine Stütze mit 6 Personenstunden und 3er-Kolonne belegt den Kran 2 h, nicht den ganzen Tag) und der zeitliche Verlauf der Kosten (Menge × CHF/Einheit, verteilt wie der Aufwand).",
      "Die Kranoptik zeigt je Kran die geplanten Kranstunden gegen die verfügbare Kapazität, wahlweise je Monat oder Woche; Balken über der Kapazität sind rot markiert (Engpass). Erscheint erst, wenn Kräne angelegt und Tasks in Tab Kalkulation zugewiesen sind.",
      "Personalauslastung und Peak: Je Task arbeiten die Gewerke nacheinander (Reihenfolge wie in Tab Ressourcen), jedes so lange wie in Tab Kalkulation berechnet. Ist ein Task im Gantt länger oder kürzer als berechnet, wird die Kolonne entsprechend kleiner oder grösser (Personen = Kolonne × berechnete ÷ geplante Dauer) — die Personenstunden je Task entsprechen so immer genau Menge × Leistungswert. Gewerke ohne Leistungswert zählen nicht mit.",
      "Über der Personalauslastung erscheint eine rote gestrichelte \"Personal (Soll)\"-Linie, sobald mindestens ein Task in Tab Kalkulation eine vorgesehene Personenzahl hat.",
      "Der Kapazitäts-Check prüft zusätzlich einen groben Personal-Richtwert je Kran (Ampel, Standard-Obergrenze 13 Personen, einstellbar).",
      "Die Ertragsoptik vergleicht den kumulierten Ertrag mit den kumulierten Kosten.",
      "Alle Kran-Auswertungen sind Richtwerte zur Plausibilisierung, keine exakte Kalkulation.",
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
      <div style={{ background: "#fff", borderRadius: 8, overflow: "hidden", width: 720, maxWidth: "92vw", maxHeight: "85vh", display: "flex",
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
