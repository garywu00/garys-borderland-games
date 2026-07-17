"use server";

import { createAdminClient } from "@/lib/supabase/server";
import { requireTeamMember, requireManager } from "@/lib/actions/session";
import { applyHeartDelta, reverseHeartDelta } from "@/lib/actions/hearts";
import { logAction } from "@/lib/actions/manager";
import { TRIVIA_QUESTIONS, checkTriviaAnswer, TRIVIA_TIME_LIMIT_MS } from "@/lib/game/trivia";

type RoundNumber = 1 | 2 | 3;

/**
 * Starts (or, on refresh, resumes) a team's trivia attempt for a round.
 * The question is picked server-side from whatever this team hasn't seen
 * across its other attempts — never the same question twice — and
 * started_at is stamped server-side so the 30s deadline can't be gamed by
 * a client clock and survives a page reload.
 */
export async function startTrivia(teamId: string, roundNumber: RoundNumber) {
  const member = await requireTeamMember(teamId);
  if (!member.ok) return member;

  const admin = createAdminClient();
  const select = "id, round_number, question_id, submitted_answer, is_correct, started_at, submitted_at, timed_out";

  const { data: existing } = await admin
    .from("team_trivia_attempts")
    .select(select)
    .eq("team_id", teamId)
    .eq("round_number", roundNumber)
    .maybeSingle();
  if (existing) return { ok: true as const, attempt: existing };

  const { data: seenRows } = await admin.from("team_trivia_attempts").select("question_id").eq("team_id", teamId);
  const seenIds = new Set((seenRows ?? []).map((r) => r.question_id));
  const available = TRIVIA_QUESTIONS.filter((q) => !seenIds.has(q.id));
  const pool = available.length > 0 ? available : TRIVIA_QUESTIONS;
  const question = pool[Math.floor(Math.random() * pool.length)]!;

  const { data: attempt, error } = await admin
    .from("team_trivia_attempts")
    .insert({ team_id: teamId, round_number: roundNumber, question_id: question.id })
    .select(select)
    .single();
  if (error || !attempt) {
    // Both partners can tap "I'm ready" at once — the loser of the
    // unique(team_id, round_number) race just reads back the winner's row.
    const { data: raceWinner } = await admin
      .from("team_trivia_attempts")
      .select(select)
      .eq("team_id", teamId)
      .eq("round_number", roundNumber)
      .maybeSingle();
    if (raceWinner) return { ok: true as const, attempt: raceWinner };
    return { ok: false as const, reason: "conflict" as const };
  }

  return { ok: true as const, attempt };
}

export async function submitTriviaAnswer(teamId: string, roundNumber: RoundNumber, rawAnswer: string) {
  const member = await requireTeamMember(teamId);
  if (!member.ok) return member;

  const admin = createAdminClient();
  const { data: attempt } = await admin
    .from("team_trivia_attempts")
    .select("id, question_id, started_at, submitted_at")
    .eq("team_id", teamId)
    .eq("round_number", roundNumber)
    .maybeSingle();
  if (!attempt) return { ok: false as const, reason: "not_found" as const };
  if (attempt.submitted_at) return { ok: false as const, reason: "already_submitted" as const };

  // Server clock is authoritative — a client-side auto-submit racing the
  // deadline still lands here and gets the same answer either way.
  const isLate = Date.now() > new Date(attempt.started_at).getTime() + TRIVIA_TIME_LIMIT_MS;
  const isCorrect = !isLate && checkTriviaAnswer(attempt.question_id, rawAnswer);

  let heartTransactionId: string | null = null;
  if (!isCorrect) {
    const result = await applyHeartDelta(teamId, -1, `round${roundNumber}`, attempt.id, member.authId);
    heartTransactionId = result.transactionId;
  }

  await admin
    .from("team_trivia_attempts")
    .update({
      submitted_answer: rawAnswer,
      is_correct: isCorrect,
      timed_out: isLate,
      submitted_at: new Date().toISOString(),
      heart_transaction_id: heartTransactionId,
    })
    .eq("id", attempt.id);

  return { ok: true as const, correct: isCorrect, timedOut: isLate };
}

export async function overrideTriviaResult(attemptId: string) {
  const manager = await requireManager();
  const admin = createAdminClient();

  const { data: attempt } = await admin
    .from("team_trivia_attempts")
    .select("id, team_id, heart_transaction_id, is_correct")
    .eq("id", attemptId)
    .maybeSingle();
  if (!attempt) return { ok: false as const, reason: "not_found" as const };
  if (!attempt.heart_transaction_id) return { ok: false as const, reason: "no_penalty" as const };

  const result = await reverseHeartDelta(attempt.heart_transaction_id, manager.id);
  if (!result.applied) return { ok: false as const, reason: "already_reversed" as const };

  await admin.from("team_trivia_attempts").update({ is_correct: true }).eq("id", attemptId);
  await logAction(manager.id, manager.role, "Overrode trivia penalty", attempt.team_id, null, { attemptId });

  return { ok: true as const };
}
