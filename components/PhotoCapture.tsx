"use client";

import { useEffect, useState } from "react";

export function PhotoCapture({
  label,
  buttonLabel = "Take Photo",
  onCapture,
  onSkip,
  skipLabel = "Use a placeholder instead",
  mirror = true,
}: {
  label: string;
  buttonLabel?: string;
  onCapture: (dataUrl: string) => void;
  onSkip?: () => void;
  skipLabel?: string;
  mirror?: boolean;
}) {
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);
  const [streaming, setStreaming] = useState(false);

  useEffect(() => {
    if (!videoEl) return;
    let stream: MediaStream | null = null;
    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: "user" } })
      .then((s) => {
        stream = s;
        videoEl.srcObject = s;
        setStreaming(true);
      })
      .catch(() => setStreaming(false));
    return () => stream?.getTracks().forEach((t) => t.stop());
  }, [videoEl]);

  function capture() {
    if (!videoEl || !streaming) {
      onSkip?.();
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = 240;
    canvas.height = 240;
    const ctx = canvas.getContext("2d");
    const side = Math.min(videoEl.videoWidth, videoEl.videoHeight);
    if (mirror) {
      // Mirror the capture to match the mirrored preview.
      ctx?.translate(240, 0);
      ctx?.scale(-1, 1);
    }
    ctx?.drawImage(videoEl, (videoEl.videoWidth - side) / 2, (videoEl.videoHeight - side) / 2, side, side, 0, 0, 240, 240);
    onCapture(canvas.toDataURL("image/jpeg", 0.7));
  }

  return (
    <>
      <p className="label">{label}</p>
      <div style={{ width: 240, height: 240, border: "2px solid var(--line)", background: "var(--portrait-bg)", overflow: "hidden" }}>
        <video
          ref={setVideoEl}
          playsInline
          autoPlay
          muted
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            filter: "grayscale(1)",
            transform: mirror ? "scaleX(-1)" : undefined,
            display: streaming ? "block" : "none",
          }}
        />
      </div>
      <button className="btn" style={{ width: "100%" }} onClick={capture}>
        {buttonLabel}
      </button>
      {onSkip && (
        <button className="btn btn-outline" style={{ width: "100%" }} onClick={onSkip}>
          {skipLabel}
        </button>
      )}
    </>
  );
}
