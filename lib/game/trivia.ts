export type TriviaQuestion = {
  id: string;
  prompt: string;
  accepts: string[];
};

export const TRIVIA_QUESTIONS: TriviaQuestion[] = [
  { id: "survivor", prompt: "What is Gary's favorite reality show?", accepts: ["survivor"] },
  { id: "eggs_benedict", prompt: "What is Gary's favorite brunch order?", accepts: ["eggs benedict", "egg benedict"] },
  { id: "orange", prompt: "What color is Gary's phone?", accepts: ["orange"] },
  { id: "five", prompt: "How many times has Gary been to Coachella?", accepts: ["5", "five"] },
  { id: "overwatch", prompt: "What video game does Gary play?", accepts: ["overwatch"] },
  {
    id: "cooking",
    prompt: "What kind of content does Gary's little brother make?",
    accepts: ["cooking", "cooking content", "food content", "cooking videos"],
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
