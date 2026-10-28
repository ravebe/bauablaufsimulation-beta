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
      "Werkzeuge (🔧): \"Auto-Vorgänger\" verkettet Tasks und Gruppen der Reihenfolge nach, setzt aber nur bei Tasks ohne Vorgänger einen — bestehende bleiben erhalten. \"Folge-Tasks neu ausrichten\" richtet alle Nachfolger nach ihren Vorgängern aus. \"Berechnete Dauer übernehmen\" überträgt die Dauer aus Tab Kalkulation (orange Zahl am 🔧 = Anzahl Tasks, deren Termine davon abweichen). \"Auslastung optimieren\": Ist in Tab Ressourcen unter Kräne & Personal Personal erfasst, plant es die Tasks so, dass das Personal unter jedem Kran möglichst voll arbeitet — Leute desselben Unternehmers sind Allrounder und besetzen jede seiner kranpflichtigen Leistungspositionen (mindestens die Kolonne), freie Leute verstärken laufende Arbeiten bis zur doppelten Kolonne, je Kran höchstens Max. Personen; zuerst laufen die Tasks mit der längsten Restkette (kritischer Pfad). Ohne Kranpersonal bekommt jeder Task seine berechnete Dauer und jede Kolonne (Leistungsposition, z.B. Schalung · WB) arbeitet nie an zwei Tasks gleichzeitig: Tasks mit derselben Leistungsposition laufen nacheinander, andere Gewerke können überlappen (Wand B wird geschalt, während Wand A betoniert wird). In beiden Fällen gelten der Arbeitsablauf je Kürzel, Vorgänger und Wartetage; Tasks ohne Vorgänger beginnen frühestens an ihrem bisherigen Start. Vor dem Übernehmen zeigt eine Vorschau die Anzahl geänderter Tasks, das neue Bauende und die Ø Auslastung des Personals vorher/nachher.",
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
      "\"Berechnet\" folgt dem Arbeitsablauf je Kürzel (Tab Ressourcen): Schritte nacheinander, Positionen im selben Schritt gleichzeitig (es zählt die längste).",
      "Spalte \"Kräne\": einem Task lassen sich mehrere Kräne zuweisen (Schnittstellen-Task zwischen zwei Kränen) — der Anteil wird dabei immer automatisch gleichmässig verteilt (2 Kräne → je 50%), keine manuelle Eingabe. Kräne selbst werden in Tab Ressourcen unter \"Kräne & Personal\" angelegt.",
      "Alle Kran-Auswertungen (Kranoptik, Kranpersonal, Auslastung optimieren) richten sich nach der Spalte \"Kräne\".",
      "Export/Import (CSV oder JSON, im ⋮ rechts über der Tabelle) übertragen Kürzel/Kräne/Mengen aller Tasks, z.B. zum Bearbeiten in Excel.",
    ],
  },
  {
    key: "ressourcen", gruppe: "erweitert", label: "Ressourcen",
    zusammenfassung: "Pflege der Stammdaten: Kategorien/Gewerke mit Kürzeln, Leistungswerten, Kolonne, Einheitspreisen und Lohnansatz — Grundlage für Kalkulation, AVOR und Kosten.",
    punkte: [
      "Arbeitszeit (Beginn, Mittagspause, Ende) und Lohnansatz [CHF/h] gelten global für die gesamte Simulation. Aus der Arbeitszeit ergeben sich die Std./Tag (z.B. 07:00–12:00 / 13:00–16:30 = 8,5 h) — sie gelten überall: Kalkulation, Gantt-Uhrzeiten und Halbtage, Personal, Kran, Ertrag sowie MS-Project- und IFC-Export. Halbtage zählen nach echten Stunden (Vormittag 5 h ≠ Nachmittag 3,5 h).",
      "Einheitspreis [CHF/Einh.] je Kürzel = Ertrag (Preis an den Bauherrn je Einheit, z.B. Wandschalung 46.47 CHF/m²). Lohnansatz [CHF/h] = Lohnkosten je Personenstunde. Daraus in Tab Kosten und AVOR: Ertrag = Menge × Einheitspreis, Lohnkosten = Menge × Leistungswert × Lohnansatz, Marge = Ertrag − Lohnkosten.",
      "Kategorien lassen sich aus vorgefertigten Katalogen laden oder frei anlegen und umbenennen.",
      "\"kranpflichtig\" markiert je Kürzel, ob dessen Mengen in die Kranauslastung (Tab AVOR) einfließen und ob das Personal unter dem Kran diese Position besetzt.",
      "Kolonne [Pers.] = Mindestbesetzung einer Leistungsposition. Unternehmer = wer die Position ausführt (einmal eingetragene Unternehmer erscheinen als Vorschlag).",
      "Arbeitsablauf je Kürzel: Schritt je Leistungsposition — \"2\" = Schritt 2, \"1/3\" = je zur Hälfte in Schritt 1 und 3 (z.B. Wandschalung 1. Seite → Bewehrung → 2. Seite → Beton), \"1:60/3:40\" = 60 % / 40 %. Gleiche Schritte laufen gleichzeitig, leer = Reihenfolge der Kategorien. Gilt für berechnete Dauer, Personal je Tag und Optimierung.",
      "Kräne & Personal: je Kran Verfügbarkeit (von/bis) und Max. Personen (Richtwert, Standard 13 — alle Unternehmer an kranpflichtigen Kürzeln zusammen), darunter das Personal je Unternehmer und Zeitraum. Leute desselben Unternehmers unter einem Kran sind Allrounder und verstärken jede seiner Leistungspositionen an Tasks dieses Krans; verschiedene Unternehmer helfen sich nicht aus.",
      "Ein Kürzel darf innerhalb derselben Kategorie nur einmal vorkommen — bei Duplikaten zählt nur die erste Zeile.",
    ],
  },
  {
    key: "avor", gruppe: "erweitert", label: "AVOR",
    zusammenfassung: "Cockpit mit Personal- und Kranauslastung, Mengen-Filter je Gewerk über die Zeit — abgeleitet aus den Kalkulationsmengen und den Stammdaten.",
    punkte: [
      "Setzt Stammdaten (Ressourcen) sowie erfasste Mengen/Kürzel (Kalkulation) voraus, sonst bleibt die Ansicht leer.",
      "Kräne, ihre Verfügbarkeit und das Personal unter dem Kran werden in Tab Ressourcen unter \"Kräne & Personal\" erfasst.",
      "Grundlage aller Auswertungen ist der Aufwand je Task: Menge × Leistungswert (Personenstunden). Daraus folgen Personal (÷ Std./Tag), Lohnkosten (× Lohnansatz), Kranstunden (Aufwand der kranpflichtigen Gewerke ÷ Kolonne — eine Stütze mit 6 Personenstunden und 3er-Kolonne belegt den Kran 2 h, nicht den ganzen Tag) und der zeitliche Verlauf des Ertrags (Menge × Einheitspreis, verteilt wie der Aufwand).",
      "Die Kranoptik zeigt je Kran die geplanten Kranstunden gegen die verfügbare Kapazität, wahlweise je Monat oder Woche; Balken über der Kapazität sind rot markiert (Engpass). Erscheint erst, wenn Kräne angelegt und Tasks in Tab Kalkulation zugewiesen sind.",
      "Personalauslastung und Peak: Je Task arbeiten die Gewerke nach dem Arbeitsablauf je Kürzel (Tab Ressourcen), jedes so lange wie in Tab Kalkulation berechnet. Ist ein Task im Gantt länger oder kürzer als berechnet, wird die Kolonne entsprechend kleiner oder grösser (Personen = Kolonne × berechnete ÷ geplante Dauer) — die Personenstunden je Task entsprechen so immer genau Menge × Leistungswert. Gewerke ohne Leistungswert zählen nicht mit.",
      "Klick in ein Diagramm wählt einen Tag: Statt eines Tooltips stehen dessen Angaben dann fest über dem Diagramm (an Stelle der Legende) — Zeilen = Total und Gewerke/Linien mit Farbcode, Spalten = Angaben; × hebt die Auswahl auf. Personalauslastung: Personen, Arbeit [h] (Personenstunden), Eingeplant [Pers.], Dauer [h] (wie lange das eingeplante Personal für die Arbeit braucht) und Auslastung (Dauer ÷ Std./Tag). Dauer im Total: mit Kranpersonal Arbeit ÷ eingeplantes Personal (Allrounder je Unternehmer), sonst laufen die Schritte eines Tasks nacheinander (Dauern addiert) und verschiedene Tasks parallel (längste zählt). Mengen-Filter: Tagesleistung und Auslastung gegenüber der Optimal-Tagesleistung. Kranoptik: Bedarf, Kapazität und Auslastung je Kran im Monat/in der Woche des gewählten Tages. Eingeplant je Gewerk = Kolonnen seiner aktiven Leistungspositionen (je Position und Tag einmal), im Total = Kranpersonal + Kolonnen ohne Kran.",
      "Die grüne gestrichelte Linie \"Perfekte Auslastung\" zeigt das eingeplante Personal je Tag: das Personal unter allen an diesem Tag verfügbaren Kränen (Tab Ressourcen → Kräne & Personal, je Kran höchstens Max. Personen) plus die Kolonnen der Positionen, die nicht aus einem Kran-Pool besetzt werden (nicht kranpflichtig, Task ohne Kran). Ohne Kranpersonal sind es die Kolonnen. Liegt die Fläche darüber, ist das Personal überlastet, darunter nicht voll ausgelastet.",
      "⋮ oben rechts → Ansicht: \"Wochenenden ausblenden/einblenden\" gilt für alle Diagramme des Tabs. Standardmässig sind arbeitsfreie Samstage und Sonntage ausgeblendet; die Wochen trennt dann eine feine graue Linie (feiner als die Monatslinie). Feiertage bleiben grau hinterlegt.",
      "⋮ oben rechts → Export (CSV): Personalbedarf je Tag (Personen total, Stunden total, Personen je Gewerk und Stunden je Leistungsposition), Kranstunden je Kran, Mengen je Tag (aktuelle Auswahl im Mengen-Filter). Ertrag, Lohnkosten und Marge stehen in Tab Kosten.",
      "Alle Kran-Auswertungen sind Richtwerte zur Plausibilisierung, keine exakte Kalkulation.",
    ],
  },
  {
    key: "kosten", gruppe: "erweitert", label: "Kosten",
    zusammenfassung: "Rein lesende Auswertung von Ertrag (Menge × Einheitspreis), Lohnkosten (Personenstunden × Lohnansatz) und Marge je Gewerk und Kürzel.",
    punkte: [
      "Keine Eingabe in diesem Tab — Mengen/Kürzel werden in Kalkulation, Ansätze in Ressourcen gepflegt.",
      "Zeigt Ertrag, Lohnkosten und Marge (grün, negativ nach unten) je Gewerk sowie Ertrag, Lohnkosten und Marge kumuliert über die Zeit (Marge = Ertrag − Lohnkosten, kann anfangs negativ sein); die Tabelle unten je Kürzel mit Marge (negativ rot).",
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
