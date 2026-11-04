import type { ScenarioPack } from '../core/game/ScenarioManager';
import type { ScenarioTemplate } from '../models/Scenario';

import otpTheft from './scenarios/otp_theft.json';
import momoWrongTransfer from './scenarios/momo_wrong_transfer.json';
import marketplaceAdvancePayment from './scenarios/marketplace_advance_payment.json';
import legitNotifications from './scenarios/legit_notifications.json';
import phishingEmail from './scenarios/phishing_email.json';
import phishingTelegram from './scenarios/phishing_telegram.json';

function normalizePack(pack: any): ScenarioTemplate[] {
  if (!pack) return [];
  if (Array.isArray(pack)) return pack as ScenarioTemplate[];
  if (Array.isArray(pack.templates)) return pack.templates as ScenarioTemplate[];
  return [];
}

const templates: ScenarioTemplate[] = [
  ...normalizePack(otpTheft),
  ...normalizePack(momoWrongTransfer),
  ...normalizePack(marketplaceAdvancePayment),
  ...normalizePack(legitNotifications),

  // Phishing scenarios
  ...normalizePack(phishingEmail),
  ...normalizePack(phishingTelegram),
];

export const scenarioPack: ScenarioPack = {
  templates,
};
