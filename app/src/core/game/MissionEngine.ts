import type { Choice } from '../../models/Choice';
import type { ScenarioRuntime } from '../../models/Scenario';

export type MissionActStep =
  | { type: 'act_chat'; conversation: ScenarioRuntime['conversation']; availableChoices: Choice[] }
  | { type: 'act_consequence'; outcomeKey: string; summary: string; warningSigns?: string[]; psychologyUsed?: string[]; lessonTopicKey?: string };

export type MissionResult = {
  scenario: ScenarioRuntime;
  actIndex: number;
  step: MissionActStep;
  selectedChoice: Choice;
};

export type MissionAct = {
  /** Scenario used for this act */
  scenario: ScenarioRuntime;
  /** Order inside mission */
  actIndex: number;
};

export type MissionSessionState = {
  missionId: string;
  acts: MissionAct[];
  currentActIndex: number;
  completedActOutcomeKeys: string[];
  completed: boolean;
};

export type MissionEngineOutcome = {
  outcomeKey: string;
  summary: string;
  warningSigns?: string[];
  psychologyUsed?: string[];
  lessonTopicKey?: string;
};

export class MissionEngine {
  private readonly decisionManager: {
    decide: (choice: Choice, scenario: ScenarioRuntime) => { consequence: MissionEngineOutcome & Record<string, any> };
  };

  constructor(
    private readonly session: MissionSessionState,
    decisionManager: {
      decide: (choice: Choice, scenario: ScenarioRuntime) => { consequence: any };
    }
  ) {
    this.decisionManager = decisionManager;
  }

  get currentAct(): MissionAct {
    return this.session.acts[this.session.currentActIndex];
  }

  startAct(): MissionActStep {
    const scenario = this.currentAct.scenario;
    return {
      type: 'act_chat',
      conversation: scenario.conversation,
      availableChoices: scenario.choices,
    };
  }

  choose(choice: Choice): MissionResult {
    const scenario = this.currentAct.scenario;
    const { consequence } = this.decisionManager.decide(choice, scenario) as any;

    const result: MissionResult = {
      scenario,
      actIndex: this.currentAct.actIndex,
      selectedChoice: choice,
      step: {
        type: 'act_consequence',
        outcomeKey: consequence.outcomeKey,
        summary: consequence.summary,
        warningSigns: consequence.warningSigns,
        psychologyUsed: consequence.psychologyUsed,
        lessonTopicKey: consequence.lessonTopicKey,
      },
    };

    this.session.completedActOutcomeKeys.push(consequence.outcomeKey);
    this.session.currentActIndex += 1;
    if (this.session.currentActIndex >= this.session.acts.length) {
      this.session.completed = true;
    }

    return result;
  }
}

