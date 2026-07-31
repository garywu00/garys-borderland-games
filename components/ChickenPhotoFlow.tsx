"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { PhotoCapture } from "@/components/PhotoCapture";

const CHICKEN_RULES_COPY =
  "Get all your faces in the frame with the chicken. No photos of a chicken from another phone or screen — it has to be something you see in real life. And the word \"chicken\" written down doesn't count.";

export function ChickenPhotoFlow({
  teamId,
  waitingLabel,
  waitingDirection,
}: {
  teamId: string;
  waitingLabel: string;
  waitingDirection: string;
}) {
  const supabase = createClient();
  const [arrived, setArrived] = useState<boolean | undefined>(undefined);
  const [photo, setPhoto] = useState<string | null>(null);
  const [rulesModalOpen, setRulesModalOpen] = useState(false);

  const refreshArrival = useCallback(async () => {
    const { data } = await supabase
      .from("checkpoint_arrivals")
      .select("id")
      .eq("team_id", teamId)
      .eq("checkpoint", "diamonds")
      .maybeSingle();
    setArrived(!!data);
  }, [supabase, teamId]);

  useEffect(() => {
    refreshArrival();
  }, [refreshArrival]);

  useEffect(() => {
    const channel = supabase
      .channel(`chicken-arrival-${teamId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "checkpoint_arrivals" }, refreshArrival)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, teamId, refreshArrival]);

  if (arrived === undefined) return null;

  if (!arrived) {
    return (
      <Stack>
        <p className="label">{waitingLabel}</p>
        <div style={{ border: "2px solid var(--line)", padding: "26px 20px", width: "100%" }}>
          <p style={{ fontSize: 19, textAlign: "center", fontWeight: 600, lineHeight: 1.5 }}>{waitingDirection}</p>
        </div>
        <p style={{ fontSize: 15, lineHeight: 1.6, textAlign: "center", color: "var(--muted)", maxWidth: 300 }}>
          Michelle will check you in when you arrive.
        </p>
      </Stack>
    );
  }

  if (!photo) {
    return (
      <Stack>
        <p style={{ fontSize: 17, lineHeight: 1.7, textAlign: "center", maxWidth: 320 }}>
          Find a chicken — any shape or form, real, fake, or drawn — and get both your faces in frame with it.
        </p>
        <p style={{ fontSize: 14, lineHeight: 1.5, textAlign: "center", color: "var(--muted)", maxWidth: 300 }}>
          Once you have the photo, bring your phone back to Michelle so she can check you through in person.
        </p>
        <PhotoCapture label="Find a chicken" buttonLabel="Take Photo" onCapture={(dataUrl) => setPhoto(dataUrl)} />
        <button
          className="btn-outline"
          style={{ width: "100%", fontSize: "var(--fs-sm)", padding: "10px 16px", minHeight: "auto" }}
          onClick={() => setRulesModalOpen(true)}
        >
          View Rules
        </button>
        {rulesModalOpen && <ChickenRulesModal onClose={() => setRulesModalOpen(false)} />}
      </Stack>
    );
  }

  return (
    <Stack>
      <p className="label">Show this to Michelle</p>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={photo}
        alt="Your chicken photo"
        style={{ width: 240, height: 240, objectFit: "cover", border: "2px solid var(--line)", filter: "grayscale(1) contrast(1.05)" }}
      />
      <p style={{ fontSize: 15, lineHeight: 1.6, textAlign: "center", color: "var(--muted)", maxWidth: 300 }}>
        Bring your phone back to Michelle. She&apos;ll mark you through once she&apos;s seen it in person.
      </p>
      <button className="btn btn-outline" style={{ width: "100%" }} onClick={() => setPhoto(null)}>
        Retake
      </button>
    </Stack>
  );
}

function ChickenRulesModal({ onClose }: { onClose: () => void }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(10,10,10,0.55)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 50 }}>
      <div style={{ background: "var(--bg)", width: "100%", maxHeight: "85vh", overflowY: "auto", padding: 22 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h2 style={{ fontWeight: 400, fontSize: "var(--fs-h4)" }}>Chicken Photo — Rules</h2>
          <button className="btn-outline" style={{ width: 44, height: 44, border: "1.6px solid var(--line)" }} onClick={onClose}>
            ✕
          </button>
        </div>
        <p style={{ fontSize: "var(--fs-body-lg)", lineHeight: 1.7 }}>{CHICKEN_RULES_COPY}</p>
      </div>
    </div>
  );
}

function Stack({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, alignItems: "center", flex: 1, justifyContent: "center" }}>
      {children}
    </div>
  );
}
