"use client";

import { useEffect, useState } from "react";
import { PortraitPair } from "@/components/Portrait";
import { getTeamPortraits } from "@/lib/actions/photos";

export function CongratsScreen({
  teamId,
  teamName,
  eyebrow,
  title,
  subtitle,
  ctaLabel = "Continue",
  onDismiss,
}: {
  teamId: string;
  teamName: string;
  eyebrow: string;
  title: string;
  subtitle?: string;
  ctaLabel?: string;
  onDismiss: () => void;
}) {
  const [photos, setPhotos] = useState<(string | null)[]>([]);

  useEffect(() => {
    getTeamPortraits(teamId).then((p) => setPhotos(p.map((x) => x.url)));
  }, [teamId]);

  return (
    <div className="dramatic-panel">
      <p className="label flicker-in">{eyebrow}</p>
      <div className="pop-in">
        <PortraitPair names={teamName.split(" + ")} photos={photos} size={88} />
      </div>
      <h2 className="fade-up" style={{ fontFamily: "var(--font-display)", fontSize: 32, textAlign: "center" }}>
        {title}
      </h2>
      {subtitle && (
        <p className="fade-up" style={{ fontSize: 17, textAlign: "center", maxWidth: 320, lineHeight: 1.6, color: "var(--muted)" }}>
          {subtitle}
        </p>
      )}
      <button className="btn" style={{ width: "100%" }} onClick={onDismiss}>
        {ctaLabel}
      </button>
    </div>
  );
}
