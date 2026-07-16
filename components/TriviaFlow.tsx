"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { startTrivia, submitTriviaAnswer } from "@/lib/actions/trivia";
import { getTriviaQuestion, TRIVIA_TIME_LIMIT_MS } from "@/lib/game/trivia";

type Attempt = {
  id: string;
  round_number: number;
  question_id: string;
  submitted_answer: string | null;
  is_correct: boolean | null;
  started_at: string;
  submitted_at: string | null;
  timed_out: boolean;
};

export function TriviaFlow({
  teamId,
  roundNumber,
  isActiveController,
  notify,
  children,
}: {
  teamId: string;
  roundNumber: 1 | 2 | 3;
  isActiveController: boolean;
  notify: (msg: string) => void;
  children: React.ReactNode;
}) {
  const supabase = createClient();
  const [attempt, setAttempt] = useState<Attempt | null | undefined>(undefined);
  const [answer, setAnswer] = useState("");
  const [starting, setStarting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const autoSubmittedRef = useRef(false);
  const sawUnsubmittedRef = useRef(false);

  const refreshAttempt = useCallback(async () => {
    const { data } = await supabase
      .from("team_trivia_attempts")
      .select("id, round_number, question_id, submitted_answer, is_correct, started_at, submitted_at, timed_out")
      .eq("team_id", teamId)
      .eq("round_number", roundNumber)
      .maybeSingle();
    setAttempt(data ?? null);
  }, [supabase, teamId, roundNumber]);

  useEffect(() => {
    refreshAttempt();
  }, [refreshAttempt]);

  useEffect(() => {
    const channel = supabase
      .channel(`trivia-${teamId}-${roundNumber}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "team_trivia_attempts" }, refreshAttempt)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, teamId, roundNumber, refreshAttempt]);

  useEffect(() => {
    if (!attempt || attempt.submitted_at) return;
    const interval = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(interval);
  }, [attempt]);

  // Only pop the resolved screen open for a completion observed live during
  // this mount — an attempt that was already submitted before we ever
  // fetched it (e.g. the player already answered, closed the app, and came
  // back later) shouldn't force them through the result screen again.
  useEffect(() => {
    if (!attempt) return;
    if (!attempt.submitted_at) {
      sawUnsubmittedRef.current = true;
    } else if (sawUnsubmittedRef.current) {
      setDismissed(false);
    } else {
      setDismissed(true);
    }
  }, [attempt]);

  const question = attempt ? getTriviaQuestion(attempt.question_id) : undefined;
  const deadlineMs = attempt ? new Date(attempt.started_at).getTime() + TRIVIA_TIME_LIMIT_MS : 0;
  const remainingMs = attempt && !attempt.submitted_at ? Math.max(0, deadlineMs - now) : 0;
  const secondsLeft = Math.ceil(remainingMs / 1000);

  useEffect(() => {
    if (!attempt || attempt.submitted_at || remainingMs > 0 || autoSubmittedRef.current) return;
    autoSubmittedRef.current = true;
    submitTriviaAnswer(teamId, roundNumber, answer);
  }, [attempt, remainingMs, teamId, roundNumber, answer]);

  if (attempt === undefined) return null;
  if (dismissed && attempt?.submitted_at) return <>{children}</>;

  if (!attempt) {
    return (
      <div style={{ border: "2px solid var(--line)", padding: 20, marginBottom: 20, textAlign: "center" }}>
        <h2 style={{ fontWeight: 400, fontSize: 24, marginBottom: 10 }}>Gary Trivia</h2>
        <p style={{ fontSize: 15, marginBottom: 16 }}>
          Answer correctly to keep your hearts. Once you start, you&apos;ll have 30 seconds.
        </p>
        {!isActiveController ? (
          <p style={{ color: "var(--muted)", fontSize: 14 }}>Only your partner can start this on this device.</p>
        ) : (
          <button
            className="btn"
            style={{ width: "100%" }}
            disabled={starting}
            onClick={async () => {
              setStarting(true);
              try {
                const result = await startTrivia(teamId, roundNumber);
                if (result.ok) setAttempt(result.attempt);
                else notify("Only your partner can start this on this device.");
              } finally {
                setStarting(false);
              }
            }}
          >
            {starting ? "Starting…" : "I'm ready"}
          </button>
        )}
      </div>
    );
  }

  if (!attempt.submitted_at) {
    return (
      <div style={{ border: "2px solid var(--line)", padding: 20, marginBottom: 20, textAlign: "center" }}>
        <p className="label">{secondsLeft}s left</p>
        <p style={{ fontSize: 18, fontWeight: 600, margin: "10px 0 16px" }}>{question?.prompt}</p>
        <input
          type="text"
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          disabled={!isActiveController || submitting}
          placeholder="Your answer…"
          style={{ marginBottom: 12 }}
        />
        <button
          className="btn"
          style={{ width: "100%" }}
          disabled={!isActiveController || submitting || !answer.trim()}
          onClick={async () => {
            setSubmitting(true);
            try {
              const result = await submitTriviaAnswer(teamId, roundNumber, answer);
              if (!result.ok) notify("Only your partner can submit on this device.");
            } finally {
              setSubmitting(false);
            }
          }}
        >
          {submitting ? "Submitting…" : "Submit"}
        </button>
      </div>
    );
  }

  const resultText = attempt.timed_out
    ? "Time's up. Your pair loses 1 heart."
    : attempt.is_correct
      ? "Correct. Your hearts are safe."
      : "Incorrect. Your pair loses 1 heart.";

  return (
    <div style={{ border: "2px solid var(--line)", padding: 20, marginBottom: 20, textAlign: "center" }}>
      <h2 style={{ fontWeight: 400, fontSize: 22, marginBottom: 10 }}>{resultText}</h2>
      <button className="btn" style={{ width: "100%" }} onClick={() => setDismissed(true)}>
        Continue
      </button>
    </div>
  );
}
