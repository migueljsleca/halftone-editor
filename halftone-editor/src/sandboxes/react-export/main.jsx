import React from "react";
import { createRoot } from "react-dom/client";
import HalftoneExport from "./HalftoneExport.jsx";

const ORANGE_SETTINGS = {
  dotSize: 20,
  angle: 0,
  contrast: 0,
  spread: 0,
  shape: "Circle",
  pageBackground: "#0e0f11",
  paperColor: "#ffffff",
  inkColor: "#ff7a00",
  colorMode: false,
  inverted: false,
  smoothing: 0,
  ditherType: "None",
};

function ReactExportSandbox() {
  return (
    <div
      style={{
        minHeight: "100vh",
        margin: 0,
        padding: 0,
        background: "#0e0f11",
      }}
    >
      <HalftoneExport
        settings={ORANGE_SETTINGS}
        style={{
          width: "300px",
          height: "300px",
          margin: 0,
        }}
      />
    </div>
  );
}

createRoot(document.getElementById("root")).render(<ReactExportSandbox />);
