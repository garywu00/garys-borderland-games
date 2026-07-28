"use client";

import { useState } from "react";
import { PhotoCapture } from "../../../components/PhotoCapture";

// Dev-only preview of PhotoCapture's loading/error/ready states — not
// linked from anywhere in the real player flow.
export default function PhotoCapturePreviewPage() {
  const [captured, setCaptured] = useState<string | null>(null);
  return (
    <main style={{ maxWidth: 428, margin: "0 auto", minHeight: "100dvh", padding: "16px 20px 40px", display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
      <p className="label" style={{ alignSelf: "flex-start" }}>
        PhotoCapture preview — dev only (with onSkip)
      </p>
      <PhotoCapture label="Smile :)" onCapture={(d) => setCaptured(d)} onSkip={() => setCaptured("skipped")} />
      {captured && <p style={{ fontSize: 13 }}>Captured/skipped: {captured.slice(0, 40)}</p>}
      <p className="label" style={{ alignSelf: "flex-start", marginTop: 24 }}>
        PhotoCapture preview — dev only (no onSkip, e.g. chicken photo)
      </p>
      <PhotoCapture label="Find a chicken" mirror={false} onCapture={(d) => setCaptured(d)} />
    </main>
  );
}
