export type ShareStealChoice = "share" | "steal";

export interface ShareStealOutcome {
  deltaA: number;
  deltaB: number;
  /** Copy shown to team A's perspective; swap args to get team B's. */
  copyForA: string;
}

/**
 * The four Share/Steal outcomes, exactly as specified:
 *  - Share + Share: both pairs gain 1 heart.
 *  - Steal + Share: the stealing pair gains 2, the sharing pair gains 0.
 *  - Steal + Steal: both pairs lose 1 heart.
 */
export function resolveShareSteal(
  choiceA: ShareStealChoice,
  choiceB: ShareStealChoice,
): ShareStealOutcome {
  if (choiceA === "share" && choiceB === "share") {
    return { deltaA: 1, deltaB: 1, copyForA: "Both pairs chose Share. Each pair gains 1 heart." };
  }
  if (choiceA === "steal" && choiceB === "share") {
    return { deltaA: 2, deltaB: 0, copyForA: "Your steal succeeded. Your pair gains 2 hearts." };
  }
  if (choiceA === "share" && choiceB === "steal") {
    return { deltaA: 0, deltaB: 2, copyForA: "Your opponents chose Steal. Your pair gains no hearts." };
  }
  return { deltaA: -1, deltaB: -1, copyForA: "Both pairs chose Steal. Each pair loses 1 heart." };
}

export const CARD_META = {
  heart4: {
    label: "4 of Hearts",
    direction: "HEAD TO MURRAY PLAYGROUND. FIND AJAN.",
    svg: "/cards/heart4.svg",
  },
  club8: {
    label: "8 of Clubs",
    direction: "HEAD TO THE PEPSI-COLA SIGN. FIND MICHELLE.",
    svg: "/cards/club8.svg",
  },
  diamond2: {
    label: "2 of Diamonds",
    direction: "HEAD TO FOCAL POINT BREWERY. FIND GARY.",
    svg: "/cards/diamond2.svg",
  },
} as const;

export type CardCode = keyof typeof CARD_META;

export const NON_FINALIST_MESSAGE = "The first 3 pairs have qualified. Head to Focal Point Brewery.";

export interface FinalistCandidate {
  teamId: string;
  hearts: number;
  arrivalOrder: number;
}

/**
 * Finalists rank by remaining hearts (desc); ties break by whoever arrived
 * (i.e. was confirmed) earlier.
 */
export function rankFinalists<T extends FinalistCandidate>(finalists: T[]): T[] {
  return [...finalists].sort((a, b) => {
    if (b.hearts !== a.hearts) return b.hearts - a.hearts;
    return a.arrivalOrder - b.arrivalOrder;
  });
}
