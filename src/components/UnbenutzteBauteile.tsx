// UnbenutzteBauteile.tsx — zu unterst in Tab Bauteile, wie Tasks: "Noch nicht verknüpft" (in keinem Task)
// und "Aus Simulation entfernt" (ausgeblendet, nicht gerechnet). Bauteile lassen sich hier aus der Simulation
// entfernen und wieder aufnehmen — Logik in ausschlussHelpers.ts, Ausblenden in useAusgeschlosseneAusblenden.
import { useEffect, useMemo, useState } from "react";
import type { SimProjekt } from "../types";
import type { ApiInstance } from "../hooks/useApi";
import { bauteileAusschliessen, bauteileWiederAufnehmen, unbenutzteListen } from "./ausschlussHelpers";
import { bekannteKlasse, guidsZuBatch, ladeObjektAttribute } from "./modelHelpers";
import type { ObjWerte } from "./modelHelpers";

export type UnbenutztArt = "offen" | "entfernt";

const LISTE_MAX = 300; // Namen werden nur für so viele geladen/angezeigt — bei grossen Modellen sonst zu langsam

/** Die zwei Zeilen am Ende der Task-Liste */
export function UnbenutzteZeilen({ sim, alleGuids, aktiv, onWaehlen }: {
  sim: SimProjekt; alleGuids: string[] | null; aktiv: UnbenutztArt | null; onWaehlen: (a: UnbenutztArt | null) => void;
}) {
  const { offen, entfernt } = unbenutzteListen(sim, alleGuids);
  const zeile = (art: UnbenutztArt, titel: string, anzahl: number | null, symbol: string) => (
    <div key={art} onClick={() => onWaehlen(aktiv === art ? null : art)}
      style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 8px", cursor: "pointer", fontSize: 11,
        borderTop: art === "offen" ? "2px solid var(--tc-border-light)" : undefined,
        background: aktiv === art ? "#e8f2fa" : undefined, borderLeft: aktiv === art ? "3px solid #2d7dbd" : "3px solid transparent",
        color: "var(--tc-text-2)", fontStyle: "italic" }}>
      <span style={{ width: 14, textAlign: "center", fontStyle: "normal" }}>{symbol}</span>
      <span style={{ flex: 1 }}>{titel}</span>
      <span style={{ color: "#8a9baa", fontStyle: "normal" }}>{anzahl === null ? "…" : `O ${anzahl}`}</span>
    </div>
  );
  return (
    <>
      {zeile("offen", "Noch nicht verknüpft", offen?.length ?? null, "○")}
      {zeile("entfernt", "Aus Simulation entfernt", entfernt.length, "⊘")}
    </>
  );
}

const anzeigeName = (w: ObjWerte | undefined, g: string) => {
  if (w) {
    // ladeObjektAttribute legt den Namen unter "Product||Product Name" ab
    for (const k of ["Product||Product Name", "Reference Object||Name", "Product||Name", "IFC||Name"]) if (w[k]) return w[k];
    const k = Object.keys(w).find(x => x.endsWith("||Name") && w[x]);
    if (k) return w[k];
  }
  return `Objekt ${g.split(":::")[1] ?? g}`;
};

