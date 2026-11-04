import type { Message } from '../../models/Message';
import type { ScenarioTemplate } from '../../models/Scenario';

export type Character = {
  name: string;
  role: string;
  avatar?: string;
  isPlayer?: boolean;
};

export type ResolvedMessage = {
  message: Message;
  isPlayer: boolean;
  displayName: string;
  avatar: string;
  isSystem?: boolean;
};

/** Roles that represent the player / POV character in a scenario. */
const PLAYER_ROLES = new Set([
  'account_owner',
  'account_holder',
  'bank_customer',
  'customer',
  'subscriber',
  'buyer',
  'seller',
  'whatsapp_user',
  'creator',
  'taxpayer',
  'recipient',
  'student',
  'victim',
  'momo_user',
  'telegram_user',
  'job_seeker',
  'paypal_user',
  'apple_user',
  'amazon_customer',
  'google_user',
  'crypto_trader',
]);

const ROLE_AVATARS: Record<string, string> = {
  fake_support_agent: '🎭',
  fake_sms_sender: '📱',
  fake_friend: '👤',
  fake_momo_agent: '💳',
  fake_network_agent: '📡',
  fake_delivery_driver: '🚚',
  fake_verification_agent: '✅',
  fake_government_agent: '🏛️',
  fake_buyer: '🛒',
  fake_courier: '📦',
  mutual_contact: '👥',
  friend: '🧑',
  friend_used_as_social_proof: '👥',
  customer_service: '🎧',
  recruiter: '💼',
  fake_bank: '🏦',
  fake_paypal: '💰',
  fake_apple: '🍎',
  fake_amazon: '📦',
  fake_google: '🔍',
  scam_bot: '🤖',
  fake_binance: '⚠️',
  fake_telegram: '📢',
  fake_recruiter: '💼',
  fake_support: '🎭',
  fake_investment_manager: '📈',
  official_bank: '🏦',
  official_telecom: '📡',
  courier: '📦',
  delivery_group: '👨‍👩‍👧',
  official_department: '🎓',
};

const DEFAULT_CONTACT_AVATAR = '👤';
const DEFAULT_PLAYER_AVATAR = '🙂';

export function findPlayerCharacter(
  characters: ScenarioTemplate['characters']
): Character | undefined {
  const entries = Object.entries(characters);
  const explicit = entries.find(([, c]) => c.isPlayer || c.name === 'You');
  if (explicit) return { ...explicit[1], isPlayer: true };

  const byRole = entries.find(([, c]) => PLAYER_ROLES.has(c.role));
  if (byRole) return { ...byRole[1], isPlayer: true };

  return undefined;
}

export function getPlayerPovLabel(
  characters: ScenarioTemplate['characters']
): string | undefined {
  const player = findPlayerCharacter(characters);
  if (!player || player.name === 'You') return undefined;
  return `You're playing as ${player.name}`;
}

export function resolveCharacterAvatar(character: Character | undefined): string {
  if (!character) return DEFAULT_CONTACT_AVATAR;
  if (character.avatar) return character.avatar;
  if (character.isPlayer || PLAYER_ROLES.has(character.role)) return DEFAULT_PLAYER_AVATAR;
  return ROLE_AVATARS[character.role] ?? DEFAULT_CONTACT_AVATAR;
}

export function getCharacterBySender(
  sender: string,
  characters: ScenarioTemplate['characters']
): Character | undefined {
  const values = Object.values(characters) as Character[];
  return values.find((c) => c.name === sender);
}

export function isPlayerSender(
  sender: string,
  characters: ScenarioTemplate['characters']
): boolean {
  if (sender === 'You') return true;
  const player = findPlayerCharacter(characters);
  return player != null && sender === player.name;
}

export function resolveMessage(
  message: Message,
  characters: ScenarioTemplate['characters']
): ResolvedMessage {
  const isSystem = message.tags?.includes('system') ?? false;
  const isPlayer = isPlayerSender(message.sender, characters);
  const character = getCharacterBySender(message.sender, characters);

  return {
    message,
    isPlayer,
    displayName: isPlayer ? 'You' : message.sender,
    avatar: resolveCharacterAvatar(character),
    isSystem,
  };
}

export function resolveConversation(
  conversation: Message[],
  characters: ScenarioTemplate['characters']
): ResolvedMessage[] {
  return conversation.map((m) => resolveMessage(m, characters));
}
