import { getPlayerPovLabel } from './CharacterResolver';
import type { ScenarioRuntime, ScenarioTemplate } from '../../models/Scenario';

export type ScenarioPack = {
  templates: ScenarioTemplate[];
};

const DUMMY_LINK_REPLACEMENTS: Array<[RegExp, string]> = [
  [/secure-bank-verify\.com/gi, 'banking-auth-update.invalid'],
  [/applesecurity-validate\.com/gi, 'appleid-verify-login.invalid'],
  [/amazon-confirm\.security/gi, 'amazon-delivery-check.invalid'],
  [/accounts-google-recovery\.com/gi, 'google-account-verify.invalid'],
  [/bnance-airdrop-claim\.com/gi, 'binance-airdrop-event.invalid'],
  [/telegram-verify-id\.com/gi, 'telegram-security-check.invalid'],
  [/google-remote-jobs\.com/gi, 'google-careers-portal.invalid'],
  [/telegram-account-appeal\.com/gi, 'telegram-appeal-center.invalid'],
  [/bit\.ly\/\w+/gi, 'click-now.invalid/r8f2'],
  [/tinyurl\.com\/\w+/gi, 'account-check.invalid/4x2'],
];

function sanitizeText(text: string): string {
  let result = text;
  for (const [pattern, replacement] of DUMMY_LINK_REPLACEMENTS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

/** Simple seeded-ish random integer [min, max] inclusive */
function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Maps topicKey strings from learning_memory to the template `id` prefixes
 * so we can bias selection toward scenarios covering weak topics.
 */
function templateMatchesTopicKey(template: ScenarioTemplate, topicKey: string): boolean {
  // Guard against undefined topicKey (e.g. from uninitialized learning_memory rows)
  if (!topicKey) return false;

  const lowerTopic = topicKey.toLowerCase().replace(/\s+/g, '_');

  // Check template id
  if (template.id.toLowerCase().includes(lowerTopic)) return true;

  // Check lesson topicKey — some legacy templates may not have it
  const lessonTopicKey = template.lesson?.topicKey;
  if (lessonTopicKey && lessonTopicKey.toLowerCase() === lowerTopic) return true;

  // Check category
  const category = template.category;
  if (category && category.toLowerCase().replace(/\s+/g, '_').includes(lowerTopic)) return true;

  return false;
}

export class ScenarioManager {
  constructor(private readonly pack: ScenarioPack) {}

  /**
   * Creates a runtime scenario from a template with sanitized dummy links and POV label.
   */
  createRuntime(templateId: string): ScenarioRuntime {
    const template = this.pack.templates.find((t) => t.id === templateId);
    if (!template) {
      throw new Error(`ScenarioManager: template not found: ${templateId}`);
    }

    const conversation = template.conversation.map((m) => ({
      ...m,
      text: sanitizeText(m.text),
    }));

    const choices = template.choices.map((c) => ({
      ...c,
      text: sanitizeText(c.text),
    }));

    const lesson = {
      ...template.lesson,
      warningSigns: template.lesson.warningSigns.map(sanitizeText),
    };

    return {
      runtimeId: `${template.id}__${Date.now()}`,
      templateId: template.id,
      category: template.category,
      platform: template.platform,
      difficulty: template.difficulty,
      phase: template.phase,
      isLegit: template.isLegit,
      emotion: template.emotion,
      characters: template.characters,
      conversation,
      choices,
      lesson,
      povLabel: template.povLabel ?? getPlayerPovLabel(template.characters),
    };
  }

  /**
   * Phase-based difficulty ranges for filtering.
   */
  private targetPhaseRanges: Record<number, { min: number; max: number }> = {
    1: { min: 1, max: 2 },
    2: { min: 2, max: 3 },
    3: { min: 3, max: 4 },
    4: { min: 4, max: 5 },
  };

  /**
   * Picks a random template matching difficulty/phase constraints.
   * Optionally biases selection toward templates covering weak topic areas.
   *
   * @param targetDifficulty - Player's current difficulty rating
   * @param targetPhase - Player's current phase
   * @param excludeTemplateIds - Template IDs to exclude (already played recently)
   * @param weakTopicKeys - Optional list of weak topic keys to bias selection toward
   */
  pickTemplateForDifficulty(
    targetDifficulty: number,
    targetPhase = 1,
    excludeTemplateIds: string[] = [],
    weakTopicKeys: string[] = [],
  ): ScenarioTemplate {
    const phaseRange = this.targetPhaseRanges[targetPhase] ?? { min: 1, max: 5 };

    const candidates = this.pack.templates
      .filter(
        (t) =>
          !excludeTemplateIds.includes(t.id) &&
          t.difficulty <= targetDifficulty &&
          (t.phase == null || (t.phase >= phaseRange.min && t.phase <= phaseRange.max))
      );

    if (candidates.length === 0) {
      // Fallback: if all excluded, return any template
      const fallback = this.pack.templates.filter(
        (t) =>
          !excludeTemplateIds.includes(t.id)
      );
      if (fallback.length > 0) return fallback[randomInt(0, fallback.length - 1)];
      return this.pack.templates[0];
    }

    // If weak topics provided, try to bias toward matching templates
    if (weakTopicKeys.length > 0) {
      const matching = candidates.filter((t) =>
        weakTopicKeys.some((key) => templateMatchesTopicKey(t, key))
      );
      if (matching.length > 0) {
        return matching[randomInt(0, matching.length - 1)];
      }
    }

    // Random pick from remaining candidates
    return candidates[randomInt(0, candidates.length - 1)];
  }

  createRuntimeForDifficulty(
    targetDifficulty: number,
    targetPhase = 1,
    excludeTemplateIds: string[] = [],
    weakTopicKeys: string[] = [],
  ): ScenarioRuntime {
    const template = this.pickTemplateForDifficulty(targetDifficulty, targetPhase, excludeTemplateIds, weakTopicKeys);
    return this.createRuntime(template.id);
  }

  /**
   * Picks a template WITHOUT weak-topic biasing (legacy style for backward compat).
   */
  pickTemplateForDifficultyLegacy(targetDifficulty: number, targetPhase = 1, excludeTemplateIds: string[] = []): ScenarioTemplate {
    return this.pickTemplateForDifficulty(targetDifficulty, targetPhase, excludeTemplateIds, []);
  }
}
