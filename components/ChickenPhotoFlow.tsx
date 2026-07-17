"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { PhotoCapture } from "@/components/PhotoCapture";

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
        <PhotoCapture label="Find a chicken" buttonLabel="Take Photo" mirror={false} onCapture={(dataUrl) => setPhoto(dataUrl)} />
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
        style={{ width: 240, height: 240, objectFit: "cover", border: "2px solid var(--line)" }}
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

function Stack({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, alignItems: "center", flex: 1, justifyContent: "center" }}>
      {children}
    </div>
  );
}
