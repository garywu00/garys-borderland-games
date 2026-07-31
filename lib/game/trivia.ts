export type TriviaQuestion = {
  id: string;
  prompt: string;
  choices: string[];
  accepts: string[];
};

// Multiple choice, not free text — a typo on a free-text answer used to
// cost a team a heart for a reason that had nothing to do with actually
// knowing the answer. choices is what's rendered; accepts is just the
// correct choice's exact text (still checked the same way as before), so
// tapping a button sends an exact string with no room for a typo.
export const TRIVIA_QUESTIONS: TriviaQuestion[] = [
  {
    id: "survivor",
    prompt: "What is Gary's favorite reality show?",
    choices: ["The Amazing Race", "Big Brother", "Survivor", "The Traitors"],
    accepts: ["survivor"],
  },
  {
    id: "eggs_benedict",
    prompt: "What is Gary's favorite brunch order?",
    choices: ["Eggs Benedict", "Classic Eggs and Bacon", "Omelette", "Shakshuka"],
    accepts: ["eggs benedict", "egg benedict"],
  },
  {
    id: "orange",
    prompt: "What color is Gary's phone?",
    choices: ["Silver", "Grey", "Orange", "Navy Blue"],
    accepts: ["orange"],
  },
  {
    id: "five",
    prompt: "How many times has Gary been to Coachella?",
    choices: ["4", "5", "6", "7"],
    accepts: ["5", "five"],
  },
  {
    id: "overwatch",
    prompt: "What video game does Gary play?",
    choices: ["Valorant", "Overwatch", "Pokemon", "Mario Party"],
    accepts: ["overwatch"],
  },
  {
    id: "cooking",
    prompt: "What kind of content does Gary's little brother make?",
    choices: ["Cooking / food content", "Thirst trapping", "Restaurant reviews", "Travel content"],
    accepts: [
      "cooking",
      "cooking content",
      "food content",
      "cooking videos",
      "food",
      "chef",
      "stage",
      "staging",
      "cooking / food content",
    ],
  },
];

function normalize(raw: string): string {
  return raw.trim().toLowerCase();
}

export function checkTriviaAnswer(questionId: string, rawAnswer: string): boolean {
  const question = TRIVIA_QUESTIONS.find((q) => q.id === questionId);
  if (!question) return false;
  const normalized = normalize(rawAnswer);
  return question.accepts.some((accepted) => normalize(accepted) === normalized);
}

export function getTriviaQuestion(questionId: string): TriviaQuestion | undefined {
  return TRIVIA_QUESTIONS.find((q) => q.id === questionId);
}

export const TRIVIA_TIME_LIMIT_MS = 30_000;
