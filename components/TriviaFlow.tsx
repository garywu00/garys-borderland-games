"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { startTrivia, submitTriviaAnswer } from "@/lib/actions/trivia";
import { getTriviaQuestion, TRIVIA_TIME_LIMIT_MS } from "@/lib/game/trivia";

// Surfaces the actual failure instead of a generic "try again" — critical
// while diagnosing live, so the message a player reads out loud is enough
// to tell us what's actually wrong rather than another round of guessing.
function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

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
  notify,
  children,
}: {
  teamId: string;
  roundNumber: 1 | 2 | 3;
  notify: (msg: string) => void;
  children: React.ReactNode;
}) {
  const supabase = createClient();
  const [attempt, setAttempt] = useState<Attempt | null | undefined>(undefined);
  const [selectedChoice, setSelectedChoice] = useState<string | null>(null);
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
    // Best-effort — if this fails (dropped connection right at the buzzer),
    // the Submit button below is still live and un-timed-out, so the player
    // can just retry manually instead of being stuck with no path forward.
    // What gets submitted here doesn't actually matter for grading — a late
    // submission is marked wrong regardless of the answer — so an unmade
    // selection just submits an empty string.
    submitTriviaAnswer(teamId, roundNumber, selectedChoice ?? "").catch(() => {});
  }, [attempt, remainingMs, teamId, roundNumber, selectedChoice]);

  if (attempt === undefined) return null;
  if (dismissed && attempt?.submitted_at) return <>{children}</>;

  if (!attempt) {
    return (
      <div className="fade-up" style={{ border: "2px solid var(--line)", padding: "26px 20px", marginBottom: 20, textAlign: "center" }}>
        <p className="label">A price for passage</p>
        <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 26, margin: "8px 0 12px" }}>
          Gary Trivia
        </h2>
        <p style={{ fontSize: 17, lineHeight: 1.7, marginBottom: 18 }}>
          Answer correctly to keep your hearts. Once you start, you&apos;ll have 30 seconds — no more.
        </p>
        <button
          className="btn"
          style={{ width: "100%" }}
          disabled={starting}
          onClick={async () => {
            setStarting(true);
            try {
              const result = await startTrivia(teamId, roundNumber);
              if (result.ok) setAttempt(result.attempt);
              else notify(`Could not start (${result.reason}) — try again.`);
            } catch (e) {
              notify(`Couldn't start: ${errorMessage(e)}`);
            } finally {
              setStarting(false);
            }
          }}
        >
          {starting ? "Starting…" : "I'm ready"}
        </button>
      </div>
    );
  }

  if (!attempt.submitted_at) {
    const urgent = secondsLeft <= 10;
    return (
      <div style={{ border: "2px solid var(--line)", padding: "26px 20px", marginBottom: 20, textAlign: "center" }}>
        <p className="label" style={{ marginBottom: 2 }}>
          Time left
        </p>
        {/* Deliberately much bigger/bolder than the ambient elapsed-game
            timer up in the header — both are small mono countdowns, so at a
            glance they read as the same thing unless this one is visually
            unmistakable as "the one that costs you a heart." */}
        <p
          className={urgent ? "pulse-accent" : undefined}
          style={{ fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: "var(--fs-h1)", lineHeight: 1, color: urgent ? "var(--accent)" : "var(--fg)" }}
        >
          {secondsLeft}s
        </p>
        <p style={{ fontSize: "var(--fs-callout)", fontWeight: 600, lineHeight: 1.5, margin: "12px 0 18px" }}>{question?.prompt}</p>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 12 }}>
          {question?.choices.map((choice) => (
            <button
              key={choice}
              className="btn-outline"
              disabled={submitting}
              aria-pressed={selectedChoice === choice}
              style={{
                width: "100%",
                border: "2px solid var(--line)",
                padding: "14px 16px",
                background: selectedChoice === choice ? "var(--btn-bg)" : "transparent",
                color: selectedChoice === choice ? "var(--btn-fg)" : "var(--fg)",
              }}
              onClick={() => setSelectedChoice(choice)}
            >
              {choice}
            </button>
          ))}
        </div>
        <button
          className="btn"
          style={{ width: "100%" }}
          disabled={submitting || !selectedChoice}
          onClick={async () => {
            if (!selectedChoice) return;
            setSubmitting(true);
            try {
              const result = await submitTriviaAnswer(teamId, roundNumber, selectedChoice);
              if (!result.ok) notify("Already submitted.");
            } catch {
              notify("Couldn't submit — check your connection and try again.");
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
    <div className="pop-in" style={{ border: "2px solid var(--line)", padding: "26px 20px", marginBottom: 20, textAlign: "center" }}>
      <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 24, marginBottom: 14 }}>{resultText}</h2>
      <button className="btn" style={{ width: "100%" }} onClick={() => setDismissed(true)}>
        Continue
      </button>
    </div>
  );
}
