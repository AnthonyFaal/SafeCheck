import type { Choice } from './Choice';
import type { Message } from './Message';

export type Lesson = {
  technique: string;
  warningSigns: string[];
  /**
   * The topic key used for learning_memory updates.
   */
  topicKey: string;
};

export type ScenarioTemplate = {
  id: string;
  category: string;
  platform: string;
  difficulty: number;
  phase?: number;
  isLegit?: boolean;

  emotion: string[];

  characters: Record<
    string,
    {
      name: string;
      role: string;
      avatar?: string;
      isPlayer?: boolean;
    }
  >;

  /** Short framing shown above the chat (e.g. "You're playing as Ama"). */
  povLabel?: string;

  /**
   * Static base conversation for the template.
   * Randomization may replace some tokens/fields when runtime is created.
   */
  conversation: Message[];

  choices: Choice[];

  lesson: Lesson;
};

export type ScenarioRuntime = {
  runtimeId: string;
  templateId: string;

  category: string;
  platform: string;
  difficulty: number;
  phase?: number;
  isLegit?: boolean;

  emotion: string[];

  characters: ScenarioTemplate['characters'];

  /**
   * Final conversation to show in the chat simulation
   * (may be token-substituted/reshuffled by the randomizer).
   */
  conversation: Message[];

  choices: Choice[];

  lesson: Lesson;

  /** Short framing shown above the chat. */
  povLabel?: string;
};
