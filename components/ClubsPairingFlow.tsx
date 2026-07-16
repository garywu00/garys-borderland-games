"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { PortraitPair } from "@/components/Portrait";
import { voteClubsFail } from "@/lib/actions/checkpoints";
import { getTeamPortraits } from "@/lib/actions/photos";

type Pairing = { id: string; team_a_id: string; team_b_id: string | null; status: string };
type TeamInfo = { id: string; name: string; hearts_cached: number };

export function ClubsPairingFlow({
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
  const [pairing, setPairing] = useState<Pairing | null | undefined>(undefined);
  const [opponent, setOpponent] = useState<TeamInfo | null>(null);
  const [opponentPhotos, setOpponentPhotos] = useState<(string | null)[]>([]);
  const [myVoted, setMyVoted] = useState(false);
  const [voting, setVoting] = useState(false);

  const refreshPairing = useCallback(async () => {
    const { data } = await supabase
      .from("clubs_pairings")
      .select("id, team_a_id, team_b_id, status")
      .or(`team_a_id.eq.${teamId},team_b_id.eq.${teamId}`)
      .eq("status", "active")
      .maybeSingle();
    setPairing(data ?? null);
  }, [supabase, teamId]);

  useEffect(() => {
    refreshPairing();
  }, [refreshPairing]);

  useEffect(() => {
    const channel = supabase
      .channel(`clubs-pairing-${teamId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "clubs_pairings" }, refreshPairing)
      .on("postgres_changes", { event: "*", schema: "public", table: "clubs_fail_votes" }, () => {
        if (pairing) refreshMyVote(pairing.id);
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, teamId, pairing?.id]);

  const refreshMyVote = useCallback(
    async (pairingId: string) => {
      const { data } = await supabase
        .from("clubs_fail_votes")
        .select("id")
        .eq("pairing_id", pairingId)
        .eq("team_id", teamId)
        .maybeSingle();
      setMyVoted(!!data);
    },
    [supabase, teamId],
  );

  const isSolo = pairing?.team_b_id === null;

  useEffect(() => {
    if (!pairing) {
      setOpponent(null);
      setMyVoted(false);
      return;
    }
    if (pairing.team_b_id) {
      const opponentId = pairing.team_a_id === teamId ? pairing.team_b_id : pairing.team_a_id;
      supabase
        .from("teams")
        .select("id, name, hearts_cached")
        .eq("id", opponentId)
        .maybeSingle()
        .then(({ data }) => setOpponent(data ?? null));
      getTeamPortraits(opponentId).then((portraits) => setOpponentPhotos(portraits.map((p) => p.url)));
    }
    refreshMyVote(pairing.id);
  }, [pairing, teamId, supabase, refreshMyVote]);

  if (pairing === undefined) return null;

  if (!pairing || (!isSolo && !opponent)) {
    return (
      <Stack>
        <p className="label">{waitingLabel}</p>
        <div style={{ border: "2px solid var(--line)", padding: "26px 20px", width: "100%" }}>
          <p style={{ fontSize: 19, textAlign: "center", fontWeight: 600, lineHeight: 1.5 }}>{waitingDirection}</p>
        </div>
        <p style={{ fontSize: 15, lineHeight: 1.6, textAlign: "center", color: "var(--muted)", maxWidth: 300 }}>
          Ajan is choosing who you&apos;ll face. Wait here.
        </p>
      </Stack>
    );
  }

  return (
    <Stack>
      {isSolo ? (
        <>
          <p className="label">A trial of your own</p>
          <p style={{ fontSize: 17, lineHeight: 1.7, textAlign: "center", maxWidth: 320 }}>
            Ajan hands you a smaller bag — no one to share the weight with. Finish it as a pair, or give up and
            carry the cost alone.
          </p>
        </>
      ) : (
        opponent && (
          <>
            <p className="label">Your rivals</p>
            <div className="pop-in">
              <PortraitPair names={opponent.name.split(" + ")} photos={opponentPhotos} size={104} />
            </div>
            <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 26, textAlign: "center" }}>
              {opponent.name}
            </h2>
            <p style={{ fontSize: 17, lineHeight: 1.7, textAlign: "center", maxWidth: 320 }}>
              Empty the bag together — as a group of four. Show Ajan when it&apos;s done. Or agree to give up, and
              share the loss.
            </p>
          </>
        )
      )}
      {myVoted ? (
        <p style={{ color: "var(--muted)", fontSize: 14 }}>
          {isSolo ? "Giving up…" : `Waiting for ${opponent?.name} to also give up…`}
        </p>
      ) : (
        <button
          className="btn btn-outline"
          style={{ width: "100%" }}
          disabled={!isActiveController || voting}
          onClick={async () => {
            setVoting(true);
            try {
              const result = await voteClubsFail(teamId);
              if (!result.ok) notify("Only your partner can vote on this device.");
            } finally {
              setVoting(false);
            }
          }}
        >
          {voting ? "…" : "We give up"}
        </button>
      )}
      {!isActiveController && (
        <p style={{ color: "var(--muted)", fontSize: 13, textAlign: "center" }}>
          Only your partner can vote to give up on this device.
        </p>
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
