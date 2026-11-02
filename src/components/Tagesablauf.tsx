// Tagesablauf.tsx — Tab AVOR → Personalauslastung, nach Klick auf einen Tag unter der Tabelle: wie die Arbeit dieses Tages abläuft.
// Je laufendem Task ein Balken über den Arbeitstag mit seinen Arbeiten zur jeweiligen Zeit (Gewerk, Personen, Stunden) aus dem
// Tagesplan (tagesplan.ts: Ablauf aus «Auslastung optimieren» bzw. derselbe Rechenkern) — derselbe wie die Spalte Dauer. Darunter die
// Tagesangaben und ein grauer Kasten "Erklärung & Optimierung", bewusst kurz: Kennzahlen in einer Zeile, Überstunden; überzieht der
// Tag, warum; ist das Personal nicht ausgelastet oder sind Tasks bereit, aber nicht dran, je Task der Grund (Kran voll, Personal
// ausgeschöpft, Kolonne, Vorgänger, Start) und nur die passenden Tipps (→). Alle Kästen lassen sich zuklappen.
import type { Task, Kran, UnternehmerPersonal } from "../types";
import { vorgaengerListe, istGruppe } from "../types";
import type { Stammdaten } from "./stammdatenHelpers";
import { hatKalkulationsWerte } from "./stammdatenHelpers";
import type { Kalender } from "./kalenderHelpers";
import { kranstundenJeTagFuerTask, aufwandJeTagFuerTask } from "./avorHelpers";
import type { Tagesplan, TagesplanPhase, BereitWartend } from "./tagesplan";
import { unternehmerLabel, bereitAberNichtDran, kranstundenImArbeitstag } from "./tagesplan";
import type { EingeplantTag } from "./kranHelpers";
import { kraeneDesTasks, istKranVerfuegbarAn } from "./kranHelpers";
import { endZeitpunkt, folgeStartZeitpunkt } from "./zeitHelpers";
import { fmtZahl } from "./zahlFormat";
import { UEBERSTUNDEN_ANTEIL } from "./ablaufKern";
import { FARBEN } from "./cockpitCharts";
import Hinweis from "./Hinweis";

const MAX_TASKS = 12;
const MAX_WARTENDE = 6;
/** Unter dieser Auslastung erklärt der Tagesablauf, was die übrigen Arbeiten zurückhält */
const AUSLASTUNG_HINWEIS = 0.9;

interface Props {
  iso: string; tasks: Task[]; stammdaten: Stammdaten; kalender: Kalender;
  farbeJeGewerk: Map<string, string>; eingeplant?: EingeplantTag; mitKranPersonal: boolean; kraene: Kran[];
  /** Personal je Unternehmer (Grenze bzw. wie Leistungsposition) — für «Bereit, aber heute nicht dran» */
  unternehmer?: UnternehmerPersonal[];
  /** Ablauf des Tages (tagesplan) — derselbe wie in der Spalte Dauer */
  plan: Tagesplan;
  /** Zugeklappt: Tagesablauf / Erklärung & Optimierung (in Tab AVOR je Projekt gemerkt) */
  zu: { ablauf: boolean; tabelle: boolean; erklaerung: boolean };
  /** Tagesangaben-Tabelle (aus dem Diagramm) — erscheint als zuklappbarer Kasten zwischen Tagesablauf und Erklärung */
  tabelle?: React.ReactNode;
  onToggle: (welcher: "ablauf" | "tabelle" | "erklaerung") => void;
}

const datumText = (iso: string) => iso.split("-").reverse().join(".");

/** Kopfzeile eines zuklappbaren Kastens: Dreieck + Titel, zugeklappt mit Kurzinfo daneben */
function KastenKopf({ titel, zu, onToggle, info, farbe }: { titel: string; zu: boolean; onToggle: () => void; info?: React.ReactNode; farbe?: string }) {
  return (
    <div onClick={onToggle} style={{ display: "flex", alignItems: "baseline", gap: 6, cursor: "pointer", userSelect: "none", marginBottom: zu ? 0 : 4 }}>
      <span style={{ display: "inline-block", transform: `scaleX(1.4) rotate(${zu ? -90 : 0}deg)`, transition: "transform .15s", fontSize: 8, color: FARBEN.textMuted }}>▼</span>
      <span style={{ fontWeight: 600, color: farbe ?? FARBEN.textPrimaer }}>{titel}</span>
      {zu && info && <span style={{ color: FARBEN.textSekundaer }}>{info}</span>}
    </div>
  );
}