/** Detail-Bereich (statt Task-Detail), wenn eine der zwei Zeilen gewählt ist */
export function UnbenutzteDetail({ api, sim, alleGuids, art, selGuids, readOnly, updateSim }: {
  api: ApiInstance | null; sim: SimProjekt; alleGuids: string[] | null; art: UnbenutztArt; selGuids: Set<string>;
  readOnly?: boolean; updateSim: (s: SimProjekt) => void;
}) {
  const listen = unbenutzteListen(sim, alleGuids);
  const guids = useMemo(() => (art === "offen" ? listen.offen ?? [] : listen.entfernt), [art, listen.offen, listen.entfernt]);
  const sichtbar = guids.slice(0, LISTE_MAX);
  const [werte, setWerte] = useState<Map<string, ObjWerte>>(new Map());
  const [meldung, setMeldung] = useState<string | null>(null);
  const markiertHier = guids.filter(g => selGuids.has(g));
  const markiertSonst = [...selGuids].filter(g => !new Set(sim.ausgeschlossen?.map(a => a.guid)).has(g));
  const schluessel = sichtbar.join("|");

  useEffect(() => {
    if (!api || sichtbar.length === 0) return;
    let abgebrochen = false;
    ladeObjektAttribute(api, sichtbar).then(w => { if (!abgebrochen) setWerte(w); }).catch(() => {});
    return () => { abgebrochen = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, schluessel]);

  async function markieren(liste: string[], einblenden = false) {
    if (!api || liste.length === 0) return;
    const batch = guidsZuBatch(liste);
    try {
      if (einblenden) await api.viewer.setObjectState({ modelObjectIds: batch }, { visible: true });
      await (api.viewer as unknown as { setSelection: (s: unknown, m: string) => Promise<void> }).setSelection({ modelObjectIds: batch }, "set");
    } catch { /* Viewer nicht bereit */ }
  }

  function entfernen(liste: string[]) {
    if (liste.length === 0) return;
    updateSim(bauteileAusschliessen(sim, liste));
    setMeldung(`✓ ${liste.length} Bauteil${liste.length === 1 ? "" : "e"} aus der Simulation entfernt (ausgeblendet, nicht gerechnet)`);
  }

  function aufnehmen(liste: string[]) {
    if (liste.length === 0) return;
    const r = bauteileWiederAufnehmen(sim, liste);
    updateSim(r.sim);
    const rest = liste.length - r.zurueckInTask;
    setMeldung(`✓ ${liste.length} wieder aufgenommen` + (r.zurueckInTask ? ` — ${r.zurueckInTask} zurück in ihren Task` : "") + (rest ? `, ${rest} unter „Noch nicht verknüpft“` : ""));
  }

  const knopf = { fontSize: 10, padding: "3px 8px" } as const;
  return (
    <div className="detail-section">
      <div className="detail-header">
        <span style={{ fontSize: 11, color: "#555", marginRight: 2 }}>{art === "offen" ? "○" : "⊘"}</span>
        <span className="detail-task-name">{art === "offen" ? "Noch nicht verknüpft" : "Aus Simulation entfernt"}</span>
        <span style={{ fontSize: 9, color: "var(--tc-blue)", fontWeight: 500 }}>⬡ {art === "offen" && !alleGuids ? "…" : guids.length}</span>
      </div>

      <div className="detail-block" style={{ fontSize: 10, color: "var(--tc-text-2)", lineHeight: 1.5 }}>
        {art === "offen"
          ? "Bauteile der Modelle, die noch keinem Task zugeordnet sind. Entfernte Bauteile werden beim Aktivieren der Simulation ausgeblendet und nirgends gerechnet."
          : "Diese Bauteile sind ausgeblendet und werden nicht gerechnet. Wieder aufgenommen kommen sie zurück in ihren bisherigen Task (falls es ihn noch gibt)."}
      </div>

      {meldung && <div className="alert ok" style={{ margin: "0 8px 6px", fontSize: 10 }}>{meldung}</div>}

      <div className="detail-block" style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
        {guids.length > 0 && (
          <button className="tc-btn-primary" style={knopf} onClick={() => markieren(guids, art === "entfernt")}
            title={art === "entfernt" ? "Kurz einblenden und markieren — beim nächsten Aktivieren wieder ausgeblendet" : "Im Modell markieren"}>
            👁 {art === "entfernt" ? "Einblenden & markieren" : "Markieren"}
          </button>
        )}
        {!readOnly && art === "offen" && (
          <button className="tc-btn-secondary" style={knopf} disabled={markiertSonst.length === 0}
            title="Im Modell markierte Bauteile aus der Simulation entfernen (auch solche, die schon in einem Task sind)"
            onClick={() => entfernen(markiertSonst)}>
            ⊘ Markierte entfernen{markiertSonst.length ? ` (${markiertSonst.length})` : ""}
          </button>
        )}
        {!readOnly && art === "offen" && guids.length > 0 && (
          <button className="tc-btn-ghost" style={knopf}
            onClick={() => { if (confirm(`Alle ${guids.length} noch nicht verknüpften Bauteile aus der Simulation entfernen?`)) entfernen(guids); }}>
            Alle entfernen
          </button>
        )}
        {!readOnly && art === "entfernt" && (
          <button className="tc-btn-secondary" style={knopf} disabled={markiertHier.length === 0} onClick={() => aufnehmen(markiertHier)}>
            ↩ Markierte aufnehmen{markiertHier.length ? ` (${markiertHier.length})` : ""}
          </button>
        )}
        {!readOnly && art === "entfernt" && guids.length > 0 && (
          <button className="tc-btn-ghost" style={knopf} onClick={() => aufnehmen(guids)}>↩ Alle wieder aufnehmen</button>
        )}
      </div>

      <div className="detail-block">
        {guids.length === 0 ? (
          <div style={{ fontSize: 11, color: "#8a9baa", padding: "4px 0" }}>
            {art === "offen" ? (alleGuids ? "Alle Bauteile sind einem Task zugeordnet oder entfernt." : "⟳ Bauteile werden gezählt …") : "Keine Bauteile entfernt."}
          </div>
        ) : (
          <div className="guid-list">
            {sichtbar.map(g => {
              const istSel = selGuids.has(g);
              return (
                <div key={g} className="guid-row" style={{ padding: "3px 8px", cursor: "pointer", background: istSel ? "#e8f2fa" : undefined,
                  borderLeft: istSel ? "3px solid #2d7dbd" : "3px solid transparent" }}
                  onClick={() => markieren([g], art === "entfernt")}>
                  <div style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11,
                    fontWeight: istSel ? 600 : 400, color: istSel ? "#2d7dbd" : "#555" }}>
                    {anzeigeName(werte.get(g), g)}
                    {(() => { const sep = g.indexOf(":::"); const k = bekannteKlasse(g.slice(0, sep), Number(g.slice(sep + 3)));
                      return k ? <span style={{ fontSize: 9, opacity: 0.5, marginLeft: 6 }}>{k}</span> : null; })()}
                  </div>
                  {!readOnly && (
                    <button className="guid-row-x" style={{ fontSize: 12 }}
                      title={art === "offen" ? "Aus Simulation entfernen" : "Wieder aufnehmen"}
                      onClick={e => { e.stopPropagation(); if (art === "offen") entfernen([g]); else aufnehmen([g]); }}>
                      {art === "offen" ? "⊘" : "↩"}
                    </button>
                  )}
                </div>
              );
            })}
            {guids.length > LISTE_MAX && (
              <div style={{ fontSize: 10, color: "#8a9baa", padding: "4px 8px" }}>… und {guids.length - LISTE_MAX} weitere (Aktionen oben gelten für alle)</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
