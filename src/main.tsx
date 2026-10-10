import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import FehlerGrenze from "./components/FehlerGrenze";
import { globaleFehlerAbfangen } from "./hooks/fehlerMelden";
import "./App.css";

globaleFehlerAbfangen();

// Klick ins 3D-Modell (oder in ein anderes Fenster): die Extension läuft in einem iframe, Klicks im Viewer erreichen
// unser document nie, das Fenster verliert aber den Fokus (blur). Dann ein künstliches mousedown ausserhalb aller
// Menüs senden — alle "Klick ausserhalb"-Handler (Dropdowns, ⋮-Menüs, Popover) schliessen ihr Menü so einheitlich.
window.addEventListener("blur", () => {
  document.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
});

// Mausrad darf Zahlenfelder nie verändern (nur manuelle Eingabe) — ausser Sekunden pro Tag in Tab Abspielen (Klasse "pfeile-immer").
// Beim Scrollen über einem fokussierten Zahlenfeld wird es verlassen; die Seite scrollt normal weiter.
document.addEventListener("wheel", () => {
  const el = document.activeElement;
  if (el instanceof HTMLInputElement && el.type === "number" && !el.classList.contains("pfeile-immer")) el.blur();
}, { passive: true, capture: true });

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <FehlerGrenze bereich="der Extension">
      <App />
    </FehlerGrenze>
  </React.StrictMode>
);