/** Warum laufen am Tag iso nicht mehr Arbeiten? Kranzeit je Kran und die nächsten Tasks, die noch nicht begonnen haben, mit dem
 *  Grund aus dem Gantt: letzter Vorgänger (+ Wartetage), Start ohne Vorgänger, oder bereit (dann hält Personal/Kranzeit/Reihenfolge
 *  sie zurück). */
function wartegruende(iso: string, tasks: Task[], stammdaten: Stammdaten, kalender: Kalender, kraene: Kran[]) {
  const std = stammdaten.arbeitszeitStdProTag;
  const byId = new Map(tasks.map(t => [t.id, t]));
  // Kranzeit des Tages je Kran (wie Kranoptik: auf die verfügbaren Kräne des Tasks verteilt)
  const kranBelegt = new Map<string, { stunden: number; tasks: string[] }>();
  for (const t of tasks) {
    const h = kranstundenJeTagFuerTask(t, stammdaten, kalender).get(iso);
    if (!h) continue;
    const ids = kraeneDesTasks(t, kraene).filter(id => { const k = kraene.find(x => x.id === id); return !!k && istKranVerfuegbarAn(k, iso); });
    for (const id of ids) {
      const e = kranBelegt.get(id) ?? { stunden: 0, tasks: [] };
      e.stunden += h / ids.length; e.tasks.push(t.name);
      kranBelegt.set(id, e);
    }
  }
  const kranVoll = [...kranBelegt].filter(([, e]) => e.stunden >= std * 0.9)
    .map(([id, e]) => ({ name: kraene.find(k => k.id === id)?.name ?? "Kran", stunden: e.stunden, tasks: e.tasks }));

  // nächste noch nicht begonnene Tasks mit Arbeit
  const wartend = tasks.filter((t, i) => !t.isGroup && !istGruppe(tasks, i) && !t.meilenstein && t.start > iso && hatKalkulationsWerte(t, stammdaten))
    .sort((a, b) => a.start.localeCompare(b.start)).slice(0, MAX_WARTENDE)
    .map(t => {
      let spaetester: { name: string; ab: string; lag: number; ende: string } | null = null;
      for (const v of vorgaengerListe(t)) {
        const vt = byId.get(v.id);
        if (!vt?.end) continue;
        const ab = folgeStartZeitpunkt(endZeitpunkt(vt), v.lagDays, kalender).datum;
        if (!spaetester || ab > spaetester.ab) spaetester = { name: vt.name, ab, lag: v.lagDays, ende: vt.end };
      }
      const art: "vorgaenger" | "start" | "bereit" = spaetester && spaetester.ab > iso ? "vorgaenger" : vorgaengerListe(t).length === 0 ? "start" : "bereit";
      const text = art === "vorgaenger" && spaetester
        ? `wartet auf «${spaetester.name}» (Ende ${datumText(spaetester.ende)}${spaetester.lag ? ", +" + spaetester.lag + " Wartetage" : ""})`
        : art === "start" ? `beginnt laut Gantt erst am ${datumText(t.start)} (ohne Vorgänger)`
        : `Vorgänger fertig — könnte schon laufen, beginnt laut Gantt am ${datumText(t.start)}`;
      return { t, art, text };
    });
  return { kranVoll, wartend };
}

