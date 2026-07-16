"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { PhotoCapture } from "@/components/PhotoCapture";
import { submitChallengePhoto } from "@/lib/actions/photos";

type Submission = { id: string; status: string };

export function ChickenPhotoFlow({
  teamId,
  isActiveController,
  notify,
  waitingLabel,
  waitingDirection,
}: {
  teamId: string;
  isActiveController: boolean;
  notify: (msg: string) => void;
  waitingLabel: string;
  waitingDirection: string;
}) {
  const supabase = createClient();
  const [arrived, setArrived] = useState<boolean | undefined>(undefined);
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [uploading, setUploading] = useState(false);

  const refreshArrival = useCallback(async () => {
    const { data } = await supabase
      .from("checkpoint_arrivals")
      .select("id")
      .eq("team_id", teamId)
      .eq("checkpoint", "diamonds")
      .maybeSingle();
    setArrived(!!data);
  }, [supabase, teamId]);

  const refreshSubmission = useCallback(async () => {
    const { data } = await supabase
      .from("challenge_submissions")
      .select("id, status")
      .eq("team_id", teamId)
      .eq("challenge_code", "round3_chicken_photo")
      .order("submitted_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    setSubmission(data ?? null);
  }, [supabase, teamId]);

  useEffect(() => {
    refreshArrival();
    refreshSubmission();
  }, [refreshArrival, refreshSubmission]);

  useEffect(() => {
    const channel = supabase
      .channel(`chicken-photo-${teamId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "checkpoint_arrivals" }, refreshArrival)
      .on("postgres_changes", { event: "*", schema: "public", table: "challenge_submissions" }, refreshSubmission)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, teamId, refreshArrival, refreshSubmission]);

  if (arrived === undefined) return null;

  if (!arrived) {
    return (
      <Stack>
        <p className="label">{waitingLabel}</p>
        <div style={{ border: "2px solid var(--line)", padding: "26px 20px", width: "100%" }}>
          <p style={{ fontSize: 19, textAlign: "center", fontWeight: 600, lineHeight: 1.5 }}>{waitingDirection}</p>
        </div>
        <p style={{ fontSize: 15, lineHeight: 1.6, textAlign: "center", color: "var(--muted)", maxWidth: 300 }}>
          Michelle is watching for you. She won&apos;t say what comes next until you arrive.
        </p>
      </Stack>
    );
  }

  if (submission?.status === "pending") {
    return (
      <Stack>
        <p className="label">Offering made</p>
        <p style={{ fontSize: 17, lineHeight: 1.7, textAlign: "center" }}>Michelle is deciding your fate.</p>
      </Stack>
    );
  }

  return (
    <Stack>
      {submission?.status === "rejected" && (
        <p style={{ fontSize: 15, lineHeight: 1.6, textAlign: "center", color: "var(--accent)" }}>
          Not good enough. Michelle sends you back — try again.
        </p>
      )}
      <p style={{ fontSize: 17, lineHeight: 1.7, textAlign: "center", maxWidth: 320 }}>
        Find a chicken. Any shape, any form — real, fake, or drawn — as long as both your faces are in frame with
        it. Bring the proof to Michelle.
      </p>
      {!isActiveController ? (
        <p style={{ color: "var(--muted)", fontSize: 14 }}>Only your partner can submit this on this device.</p>
      ) : uploading ? (
        <p style={{ color: "var(--muted)", fontSize: 14 }}>Uploading…</p>
      ) : (
        <PhotoCapture
          label="Chicken time"
          buttonLabel="Take Photo"
          mirror={false}
          onCapture={async (dataUrl) => {
            setUploading(true);
            try {
              const result = await submitChallengePhoto(teamId, "round3_chicken_photo", dataUrl);
              if (!result.ok) notify("Could not submit photo — try again.");
            } finally {
              setUploading(false);
            }
          }}
        />
      )}
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
