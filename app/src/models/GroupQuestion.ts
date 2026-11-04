export type GroupQuestion = {
  id: string;
  prompt: string;
  options: Array<{ value: string; label: string }>;
  correctAnswer: string;
  explanation: string;
};