export default function Tagesablauf({ iso, tasks, stammdaten, kalender, farbeJeGewerk, eingeplant, mitKranPersonal, kraene, unternehmer, plan, zu, tabelle, onToggle }: Props) {
  const std = stammdaten.arbeitszeitStdProTag;
  const gewerkLabel = new Map(stammdaten.gewerke.map(g => [g.key, g.label]));
  const zeilen = plan.tasks;
  // Kranzeit des Tages je Kran (im Arbeitstag, aus dem Ablauf) — Zeile unter den Tagesangaben
  const kranZeit = [...kranstundenImArbeitstag(plan, std)].filter(([, h]) => h > 1e-6)
    .map(([id, h]) => ({ id, name: kraene.find(k => k.id === id)?.name ?? "Kran", h }));
  const tabellenKasten = tabelle && (
    <div style={{ margin: "0 0 6px", padding: "8px 10px", background: "#fff", border: `1px solid ${FARBEN.gridline}`, fontSize: 11 }}>
      <KastenKopf titel={`Tagesangaben ${iso.split("-").reverse().join(".")}`} zu={zu.tabelle} onToggle={() => onToggle("tabelle")}
        info={<>— Arbeit, Im Einsatz, Eingeplant, Frei, Dauer und Auslastung je Gewerk{kranZeit.length > 0 ? ", Kranzeit" : ""}</>} />
      {!zu.tabelle && <div style={{ marginTop: 4 }}>{tabelle}</div>}
      {!zu.tabelle && kranZeit.map(k => (
        <div key={k.id} style={{ marginTop: 4, display: "flex", gap: 8, alignItems: "baseline" }}
          title="Kranzeit = Leute ÷ Min. Personen × Kranzeit % (Tab Ressourcen, leer = 100 %), über den Arbeitstag summiert. Bei 100 % passt keine weitere kranpflichtige Arbeit unter den Kran — auch wenn Personal frei ist.">
          <strong>{k.name}:</strong>
          <span>Kranzeit {fmtZahl(k.h)} h von {fmtZahl(std)} h belegt</span>
          <strong style={{ color: k.h >= std * 0.9 ? FARBEN.status.critical : FARBEN.textPrimaer }}>{fmtZahl(k.h / std * 100)} %</strong>
        </div>
      ))}
    </div>
  );
  if (zeilen.length === 0) return tabellenKasten || null;

  const arbeit = plan.arbeit;
  const skala = Math.max(std, plan.dauer); // Balkenbreite: Arbeitstag, oder länger, wenn die Arbeit überzieht
  const sichtbar = zeilen.slice(0, MAX_TASKS);
  const datum = iso.split("-").reverse().join(".");
  const ueberzogen = plan.dauer > std + 1e-6;
  const ueberU = [...plan.ueberstunden.jeUnternehmer].filter(([, h]) => h > 1e-6).sort((a, b) => b[1] - a[1]);
  const ueberK = [...plan.ueberstunden.jeKran].filter(([, h]) => h > 1e-6).sort((a, b) => b[1] - a[1]);
  const kranName = (id: string) => kraene.find(k => k.id === id)?.name ?? "Kran";
  const veraltet = zeilen.filter(z => z.quelle === "veraltet");

  const auslastung = eingeplant && eingeplant.total > 0 ? arbeit / std / eingeplant.total : null;
  const zuWenigArbeit = auslastung != null && auslastung < AUSLASTUNG_HINWEIS;
  const gruende = ueberzogen || zuWenigArbeit ? wartegruende(iso, tasks, stammdaten, kalender, kraene) : null;
  // bereit (Vorgänger fertig), arbeitet heute aber nicht — mit Grund (Kran, Personal, Kolonne), unten in «Erklärung & Optimierung»
  const bereit = bereitAberNichtDran(iso, tasks, plan, stammdaten, kalender, kraene, unternehmer);

  return (<>
    <div style={{ margin: "6px 0 6px", padding: "8px 10px", background: "#fafbfc", border: `1px solid ${FARBEN.gridline}`, fontSize: 11 }}>
      <KastenKopf titel={`Tagesablauf ${datum}`} zu={zu.ablauf} onToggle={() => onToggle("ablauf")}
        info={<>— {zeilen.length} Task{zeilen.length === 1 ? "" : "s"}, fertig nach {fmtZahl(plan.dauer)} h
          {ueberzogen && <span style={{ color: FARBEN.status.critical, fontWeight: 600 }}> ({fmtZahl(plan.dauer - std)} h nach Arbeitsende)</span>}</>} />
      {!zu.ablauf && (<>
        <div style={{ color: FARBEN.textSekundaer, marginBottom: 6, lineHeight: 1.5, display: "flex", flexWrap: "wrap", alignItems: "center", gap: "2px 6px" }}>
          <span>{veraltet.length === 0 && zeilen.every(z => z.quelle === "optimiert")
            ? "Ablauf aus «Auslastung optimieren» — genau so geplant."
            : zeilen.some(z => z.quelle === "optimiert")
            ? "Tasks aus «Auslastung optimieren» genau so wie dort geplant, die übrigen mit denselben Regeln auf das freie Personal verteilt."
            : "Noch nicht optimiert: die Arbeit jedes Tasks ist gleichmässig auf seine Tage im Gantt verteilt."}</span>
          <Hinweis inZeile>
            Die Arbeit des Tages laut Gantt, verteilt auf das Personal: {mitKranPersonal
              ? "das Personal unter dem Kran arbeitet als Team (Allrounder) — jede Arbeit mindestens mit ihren Min. Personen, freie Leute verstärken bis aufs Doppelte; ohne Kran je Gewerk + Unternehmer eine Kolonne mit den Min. Personen der jeweiligen Arbeit, die von Arbeit zu Arbeit geht."
              : "je Gewerk + Unternehmer eine Kolonne mit den Min. Personen der jeweiligen Arbeit, immer nur an einer Arbeit gleichzeitig — sie geht von Arbeit zu Arbeit."}
            {" "}Kranpflichtige Arbeiten gehen nur so schnell, wie der Kran nachkommt (Kranzeit %). Schritte eines Tasks nacheinander. Balken = {fmtZahl(std)} h Arbeitstag.
          </Hinweis>
        </div>
        {veraltet.length > 0 && (
          <div style={{ marginBottom: 6, padding: "4px 8px", background: "#fff6e0", border: `1px solid ${FARBEN.status.warning}`, color: "#6b4a00", lineHeight: 1.5 }}>
            ⚠ {veraltet.length === 1 ? `«${veraltet[0].t.name}» wurde` : `${veraltet.length} Tasks wurden`} seit «Auslastung optimieren» geändert
            (Termine, Mengen, Tab Ressourcen oder Kräne & Personal) — die Arbeit ist darum gleichmässig auf die Tage im Gantt verteilt und
            hier neu gerechnet. Für einen passenden Ablauf neu optimieren: Tab Bauteile → Werkzeuge → «Auslastung optimieren».
          </div>
        )}
        {sichtbar.map(z => {
          // parallele Arbeiten eines Tasks übereinander (Spuren)
          const spuren: TagesplanPhase[][] = [];
          for (const p of [...z.phasen].sort((a, b) => a.von - b.von)) {
            const spur = spuren.find(s => s[s.length - 1].bis <= p.von + 1e-6);
            if (spur) spur.push(p); else spuren.push([p]);
          }
          const hoehe = 18;
          return (
            <div key={z.t.id} style={{ display: "grid", gridTemplateColumns: "minmax(110px, 180px) 1fr 64px", alignItems: "center", columnGap: 8, marginBottom: 3 }}>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: FARBEN.textPrimaer }}
                title={`${z.t.name}\n${z.quelle === "optimiert" ? "Ablauf aus «Auslastung optimieren»" : z.quelle === "veraltet" ? "Seit «Auslastung optimieren» geändert — gleichmässig verteilt, neu gerechnet" : "Nicht optimiert — gleichmässig auf seine Tage im Gantt verteilt"}`}>
                {z.quelle === "veraltet" && <span style={{ color: FARBEN.status.warning }}>⚠ </span>}{z.t.name}</span>
              <div style={{ position: "relative", height: hoehe, background: "#eef1f4" }}>
                {ueberzogen && <div style={{ position: "absolute", left: `${std / skala * 100}%`, top: -3, bottom: -3, borderLeft: `2px solid ${FARBEN.status.critical}` }}
                  title={`Arbeitsende (${fmtZahl(std)} h)`} />}
                {/* je Arbeitsstück ein Abschnitt mit seiner Besetzung — ändert sich die Zahl der Leute, beginnt ein neuer Abschnitt */}
                {spuren.map((spur, si) => spur.map((p, pi) => (p.stuecke.length ? p.stuecke : [{ von: p.von, bis: p.bis, leute: p.personen, kran: p.kranBegrenzt }]).map((s, ki) => (
                  <div key={`${si}-${pi}-${ki}`}
                    title={`${gewerkLabel.get(p.gewerkKey) ?? p.gewerkKey} · ${p.kuerzel}: ${fmtZahl(s.leute)} Personen, ${fmtZahl(s.von)}–${fmtZahl(s.bis)} h nach Arbeitsbeginn${s.kran ? " — durch die Kranzeit begrenzt (mehr Leute wären frei)" : ""}\nGanzer Tag: ${fmtZahl(p.arbeit)} Personenstunden, Min. ${fmtZahl(p.minPersonen)} Personen${p.unterKran ? ", Personal unter dem Kran" : ""}`}
                    style={{ position: "absolute", left: `${s.von / skala * 100}%`, width: `${Math.max(s.bis - s.von, 0.05) / skala * 100}%`,
                      top: si * hoehe / spuren.length, height: hoehe / spuren.length, background: farbeJeGewerk.get(p.gewerkKey) ?? FARBEN.andere,
                      borderRight: "1px solid #fff", color: "#fff", fontSize: 9, lineHeight: `${hoehe / spuren.length}px`, overflow: "hidden", whiteSpace: "nowrap", paddingLeft: 3,
                      backgroundImage: s.kran ? "repeating-linear-gradient(135deg, rgba(255,255,255,.25) 0 4px, transparent 4px 8px)" : undefined }}>
                    {spuren.length === 1 ? `${fmtZahl(s.leute)} P · ${fmtZahl(s.bis - s.von)} h${s.kran ? " · Kran" : ""}` : ""}
                  </div>
                ))))}
              </div>
              <span style={{ textAlign: "right", fontWeight: z.bis > std + 1e-6 ? 700 : 400, color: z.bis > std + 1e-6 ? FARBEN.status.critical : FARBEN.textSekundaer }}
                title={z.bis > std + 1e-6 ? "Fertig erst nach Arbeitsende — die Arbeit dieses Tages ist in der normalen Arbeitszeit nicht zu schaffen" : "Fertig nach so vielen Stunden ab Arbeitsbeginn"}>
                bis {fmtZahl(z.bis)} h</span>
            </div>
          );
        })}
        {zeilen.length > MAX_TASKS && <div style={{ color: FARBEN.textMuted }}>… und {zeilen.length - MAX_TASKS} weitere Tasks</div>}
      </>)}
    </div>
    {tabellenKasten}
    <div style={{ margin: "0 0 10px", padding: "8px 10px", background: "#eceef0", border: "1px solid #d6dade", fontSize: 11, color: FARBEN.textSekundaer, lineHeight: 1.6 }}>
      <KastenKopf titel="Erklärung & Optimierung" zu={zu.erklaerung} onToggle={() => onToggle("erklaerung")}
        info={<>— {["Kennzahlen", ueberzogen && "Überzug", zuWenigArbeit && `Auslastung ${fmtZahl(auslastung! * 100)} %`, bereit.length > 0 && `${bereit.length}${bereit.length >= MAX_WARTENDE ? "+" : ""} bereit, nicht dran`].filter(Boolean).join(" · ")}</>} />
      {!zu.erklaerung && (<>
        {/* Kennzahlen des Tages in einer Zeile (die Spalten der Tagesangaben) */}
        <div style={{ marginTop: 4 }}>
          Arbeit <strong>{fmtZahl(arbeit)} h</strong> · Im Einsatz max. <strong>{fmtZahl(plan.imEinsatz.anzahl)} P</strong>
          {eingeplant && <> · Eingeplant <strong>{fmtZahl(eingeplant.total)} P</strong>
            {mitKranPersonal && eingeplant.kolonnen > 0 ? ` (${fmtZahl(eingeplant.kranPersonal)} unter Kran + ${fmtZahl(eingeplant.kolonnen)} ohne)` : ""}
            , davon {fmtZahl(Math.max(0, eingeplant.total - plan.imEinsatz.anzahl))} nie im Einsatz · Auslastung <strong>{fmtZahl(auslastung! * 100)} %</strong></>}
          {" "}· <span style={{ color: ueberzogen ? FARBEN.status.critical : undefined, fontWeight: ueberzogen ? 600 : undefined }}>fertig nach {fmtZahl(plan.dauer)} h</span>
          {kranZeit.map(k => <span key={k.id}> · {k.name} {fmtZahl(k.h / std * 100)} %</span>)}
        </div>
        {(ueberU.length > 0 || ueberK.length > 0) && (
          <div style={{ color: FARBEN.status.critical }}>Überstunden: {[...ueberU.map(([u, h]) => `${unternehmerLabel(u)} ${fmtZahl(h)} h`), ...ueberK.map(([id, h]) => `${kranName(id)} ${fmtZahl(h)} Kran-h`)].join(", ")}</div>
        )}
        {ueberzogen && gruende && <Ueberzug plan={plan} std={std} tasks={tasks} stammdaten={stammdaten} kalender={kalender}
          kranUeber={gruende.kranVoll.filter(k => k.stunden > std + 1e-6)} />}
        {(zuWenigArbeit || bereit.length > 0) && (
          <Wartende bereit={bereit} wartend={zuWenigArbeit ? gruende?.wartend ?? [] : []} kranVoll={zuWenigArbeit ? kranZeit.filter(k => k.h >= std * 0.9) : []}
            titel={zuWenigArbeit ? `Warum nur ${fmtZahl(auslastung! * 100)} % ausgelastet?` : "Bereit, aber heute nicht dran"} std={std} kraene={kraene} />
        )}
      </>)}
    </div>
  </>);
}

