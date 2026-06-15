import { useState, useRef, useCallback, useEffect } from "react";
import type { SimProjekt, Task } from "../types";
import type { ApiInstance } from "../hooks/useApi";
import { formatDatum, parseDateUniversal } from "../types";
import { getEchteBauteile } from "./modelHelpers";

interface Props { api: ApiInstance | null; aktiveSim: SimProjekt | null; aktivesModellId: string | null; }

const FARBEN = { neubau: "#6cc07a", bestand: "#999999", abbruch: "#edb94c", temporaer: "#a0522d" };

function tagVonDatum(s: string, min: Date): number {
  const d = parseDateUniversal(s);
  if (!d) return 0;
  return Math.round((d.getTime() - min.getTime()) / 86400000);
}

function datumBeiTag(min: Date, tag: number): string {
  const d = new Date(min.getTime() + tag * 86400000);
  return d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export default function TabAbspielen({ api, aktiveSim, aktivesModellId }: Props) {
  const [sekProTag, setSekProTag] = useState(0.5);
  const [laeuft, setLaeuft] = useState(false);
  const [currentTag, setCurrentTag] = useState(0);
  const [status, setStatus] = useState<string | null>(null);
  const stopRef = useRef(false);
  const animRef = useRef<number | null>(null);
  const lastTimeRef = useRef(0);
  const currentTagRef = useRef(0);
  // Tracking: welche Tasks bereits gestartet/beendet wurden
  const gestartet = useRef(new Set<string>());
  const beendet = useRef(new Set<string>());
  // Selection polling
  const [selGuids, setSelGuids] = useState<Set<string>>(new Set());
  const selRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const modellIds = [...new Set([...(aktiveSim?.modelle.map(m => m.id) ?? []), ...(aktivesModellId ? [aktivesModellId] : [])])].filter(Boolean);

  // Alle Tasks mit gültigem Startdatum (aus ALLEN Modellen)
  const tasks = (aktiveSim?.tasks ?? []).filter(t => t.start && parseDateUniversal(t.start));

  const { minDate, maxDate, totalTage } = (() => {
    if (tasks.length === 0) return { minDate: null, maxDate: null, totalTage: 0 };
    const allDates: Date[] = [];
    for (const t of tasks) {
      const s = parseDateUniversal(t.start); if (s) allDates.push(s);
      const e = parseDateUniversal(t.end); if (e) allDates.push(e);
    }
    if (allDates.length === 0) return { minDate: null, maxDate: null, totalTage: 0 };
    const min = new Date(Math.min(...allDates.map(d => d.getTime())));
    const max = new Date(Math.max(...allDates.map(d => d.getTime())));
    return { minDate: min, maxDate: max, totalTage: Math.max(1, Math.round((max.getTime() - min.getTime()) / 86400000)) };
  })();

  useEffect(() => () => { if (animRef.current) cancelAnimationFrame(animRef.current); }, []);
  useEffect(() => { currentTagRef.current = currentTag; }, [currentTag]);

  // Selection polling
  useEffect(() => {
    if (!api) return;
    async function check() {
      try {
        const sel = await (api!.viewer as any).getSelection();
        const guids = new Set<string>();
        if (Array.isArray(sel)) for (const s of sel) { const mid = s?.modelId ?? ""; for (const rId of s?.objectRuntimeIds ?? []) guids.add(`${mid}:::${rId}`); }
        setSelGuids(guids);
      } catch { setSelGuids(new Set()); }
    }
    check(); selRef.current = setInterval(check, 1500);
    return () => { if (selRef.current) clearInterval(selRef.current); };
  }, [api]);

  // --- API Helpers ---
  function zuBatch(guids: string[]): { modelId: string; objectRuntimeIds: number[] }[] {
    const byModel = new Map<string, Set<number>>();
    for (const g of guids) {
      if (!g.includes(":::")) continue;
      const sep = g.indexOf(":::"); const mid = g.slice(0, sep); const rId = Number(g.slice(sep + 3));
      if (mid && !isNaN(rId)) { if (!byModel.has(mid)) byModel.set(mid, new Set()); byModel.get(mid)!.add(rId); }
    }
    return [...byModel.entries()].map(([modelId, rIds]) => ({ modelId, objectRuntimeIds: [...rIds] }));
  }

  async function setzeZustand(guids: string[], opts: { visible?: boolean; color?: string | null }) {
    if (!api || guids.length === 0) return;
    const batch = zuBatch(guids);
    if (batch.length === 0) return;
    try { await api.viewer.setObjectState({ modelObjectIds: batch } as any, opts as any); } catch {}
  }

  function setzeZustandAsync(guids: string[], opts: { visible?: boolean; color?: string | null }) {
    if (!api || guids.length === 0) return;
    const batch = zuBatch(guids); if (batch.length === 0) return;
    api.viewer.setObjectState({ modelObjectIds: batch } as any, opts as any).catch(() => {});
  }

  async function selektieren(guids: string[]) {
    if (!api || guids.length === 0) return;
    try { await (api.viewer as any).setSelection({ modelObjectIds: zuBatch(guids) }, "set"); } catch {}
  }

  function selektierenAsync(guids: string[]) {
    if (!api || guids.length === 0) return;
    (api!.viewer as any).setSelection({ modelObjectIds: zuBatch(guids) }, "set").catch(() => {});
  }

  // --- Ist Task aktiv bei Tag? ---
  function istAktiv(t: Task, tag: number): boolean {
    if (!minDate) return false;
    const s = tagVonDatum(t.start, minDate);
    const e = t.end ? tagVonDatum(t.end, minDate) : s;
    return tag >= s && tag <= e;
  }

  function istVorbei(t: Task, tag: number): boolean {
    if (!minDate) return false;
    const e = t.end ? tagVonDatum(t.end, minDate) : tagVonDatum(t.start, minDate);
    return tag > e;
  }

  // --- Startzustand ---
  async function startzustand() {
    if (!api || !aktiveSim) return;
    gestartet.current.clear(); beendet.current.clear();
    setStatus("⟳ Bereit machen…");

    // Alle Tasks der Simulation (nicht nur gefilterte)
    const alleTasks = aktiveSim.tasks;

    // Bestand grau einblenden
    for (const t of alleTasks) {
      if (t.typ === "bestand" && t.objektGuids.length > 0)
        await setzeZustand(t.objektGuids, { visible: true, color: FARBEN.bestand });
      else if ((t.typ === "abbruch" || t.typ === "temporaer") && t.objektGuids.length > 0)
        await setzeZustand(t.objektGuids, { visible: true });
    }
    setCurrentTag(0); currentTagRef.current = 0;
    setStatus("✓ Bereit");
  }

  // --- Zustand bei Tag aufbauen (Slider/Klick) ---
  async function zustandBeiTag(tag: number) {
    if (!api || !aktiveSim || !minDate) return;
    const alleSel: string[] = [];
    const alleTasks = aktiveSim.tasks;

    // Nicht-zugewiesene Blatt-Objekte ausblenden (nur echte Bauteile, keine Hierarchie)
    const alleZugewiesenen = new Set(alleTasks.flatMap(t => t.objektGuids));
    for (const modell of aktiveSim.modelle) {
      if (!modell.id) continue;
      try {
        const echteIds = await getEchteBauteile(api, aktiveSim.id, modell.id);
        const nichtZugewiesen = echteIds.filter(rId => !alleZugewiesenen.has(`${modell.id}:::${rId}`));
        if (nichtZugewiesen.length > 0) {
          await api.viewer.setObjectState(
            { modelObjectIds: [{ modelId: modell.id, objectRuntimeIds: nichtZugewiesen }] } as any,
            { visible: false } as any
          );
        }
      } catch {}
    }

    // Pro Task sichtbar/unsichtbar setzen
    for (const t of alleTasks) {
      if (t.objektGuids.length === 0) continue;
      const s = tagVonDatum(t.start, minDate);
      const e = t.end ? tagVonDatum(t.end, minDate) : s;

      if (t.typ === "neubau") {
        if (tag >= s) { await setzeZustand(t.objektGuids, { visible: true }); if (tag <= e) alleSel.push(...t.objektGuids); }
        else await setzeZustand(t.objektGuids, { visible: false });
      } else if (t.typ === "bestand") {
        await setzeZustand(t.objektGuids, { visible: true, color: FARBEN.bestand });
      } else if (t.typ === "abbruch") {
        if (tag > e) await setzeZustand(t.objektGuids, { visible: false });
        else { await setzeZustand(t.objektGuids, { visible: true }); if (tag >= s) await setzeZustand(t.objektGuids, { color: FARBEN.abbruch }); }
      } else if (t.typ === "temporaer") {
        if (tag > e) await setzeZustand(t.objektGuids, { visible: false });
        else await setzeZustand(t.objektGuids, { visible: true });
      }
    }
    if (alleSel.length > 0) await selektieren(alleSel);

    const aktive = alleTasks.filter(t => t.objektGuids.length > 0 && istAktiv(t, tag));
    if (aktive.length > 0) setStatus(aktive.map(t => `${t.typ === "neubau" ? "🟢" : t.typ === "abbruch" ? "🟡" : t.typ === "temporaer" ? "🟤" : "⚫"} ${t.name}`).join(", "));
  }

  // --- Pre-computed Events (sortiert nach Tag) ---
  const events = (() => {
    if (!minDate) return [] as { tag: number; taskId: string; type: "start" | "end" }[];
    const evts: { tag: number; taskId: string; type: "start" | "end" }[] = [];
    for (const t of tasks) {
      evts.push({ tag: tagVonDatum(t.start, minDate), taskId: t.id, type: "start" });
      if (t.end) evts.push({ tag: tagVonDatum(t.end, minDate), taskId: t.id, type: "end" });
    }
    return evts.sort((a, b) => a.tag - b.tag);
  })();

  const letzterEventTag = useRef(-1);

  // --- Playback: Nur bei Event-Grenzen API aufrufen ---
  function pruefeTaskEvents(tag: number) {
    if (!minDate || !api) return;

    // Prüfe ob wir eine neue Event-Grenze überschritten haben
    let neueEvents = false;
    for (const evt of events) {
      if (evt.tag > letzterEventTag.current && evt.tag <= tag) {
        neueEvents = true;
        break;
      }
    }
    if (!neueEvents && gestartet.current.size > 0) {
      letzterEventTag.current = tag;
      return; // Kein neues Event → nichts tun
    }
    letzterEventTag.current = tag;

    // Neue Events verarbeiten
    const showGuids: string[] = [];
    const hideGuids: string[] = [];
    const selGuidsLocal: string[] = [];
    let statusChanged = false;

    for (const t of tasks) {
      const s = tagVonDatum(t.start, minDate);
      const e = t.end ? tagVonDatum(t.end, minDate) : s;

      // Start-Event
      if (tag >= s && !gestartet.current.has(t.id)) {
        gestartet.current.add(t.id);
        statusChanged = true;
        if (t.typ === "neubau") {
          showGuids.push(...t.objektGuids);
        } else if (t.typ === "abbruch") {
          // Abbruch wird erst bei End-Event ausgeblendet
          setzeZustandAsync(t.objektGuids, { color: FARBEN.abbruch });
        } else if (t.typ === "temporaer") {
          selektierenAsync(t.objektGuids);
          setTimeout(() => { (api!.viewer as any).setSelection({ modelObjectIds: [] }, "set").catch(() => {}); }, 1000);
        }
      }

      // Neubau bleibt selektiert während aktiv
      if (t.typ === "neubau" && tag >= s && tag <= e) selGuidsLocal.push(...t.objektGuids);

      // End-Event
      if (tag > e && !beendet.current.has(t.id)) {
        beendet.current.add(t.id);
        statusChanged = true;
        if (t.typ === "abbruch") {
          hideGuids.push(...t.objektGuids);
        } else if (t.typ === "temporaer") {
          selektierenAsync(t.objektGuids);
          const batch = zuBatch(t.objektGuids); const viewer = api!.viewer;
          setTimeout(() => {
            viewer.setObjectState({ modelObjectIds: batch } as any, { visible: false } as any).catch(() => {});
          }, 1000);
        }
      }
    }

    // Gebatchte API-Calls (maximal 3 statt hunderte)
    if (showGuids.length > 0) setzeZustandAsync(showGuids, { visible: true });
    if (hideGuids.length > 0) setzeZustandAsync(hideGuids, { visible: false });
    if (statusChanged && selGuidsLocal.length > 0) selektierenAsync(selGuidsLocal);

    if (statusChanged) {
      const aktive = tasks.filter(t => istAktiv(t, tag));
      if (aktive.length > 0) setStatus(aktive.map(t => `${t.typ === "neubau" ? "🟢" : t.typ === "abbruch" ? "🟡" : t.typ === "temporaer" ? "🟤" : "⚫"} ${t.name}`).join(", "));
    }
  }

  // --- Playback ---
  const starten = useCallback(async () => {
    if (!api || !aktiveSim || laeuft || modellIds.length === 0 || tasks.length === 0) return;
    stopRef.current = false; setLaeuft(true);
    // Polling pausieren während Playback
    if (selRef.current) { clearInterval(selRef.current); selRef.current = null; }
    letzterEventTag.current = -1;
    if (currentTagRef.current <= 0) { await startzustand(); if (stopRef.current) { setLaeuft(false); return; } }
    lastTimeRef.current = performance.now();

    function frame(now: number) {
      if (stopRef.current) return;
      const delta = (now - lastTimeRef.current) / 1000;
      lastTimeRef.current = now;
      const tageProSek = sekProTag > 0 ? 1 / sekProTag : 1;
      const neuerTag = currentTagRef.current + delta * tageProSek;
      if (neuerTag >= totalTage) {
        setCurrentTag(totalTage); currentTagRef.current = totalTage;
        setLaeuft(false); setStatus("✓ Simulation abgeschlossen"); return;
      }
      setCurrentTag(neuerTag); currentTagRef.current = neuerTag;
      pruefeTaskEvents(neuerTag);
      animRef.current = requestAnimationFrame(frame);
    }
    animRef.current = requestAnimationFrame(frame);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, aktiveSim, laeuft, sekProTag, modellIds, tasks, totalTage]);

  function stoppen() {
    stopRef.current = true;
    if (animRef.current) { cancelAnimationFrame(animRef.current); animRef.current = null; }
    setLaeuft(false); setStatus("■ Gestoppt");
    // Polling wieder starten
    if (api && !selRef.current) {
      const check = async () => {
        try {
          const sel = await (api!.viewer as any).getSelection();
          const guids = new Set<string>();
          if (Array.isArray(sel)) for (const s of sel) { const mid = s?.modelId ?? ""; for (const rId of s?.objectRuntimeIds ?? []) guids.add(`${mid}:::${rId}`); }
          setSelGuids(guids);
        } catch { setSelGuids(new Set()); }
      };
      selRef.current = setInterval(check, 1500);
    }
  }

  async function sliderChange(tag: number) {
    if (laeuft) return;
    setCurrentTag(tag); currentTagRef.current = tag;
    gestartet.current.clear(); beendet.current.clear();
    tasks.forEach(t => { const s = tagVonDatum(t.start, minDate!); const e = t.end ? tagVonDatum(t.end, minDate!) : s; if (tag >= s) gestartet.current.add(t.id); if (tag > e) beendet.current.add(t.id); });
    await zustandBeiTag(tag);
  }

  async function zuTask(idx: number) {
    if (laeuft || idx < 0 || idx >= tasks.length || !minDate) return;
    const tag = tagVonDatum(tasks[idx].start, minDate);
    await sliderChange(tag);
  }

  async function reset() {
    if (!api) return; stoppen();
    setCurrentTag(0); currentTagRef.current = 0;
    gestartet.current.clear(); beendet.current.clear();
    try { await api.viewer.reset(); } catch {}
    try { await (api.viewer as any).setSelection({ modelObjectIds: [] }, "set"); } catch {}
    setStatus("↺ Reset");
  }

  if (!aktiveSim) return <div className="tc-empty"><div className="tc-empty-icon">▶</div><div className="tc-empty-title">Keine aktive Simulation</div></div>;

  const fortschritt = totalTage > 0 ? Math.round((currentTag / totalTage) * 100) : 0;
  const aktuellesDatum = minDate ? datumBeiTag(minDate, currentTag) : "";
  const dot = (typ: string) => ({ width: 8, height: 8, borderRadius: "50%" as const, display: "inline-block" as const, marginRight: 6, flexShrink: 0 as const,
    background: typ === "neubau" ? FARBEN.neubau : typ === "abbruch" ? FARBEN.abbruch : typ === "temporaer" ? FARBEN.temporaer : FARBEN.bestand });

  return (
    <div className="tc-setup-content">
      <div className="player-card">
        <div className="detail-block-title">Einstellungen</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11 }}>
          <span style={{ flex: 1, color: "var(--tc-text-2)" }}>Sekunden pro Tag</span>
          <input type="number" min={0.1} max={10} step={0.1} value={sekProTag}
            onChange={e => setSekProTag(Number(e.target.value))} disabled={laeuft} className="player-sek-input" />
        </div>
        <div style={{ fontSize: 9, color: "var(--tc-text-3)", marginTop: 3 }}>
          Gesamtdauer: ~{totalTage > 0 ? Math.round(totalTage * sekProTag) : 0}s für {totalTage} Tage
        </div>
      </div>

      <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
        {!laeuft ? (
          <button className="tc-btn-green" style={{ flex: 1 }} disabled={!api || tasks.length === 0} onClick={starten}>▶ Starten</button>
        ) : (
          <button className="tc-btn-danger" style={{ flex: 1 }} onClick={stoppen}>■ Stoppen</button>
        )}
        <button className="tc-btn-secondary" disabled={laeuft || !api} onClick={reset}>↺</button>
      </div>

      {totalTage > 0 && minDate && maxDate && (
        <div style={{ marginTop: 10 }}>
          <div style={{ textAlign: "center", fontSize: 13, fontWeight: 700, color: "var(--tc-text)", marginBottom: 4 }}>{aktuellesDatum}</div>
          <input type="range" min={0} max={totalTage} step={0.5} value={currentTag}
            onChange={e => sliderChange(Number(e.target.value))} disabled={laeuft} style={{ width: "100%" }} />
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: "var(--tc-text-3)" }}>
            <span>{formatDatum(minDate.toISOString().slice(0, 10))}</span>
            <span>{formatDatum(maxDate.toISOString().slice(0, 10))}</span>
          </div>
        </div>
      )}

      {(laeuft || currentTag > 0) && (
        <div className="player-card" style={{ marginTop: 6 }}>
          <div className="player-progress"><div className="player-progress-fill" style={{ width: `${fortschritt}%`, transition: laeuft ? "none" : "width 0.3s" }} /></div>
        </div>
      )}

      <div className="detail-block-title" style={{ marginTop: 8, marginBottom: 4 }}>Timeline ({tasks.length} Tasks)</div>
      <div className="player-card" style={{ padding: 0, overflow: "hidden", maxHeight: 400, overflowY: "auto" }}>
        {tasks.length === 0 ? (
          <div style={{ padding: 10, fontSize: 11, color: "var(--tc-text-3)", textAlign: "center" }}>Keine Tasks mit Bauteilen</div>
        ) : tasks.map((task, i) => {
          const aktiv = minDate ? istAktiv(task, currentTag) : false;
          const vorbei = minDate ? istVorbei(task, currentTag) : false;
          const hatSel = selGuids.size > 0 && task.objektGuids.some(g => selGuids.has(g));
          const selAnz = hatSel ? task.objektGuids.filter(g => selGuids.has(g)).length : 0;
          return (
            <div key={task.id} style={{
              display: "flex", alignItems: "center", padding: "5px 8px", gap: 6,
              borderBottom: "1px solid #eef1f4", cursor: laeuft ? "default" : "pointer",
              background: hatSel ? "#f0f0f0" : aktiv ? "#edf7ed" : "transparent",
              opacity: vorbei ? 0.5 : 1, fontWeight: aktiv || hatSel ? 600 : 400,
            }} onClick={() => zuTask(i)}>
              {aktiv && <span style={{ fontSize: 8, color: "#6cc07a" }}>▶</span>}
              <span style={dot(task.typ)} />
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12 }}>{task.name}</span>
              <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", flexShrink: 0, lineHeight: 1.2 }}>
                <span style={{ fontSize: 10, color: hatSel ? "#2d7dbd" : "#8a9baa" }}>
                  {hatSel ? `${selAnz}/${task.objektGuids.length}` : `⬡ ${task.objektGuids.length}`}
                </span>
                <span style={{ fontSize: 8, color: "#b0bec5" }}>{formatDatum(task.start)} – {formatDatum(task.end)}</span>
              </span>
            </div>
          );
        })}
      </div>

      <div style={{ padding: "8px 0", fontSize: 10, color: "var(--tc-text-3)", display: "flex", gap: 10, flexWrap: "wrap" }}>
        <span><span style={{ ...dot("neubau"), width: 6, height: 6, marginRight: 3 }} />Neubau</span>
        <span><span style={{ ...dot("bestand"), width: 6, height: 6, marginRight: 3 }} />Bestand</span>
        <span><span style={{ ...dot("abbruch"), width: 6, height: 6, marginRight: 3 }} />Abbruch</span>
        <span><span style={{ ...dot("temporaer"), width: 6, height: 6, marginRight: 3 }} />Temporär</span>
      </div>

      {status && (
        <div className={`alert ${status.startsWith("✓") ? "ok" : status.startsWith("■") ? "err" : "info"}`} style={{ marginTop: 8 }}>{status}</div>
      )}
    </div>
  );
}