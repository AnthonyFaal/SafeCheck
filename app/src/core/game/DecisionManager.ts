import type { Choice } from '../../models/Choice';
import type { ScenarioRuntime } from '../../models/Scenario';
import type { Consequence } from './GameEngine';

function mapEmotionToHeuristic(emotion: string): string {
  const lower = emotion.toLowerCase();
  if (lower.includes('trust')) return 'Authority / trust signals';
  if (lower.includes('urgency')) return 'Urgency pressure';
  if (lower.includes('fear')) return 'Fear appeal';
  if (lower.includes('reward') || lower.includes('greed')) return 'Reward promise';
  if (lower.includes('social')) return 'Social proof';
  if (lower.includes('politeness')) return 'Politeness / courtesy hook';
  if (lower.includes('panic')) return 'Stressful rush';
  return 'Behavioural influence';
}

export class DecisionManager {
  decide(choice: Choice, scenario: ScenarioRuntime): { consequence: Consequence } {
    const outcomeKey = choice.resultKey;
    const lesson = scenario.lesson;
    const warningSigns = lesson.warningSigns ?? [];
    const heuristics = scenario.emotion?.map(mapEmotionToHeuristic).filter(Boolean) ?? [];

    const summary =
      outcomeKey === 'SAFE'
        ? scenario.isLegit
          ? 'This communication is legitimate when verified through official channels. You acted carefully and released information only after following the right process.'
          : 'You correctly identified suspicious behavior and did not give the attacker a way in.'
        : outcomeKey === 'LOSS'
          ? scenario.isLegit
            ? 'This message was legitimate, but the response skipped verification and treated it like a scam. Trusted messages still need verification through the right channel.'
            : 'You moved too quickly under pressure. The scam relied on urgency, authority and social proof to trap you.'
          : `Outcome: ${outcomeKey}`;

    const consequence: Consequence = {
      outcomeKey,
      summary,
      psychologyUsed: [lesson.technique, ...heuristics].filter(Boolean),
      warningSigns,
      lessonTopicKey: choice.topicKey ?? lesson.topicKey,
    };

    return { consequence };
  }
}