const abschnitt: React.CSSProperties = { marginTop: 6, paddingTop: 4, borderTop: "1px solid #d6dade" };
const tipp: React.CSSProperties = { color: FARBEN.textPrimaer };

/** Warum Personal frei bleibt bzw. bereite Tasks nicht arbeiten — kurz: voller Kran, je bereitem Task der Grund, die nächsten
 *  wartenden Tasks, darunter nur die passenden Tipps (→). */
function Wartende({ bereit, wartend, kranVoll, titel, std, kraene }: {
  bereit: BereitWartend[]; wartend: ReturnType<typeof wartegruende>["wartend"]; kranVoll: { id: string; name: string; h: number }[];
  titel: string; std: number; kraene: Kran[];
}) {
  const kranNamen = (ids: string[]) => ids.map(id => kraene.find(k => k.id === id)?.name ?? "Kran").join(", ") || "Kran";
  const grundText = (b: BereitWartend) => b.grund === "kran" ? `${kranNamen(b.kranIds)} voll`
    : b.grund === "personal" ? "Personal ausgeschöpft"
    : b.grund === "kolonne" ? "Kolonne an anderer Arbeit"
    : b.grund === "wechselnd" ? "Kran und Personal belegt"
    : "Kran und Personal wären frei";
  // nächste Tasks, die noch auf Vorgänger oder ihr Startdatum warten (bereite stehen schon oben)
  const bereitIds = new Set(bereit.map(b => b.t.id));
  const weitere = wartend.filter(w => w.art !== "bereit" && !bereitIds.has(w.t.id)).slice(0, 3);
  const leer = [...new Set(bereit.flatMap(b => b.kranzeitLeer))];
  const grund = new Set(bereit.map(b => b.grund));
  return (
    <div style={abschnitt}>
      <div style={{ fontWeight: 600, color: "#8a5a00" }}>{titel}</div>
      {kranVoll.map(k => <div key={k.id}>• {k.name} voll: {fmtZahl(k.h)} von {fmtZahl(std)} h Kranzeit belegt</div>)}
      {bereit.map(b => (
        <div key={b.t.id}>• {b.t.name}: bereit seit {datumText(b.bereitSeit)} — <strong>{grundText(b)}</strong>
          {b.autoVorgaenger.length > 0 && <span title="Beim letzten «Auslastung optimieren» ergänzter Vorgänger (blau): der Task musste auf freies Personal/Kran warten"> (wartet auf «{b.autoVorgaenger.map(v => v.name).join("», «")}»)</span>}</div>
      ))}
      {weitere.map(w => <div key={w.t.id}>• {w.t.name}: {w.art === "start" ? `Start laut Gantt ${datumText(w.t.start)}` : w.text}</div>)}
      {bereit.length === 0 && weitere.length === 0 && kranVoll.length === 0 && <div>• Keine weitere Arbeit bereit.</div>}
      {leer.length > 0 && <div style={tipp}>→ Kranzeit % eintragen (leer = 100 %): {leer.join(", ")}</div>}
      {(grund.has("kran") || grund.has("wechselnd")) && <div style={tipp}>→ Wer zuerst an den Kran darf: Tab Ressourcen → Bauablauf → 2.</div>}
      {grund.has("personal") && <div style={tipp}>→ Mehr Personal: Tab Ressourcen → Kräne & Personal</div>}
      {(grund.has("frei") || weitere.some(w => w.art === "start")) && <div style={tipp}>→ «Auslastung optimieren» ausführen</div>}
      {weitere.some(w => w.art === "vorgaenger") && <div style={tipp}>→ Vorgänger und Wartetage prüfen</div>}
      {kranVoll.length > 0 && bereit.length === 0 && <div style={tipp}>→ Kran ist der Engpass: weniger Personal unter dem Kran oder zweiter Kran</div>}
    </div>
  );
}

