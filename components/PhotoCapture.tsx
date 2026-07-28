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
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    if (!videoEl) return;
    let stream: MediaStream | null = null;
    setStatus("loading");
    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: "user" } })
      .then((s) => {
        stream = s;
        videoEl.srcObject = s;
        setStatus("ready");
      })
      .catch(() => setStatus("error"));
    return () => stream?.getTracks().forEach((t) => t.stop());
  }, [videoEl, retryKey]);

  function capture() {
    if (!videoEl || status !== "ready") return;
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
      <div
        style={{
          width: 240,
          height: 240,
          border: "2px solid var(--line)",
          background: "var(--portrait-bg)",
          overflow: "hidden",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          padding: status !== "ready" ? 16 : 0,
        }}
      >
        {status === "loading" && <p style={{ fontSize: "var(--fs-md)", color: "var(--muted)" }}>Requesting camera access…</p>}
        {status === "error" && (
          <p style={{ fontSize: "var(--fs-md)", color: "var(--muted)" }}>
            Camera unavailable. Check that you&apos;ve allowed camera access for this site, or have your partner take
            it from their phone instead.
          </p>
        )}
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
            display: status === "ready" ? "block" : "none",
          }}
        />
      </div>
      {status === "error" ? (
        <button className="btn" style={{ width: "100%" }} onClick={() => setRetryKey((k) => k + 1)}>
          Try again
        </button>
      ) : (
        <button className="btn" style={{ width: "100%" }} disabled={status !== "ready"} onClick={capture}>
          {buttonLabel}
        </button>
      )}
      {onSkip && (
        <button className="btn btn-outline" style={{ width: "100%" }} onClick={onSkip}>
          {skipLabel}
        </button>
      )}
    </>
  );
}
