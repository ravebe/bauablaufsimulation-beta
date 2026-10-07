// FehlerGrenze.tsx — React Error Boundary: ein Fehler beim Anzeigen eines Tabs/Dialogs legt nicht mehr
// die ganze Extension lahm (weisse Seite), sondern zeigt nur in diesem Bereich eine Meldung mit
// "Erneut versuchen". Daten und Cloud-Sync (in App.tsx) laufen unabhängig davon weiter.
import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";

interface Props {
  bereich: string; // z.B. "Tab Projekte" — erscheint in der Meldung und im Konsolen-Log
  children: ReactNode;
}

interface State { fehler: Error | null; }

export default class FehlerGrenze extends Component<Props, State> {
  state: State = { fehler: null };

  static getDerivedStateFromError(fehler: Error): State {
    return { fehler };
  }

  componentDidCatch(fehler: Error, info: ErrorInfo) {
    console.error(`[FehlerGrenze] ${this.props.bereich}:`, fehler, info.componentStack);
  }

  render() {
    const { fehler } = this.state;
    if (!fehler) return this.props.children;
    return (
      <div className="alert err" style={{ margin: 12, flexDirection: "column", alignItems: "flex-start", gap: 6 }}>
        <div style={{ fontWeight: 600 }}>⚠ Fehler in {this.props.bereich}</div>
        <div style={{ fontSize: 11, wordBreak: "break-word" }}>{fehler.message || String(fehler)}</div>
        <div style={{ fontSize: 10, opacity: 0.8 }}>Deine Daten sind nicht betroffen und werden weiterhin gespeichert.</div>
        <button className="tc-btn-secondary" style={{ height: 24, fontSize: 11 }}
          onClick={() => this.setState({ fehler: null })}>Erneut versuchen</button>
      </div>
    );
  }
}