/** Warum die Arbeit des Tages erst nach Arbeitsende fertig wird — kurz: so optimiert (Rest ≤ UEBERSTUNDEN_ANTEIL), Kran überbelegt,
 *  je nicht optimiertem Task sein Anteil heute und wann er anfangen kann. */
function Ueberzug({ plan, std, tasks, stammdaten, kalender, kranUeber }: {
  plan: Tagesplan; std: number; tasks: Task[]; stammdaten: Stammdaten; kalender: Kalender;
  kranUeber: { name: string; stunden: number; tasks: string[] }[];
}) {
  const spaet = plan.tasks.filter(z => z.bis > std + 1e-6);
  const geplant = spaet.filter(z => z.quelle === "optimiert");
  const ungeplant = spaet.filter(z => z.quelle !== "optimiert");
  const byId = new Map(tasks.map(t => [t.id, t]));
  return (
    <div style={abschnitt}>
      <div style={{ fontWeight: 600, color: FARBEN.status.critical }}>Warum erst nach {fmtZahl(plan.dauer)} h fertig?</div>
      {geplant.length > 0 && (
        <div>• {geplant.map(z => z.t.name).join(", ")}: Rest ≤ {fmtZahl(UEBERSTUNDEN_ANTEIL * 100)} % — so optimiert, heute in Überstunden statt einen Tag mehr</div>
      )}
      {kranUeber.map(k => <div key={k.name}>• {k.name} überbelegt: {fmtZahl(k.stunden)} h Kranzeit für {fmtZahl(std)} h Arbeitstag</div>)}
      {ungeplant.map(z => {
        const t = byId.get(z.t.id) ?? z.t;
        let total = 0;
        for (const a of aufwandJeTagFuerTask(t, stammdaten, kalender).values()) for (const h of Object.values(a)) total += h;
        return (
          <div key={z.t.id} title="Nicht (mehr) optimiert: die Arbeit ist gleichmässig auf die Tage des Tasks im Gantt verteilt">
            • {z.t.name}: heute {fmtZahl(z.arbeit)} h{total > 0 ? ` (${fmtZahl(z.arbeit / total * 100)} % des Tasks)` : ""}
            {z.von > 0.01 ? `, Start erst nach ${fmtZahl(z.von)} h (Kran/Personal belegt)` : ""} → fertig nach {fmtZahl(z.bis)} h
          </div>
        );
      })}
      {ungeplant.length > 0 && <div style={tipp}>→ «Auslastung optimieren»: verteilt die Arbeit auf mehrere Tage</div>}
      {kranUeber.length > 0 && <div style={tipp}>→ Kranzeit % prüfen oder zweiten Kran einplanen</div>}
    </div>
  );
}
