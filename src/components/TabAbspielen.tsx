import { useState, useRef, useCallback } from "react";
import type { SimProjekt } from "../types";
import type { ApiInstance } from "../hooks/useApi";

interface Props {
  api: ApiInstance | null;
  aktiveSim: SimProjekt | null;
  aktivesModellId: string | null;
}

const FARBEN = { neubau: "#22C55E", bestand: "#EAB308", abbruch: "#EF4444" };

export default function TabAbspielen({ api, aktiveSim, aktivesModellId }: Props) {
  const [sekProTask, setSekProTask] = useState(3);
  const [laeuft, setLaeuft] = useState(false);
  const [aktivIndex, setAktivIndex] = useState(-1);
  const [status, setStatus] = useState<string | null>(null);
  const [bereit, setBereit] = useState(false); // Startzustand aufgebaut?
  const stopRef = useRef(false);

  const modellIds = [...new Set([
    ...(aktiveSim?.modelle.map(m => m.id) ?? []),
    ...(aktivesModellId ? [aktivesModellId] : [])
  ])].filter(Boolean);

  // Tasks sortiert nach Startdatum
  const sortiert = (aktiveSim?.tasks ?? [])
    .filter(t => t.objektGuids.length > 0)
    .sort((a, b) => (a.start ?? "").localeCompare(b.start ?? ""));

  function sleep(ms: number) {
    return new Promise<void>(resolve => setTimeout(resolve, ms));
  }

  // Guids → modelObjectIds Format
  function zuModelObjects(guids: string[]): { modelId: string; objectRuntimeIds: number[] }[] {
    const byModel = new Map<string, number[]>();
    for (const g of guids) {
      if (!g.includes(":::")) continue;
      const sep = g.indexOf(":::");
      const mid = g.slice(0, sep); const rId = Number(g.slice(sep + 3));
      if (mid && !isNaN(rId)) { if (!byModel.has(mid)) byModel.set(mid, []); byModel.get(mid)!.push(rId); }
    }
    return [...byModel.entries()].map(([modelId, rIds]) => ({ modelId, objectRuntimeIds: [...new Set(rIds)] }));
  }

  // Sichtbarkeit setzen
  async function sichtbarkeit(guids: string[], visible: boolean) {
    if (!api || guids.length === 0) return;
    const modelObjectIds = zuModelObjects(guids);
    for (const mo of modelObjectIds) {
      try {
        await api.viewer.setObjectState(
          { modelObjectIds: [mo] } as any,
          { visible } as any
        );
      } catch {}
    }
  }

  // Farbe setzen (null = entfernen)
  async function farbe(guids: string[], color: string | null) {
    if (!api || guids.length === 0) return;
    const modelObjectIds = zuModelObjects(guids);
    for (const mo of modelObjectIds) {
      try {
        await api.viewer.setObjectState(
          { modelObjectIds: [mo] } as any,
          { color } as any
        );
      } catch {}
    }
  }

  // Selektieren
  async function selektieren(guids: string[]) {
    if (!api || guids.length === 0) return;
    const modelObjectIds = zuModelObjects(guids);
    try { await (api.viewer as any).setSelection({ modelObjectIds }, "set"); } catch {}
  }

  // Startzustand aufbauen
  async function startzustand() {
    if (!api || !aktiveSim) return;
    setStatus("⟳ Startzustand aufbauen…");
    setAktivIndex(-1);

    // 1. Alles ausblenden
    for (const mid of modellIds) {
      try { await api.viewer.setObjectState({ modelObjectIds: [{ modelId: mid }] } as any, { visible: false, color: null } as any); } catch {}
    }
    try { await (api.viewer as any).setSelection({ modelObjectIds: [] }, "set"); } catch {}

    // 2. Bestand einblenden (steht schon)
    const bestandGuids = aktiveSim.tasks.filter(t => t.typ === "bestand").flatMap(t => t.objektGuids);
    if (bestandGuids.length > 0) await sichtbarkeit(bestandGuids, true);

    // 3. Abbruch einblenden (steht noch, wird erst später abgerissen)
    const abbruchGuids = aktiveSim.tasks.filter(t => t.typ === "abbruch").flatMap(t => t.objektGuids);
    if (abbruchGuids.length > 0) await sichtbarkeit(abbruchGuids, true);

    // Neubau bleibt ausgeblendet
    setBereit(true);
    setStatus("✓ Startzustand: Bestand + Abbruch sichtbar, Neubau ausgeblendet");
  }

  // Einen Task anwenden (Schritt vorwärts)
  async function taskAnwenden(index: number) {
    if (!api || index < 0 || index >= sortiert.length) return;
    const task = sortiert[index];
    const guids = task.objektGuids;
    setAktivIndex(index);

    if (task.typ === "neubau") {
      setStatus(`🟢 ${task.name} · ${guids.length} Bauteile werden gebaut`);
      await sichtbarkeit(guids, true);
      await farbe(guids, FARBEN.neubau);
      await selektieren(guids);
    } else if (task.typ === "abbruch") {
      setStatus(`🔴 ${task.name} · ${guids.length} Bauteile werden abgerissen`);
      await farbe(guids, FARBEN.abbruch);
      await selektieren(guids);
      await sleep(Math.max(800, sekProTask * 300));
      await sichtbarkeit(guids, false);
    } else {
      // bestand
      setStatus(`🟡 ${task.name} · ${guids.length} Bauteile (Bestand)`);
      await farbe(guids, FARBEN.bestand);
      await selektieren(guids);
    }
  }

  // Vorherigen Task-Farbe entfernen
  async function farbeEntfernen(index: number) {
    if (index < 0 || index >= sortiert.length) return;
    const task = sortiert[index];
    if (task.typ !== "abbruch") { // abbruch ist schon ausgeblendet
      await farbe(task.objektGuids, null);
    }
  }

  // Automatisch abspielen
  const starten = useCallback(async () => {
    if (!api || !aktiveSim || laeuft || modellIds.length === 0) return;
    stopRef.current = false;
    setLaeuft(true);

    // Startzustand aufbauen falls noch nicht geschehen
    if (!bereit) await startzustand();
    if (stopRef.current) { setLaeuft(false); return; }

    // Ab aktuellem Index oder von vorne
    const startIdx = aktivIndex >= 0 ? aktivIndex : 0;

    for (let i = startIdx; i < sortiert.length; i++) {
      if (stopRef.current) break;

      // Vorherige Farbe entfernen
      if (i > 0) await farbeEntfernen(i - 1);

      await taskAnwenden(i);
      await sleep(sekProTask * 1000);
    }

    // Letzte Farbe entfernen
    if (!stopRef.current && sortiert.length > 0) {
      await farbeEntfernen(sortiert.length - 1);
      setStatus("✓ Simulation abgeschlossen");
      setAktivIndex(-1);
    } else {
      setStatus("■ Gestoppt");
    }
    setLaeuft(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, aktiveSim, laeuft, sekProTask, modellIds, bereit, aktivIndex, sortiert]);

  function stoppen() {
    stopRef.current = true;
    setLaeuft(false);
    setStatus("■ Gestoppt");
  }

  // Schritt vor
  async function schrittVor() {
    if (laeuft) return;
    if (!bereit) await startzustand();
    const nextIdx = aktivIndex < 0 ? 0 : aktivIndex + 1;
    if (nextIdx >= sortiert.length) return;
    if (aktivIndex >= 0) await farbeEntfernen(aktivIndex);
    await taskAnwenden(nextIdx);
  }

  // Schritt zurück
  async function schrittZurueck() {
    if (laeuft || aktivIndex <= 0) return;
    const task = sortiert[aktivIndex];
    // Aktuellen Task rückgängig machen
    if (task.typ === "neubau") {
      await sichtbarkeit(task.objektGuids, false);
      await farbe(task.objektGuids, null);
    } else if (task.typ === "abbruch") {
      await sichtbarkeit(task.objektGuids, true);
      await farbe(task.objektGuids, null);
    } else {
      await farbe(task.objektGuids, null);
    }
    // Vorherigen Task hervorheben
    const prevIdx = aktivIndex - 1;
    await taskAnwenden(prevIdx);
  }

  // Slider — zu bestimmtem Index springen
  async function zuIndex(idx: number) {
    if (laeuft) return;
    // Startzustand aufbauen, dann alle Tasks bis idx anwenden
    await startzustand();
    for (let i = 0; i <= idx; i++) {
      const task = sortiert[i];
      if (task.typ === "neubau") {
        await sichtbarkeit(task.objektGuids, true);
      } else if (task.typ === "abbruch") {
        await sichtbarkeit(task.objektGuids, false);
      }
    }
    // Aktuellen Task farbig markieren
    if (idx >= 0 && idx < sortiert.length) {
      const task = sortiert[idx];
      if (task.typ !== "abbruch") await farbe(task.objektGuids, FARBEN[task.typ]);
      await selektieren(task.objektGuids);
      setAktivIndex(idx);
      setStatus(`▶ ${task.name}`);
    }
  }

  // Reset
  async function reset() {
    if (!api) return;
    setAktivIndex(-1); setBereit(false);
    setStatus("⟳ Reset…");
    try { await api.viewer.reset(); } catch {}
    try { await (api.viewer as any).setSelection({ modelObjectIds: [] }, "set"); } catch {}
    setStatus("↺ Alle Bauteile eingeblendet");
  }

  if (!aktiveSim) {
    return (
      <div className="tc-empty">
        <div className="tc-empty-icon">▶</div>
        <div className="tc-empty-title">Keine aktive Simulation</div>
        <div className="tc-empty-sub">Tab „Projekte" → Simulation aktivieren</div>
      </div>
    );
  }

  const fortschritt = aktivIndex >= 0 && sortiert.length > 0
    ? Math.round(((aktivIndex + 1) / sortiert.length) * 100) : 0;

  return (
    <div className="tc-setup-content">

      {/* Einstellungen */}
      <div className="player-card">
        <div className="detail-block-title">Einstellungen</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11 }}>
          <span style={{ flex: 1, color: "var(--tc-text-2)" }}>Sekunden pro Task</span>
          <input type="number" min={1} max={30} value={sekProTask}
            onChange={e => setSekProTask(Number(e.target.value))} disabled={laeuft}
            className="player-sek-input" />
        </div>
      </div>

      {/* Steuerung */}
      <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
        <button className="tc-btn-ghost" disabled={laeuft || aktivIndex <= 0}
          onClick={schrittZurueck} title="Schritt zurück">⏮</button>
        {!laeuft ? (
          <button className="tc-btn-green" style={{ flex: 1 }}
            disabled={!api || modellIds.length === 0 || sortiert.length === 0}
            onClick={starten}>▶ Starten</button>
        ) : (
          <button className="tc-btn-danger" style={{ flex: 1 }} onClick={stoppen}>■ Stoppen</button>
        )}
        <button className="tc-btn-ghost" disabled={laeuft || aktivIndex >= sortiert.length - 1}
          onClick={schrittVor} title="Schritt vor">⏭</button>
        <button className="tc-btn-secondary" disabled={laeuft || !api}
          onClick={reset} title="Reset">↺</button>
      </div>

      {/* Timeline-Slider */}
      {sortiert.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <input type="range" min={0} max={sortiert.length - 1} value={aktivIndex < 0 ? 0 : aktivIndex}
            onChange={e => zuIndex(Number(e.target.value))} disabled={laeuft}
            style={{ width: "100%" }} />
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: "var(--tc-text-3)" }}>
            <span>{sortiert[0]?.start ?? ""}</span>
            <span>{sortiert[sortiert.length - 1]?.start ?? ""}</span>
          </div>
        </div>
      )}

      {/* Fortschritt */}
      {(laeuft || aktivIndex >= 0) && (
        <div className="player-card" style={{ marginTop: 6 }}>
          <div className="player-progress">
            <div className="player-progress-fill" style={{ width: `${fortschritt}%` }} />
          </div>
          <div style={{ fontSize: 10, color: "var(--tc-blue)", textAlign: "center", fontWeight: 500 }}>
            Task {aktivIndex + 1} / {sortiert.length}
            {sortiert[aktivIndex] && ` · ${sortiert[aktivIndex].name}`}
          </div>
        </div>
      )}

      {/* Task-Liste */}
      <div className="detail-block-title" style={{ marginTop: 8, marginBottom: 4 }}>
        Tasks ({sortiert.length} mit Bauteilen)
      </div>
      <div className="player-card" style={{ padding: 0, overflow: "hidden" }}>
        {sortiert.length === 0 ? (
          <div style={{ padding: 10, fontSize: 11, color: "var(--tc-text-3)", textAlign: "center" }}>
            Keine Tasks mit Bauteilen — Tab „Bauteile" → Objekte zuweisen
          </div>
        ) : (
          sortiert.map((task, i) => {
            const istAktiv = aktivIndex === i;
            return (
              <div key={task.id}
                className={`player-task-row ${istAktiv ? "aktiv" : ""}`}
                style={{ cursor: laeuft ? "default" : "pointer" }}
                onClick={() => { if (!laeuft) zuIndex(i); }}>
                <span style={{ width: 14, fontSize: 10 }}>{istAktiv ? "▶" : ""}</span>
                <span className={`task-row-dot ${task.typ}`} />
                <span className="player-task-name">{task.name}</span>
                <span style={{ fontSize: 9, color: "var(--tc-text-3)" }}>{task.start}</span>
                <span className="task-row-count">
                  <span style={{ color: "var(--tc-blue)" }}>⬡ {task.objektGuids.length}</span>
                </span>
              </div>
            );
          })
        )}
      </div>

      {/* Legende */}
      <div className="player-legende">
        <div className="detail-block-title" style={{ marginBottom: 6 }}>Legende</div>
        <div className="legende-row"><span style={{ color: FARBEN.neubau }}>●</span><span>Neubau — Bauteile erscheinen</span></div>
        <div className="legende-row"><span style={{ color: FARBEN.bestand }}>●</span><span>Bestand — bleibt sichtbar</span></div>
        <div className="legende-row"><span style={{ color: FARBEN.abbruch }}>●</span><span>Abbruch — Bauteile verschwinden</span></div>
      </div>

      {modellIds.length === 0 && (
        <div className="alert err" style={{ marginTop: 8 }}>
          Kein Modell — Objekt im Viewer anklicken oder in Tab „Projekte" Modelle speichern
        </div>
      )}

      {status && (
        <div className={`alert ${status.startsWith("✓") ? "ok" : status.startsWith("■") || status.startsWith("!") ? "err" : "info"}`}
          style={{ marginTop: 8 }}>{status}</div>
      )}
    </div>
  );
}