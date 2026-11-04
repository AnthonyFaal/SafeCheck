import type { Choice } from '../../models/Choice';
import type { ScenarioRuntime } from '../../models/Scenario';

export type ScenarioStep =
  | { type: 'chat'; conversation: ScenarioRuntime['conversation']; availableChoices: Choice[] }
  | { type: 'consequence'; consequence: Consequence };

export type Consequence = {
  outcomeKey: string;
  summary: string;
  psychologyUsed?: string[];
  warningSigns?: string[];
  lessonTopicKey?: string;
};

export type EngineResult = {
  scenario: ScenarioRuntime;
  step: ScenarioStep;
  /**
   * The selected choice (so learning/DB update can use topicKey, risk deltas, etc.)
   */
  selectedChoice: Choice;
};

export class GameEngine {
  constructor(
    private readonly scenarioRuntime: ScenarioRuntime,
    private readonly decisionManager: {
      decide: (choice: Choice, scenario: ScenarioRuntime) => { consequence: Consequence };
    }
  ) {}

  start(): ScenarioStep {
    return {
      type: 'chat',
      conversation: this.scenarioRuntime.conversation,
      availableChoices: this.scenarioRuntime.choices,
    };
  }

  choose(choice: Choice): EngineResult {
    const { consequence } = this.decisionManager.decide(choice, this.scenarioRuntime);
    return {
      scenario: this.scenarioRuntime,
      selectedChoice: choice,
      step: { type: 'consequence', consequence },
    };
  }

  get runtime(): ScenarioRuntime {
    return this.scenarioRuntime;
  }
}
