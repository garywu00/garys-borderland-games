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
        <div style={{ border: "2px solid var(--line)", padding: 16, width: "100%" }}>
          <p style={{ fontSize: 16, textAlign: "center", fontWeight: 600 }}>{waitingDirection}</p>
        </div>
        <p style={{ fontSize: 15, textAlign: "center", color: "var(--muted)" }}>
          Once you&apos;re there, Michelle will check you in and give you your next challenge.
        </p>
      </Stack>
    );
  }

  if (submission?.status === "pending") {
    return (
      <Stack>
        <p className="label">Photo submitted</p>
        <p style={{ fontSize: 15, textAlign: "center" }}>Waiting for Michelle to review it.</p>
      </Stack>
    );
  }

  return (
    <Stack>
      {submission?.status === "rejected" && (
        <p style={{ fontSize: 14, textAlign: "center", color: "var(--accent)" }}>
          That photo didn&apos;t pass — take another.
        </p>
      )}
      <p style={{ fontSize: 15, textAlign: "center", maxWidth: 320 }}>
        Take a photo with a chicken with your entire pair&apos;s faces inside. The chicken can be any shape or form —
        real, fake, or doodle. Present it back to Michelle for review.
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
