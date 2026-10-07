import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import FehlerGrenze from "./components/FehlerGrenze";
import "./App.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <FehlerGrenze bereich="der Extension">
      <App />
    </FehlerGrenze>
  </React.StrictMode>
);
