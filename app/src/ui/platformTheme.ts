export type PlatformKey =
  | 'WHATSAPP'
  | 'SMS'
  | 'EMAIL'
  | 'TELEGRAM'
  | 'WHATSAPP_GROUP'
  | 'BANK'
  | 'TELECOM'
  | 'MARKETPLACE'
  | 'NOTICE'
  | 'DEFAULT';

export type PlatformStyle = {
  key: PlatformKey;
  label: string;
  icon: string;
  headerBg: string;
  headerText: string;
  chatBg: string;
  accent: string;
  /** Bubble tint for incoming messages on this platform */
  incomingBubble: string;
  incomingText: string;
};

export const PLATFORM_STYLES: Record<PlatformKey, PlatformStyle> = {
  WHATSAPP: {
    key: 'WHATSAPP',
    label: 'WhatsApp',
    icon: '💬',
    headerBg: '#075E54',
    headerText: '#FFFFFF',
    chatBg: '#ECE5DD',
    accent: '#25D366',
    incomingBubble: '#FFFFFF',
    incomingText: '#111827',
  },
  WHATSAPP_GROUP: {
    key: 'WHATSAPP_GROUP',
    label: 'WhatsApp Group',
    icon: '👥',
    headerBg: '#128C7E',
    headerText: '#FFFFFF',
    chatBg: '#ECE5DD',
    accent: '#25D366',
    incomingBubble: '#FFFFFF',
    incomingText: '#111827',
  },
  SMS: {
    key: 'SMS',
    label: 'SMS',
    icon: '📩',
    headerBg: '#1A73E8',
    headerText: '#FFFFFF',
    chatBg: '#F3F4F6',
    accent: '#1A73E8',
    incomingBubble: '#E5E7EB',
    incomingText: '#111827',
  },
  EMAIL: {
    key: 'EMAIL',
    label: 'Email',
    icon: '📧',
    headerBg: '#EA4335',
    headerText: '#FFFFFF',
    chatBg: '#F8FAFC',
    accent: '#EA4335',
    incomingBubble: '#FFFFFF',
    incomingText: '#1E293B',
  },
  TELEGRAM: {
    key: 'TELEGRAM',
    label: 'Telegram',
    icon: '✈️',
    headerBg: '#2AABEE',
    headerText: '#FFFFFF',
    chatBg: '#E8F4FC',
    accent: '#2AABEE',
    incomingBubble: '#FFFFFF',
    incomingText: '#0F172A',
  },
  BANK: {
    key: 'BANK',
    label: 'Bank Alert',
    icon: '🏦',
    headerBg: '#1E3A5F',
    headerText: '#FFFFFF',
    chatBg: '#F0F4F8',
    accent: '#FFB81C',
    incomingBubble: '#FFFFFF',
    incomingText: '#1E293B',
  },
  TELECOM: {
    key: 'TELECOM',
    label: 'Telecom',
    icon: '📡',
    headerBg: '#7C3AED',
    headerText: '#FFFFFF',
    chatBg: '#F5F3FF',
    accent: '#7C3AED',
    incomingBubble: '#FFFFFF',
    incomingText: '#1E293B',
  },
  MARKETPLACE: {
    key: 'MARKETPLACE',
    label: 'Marketplace',
    icon: '🛒',
    headerBg: '#9333EA',
    headerText: '#FFFFFF',
    chatBg: '#FAF5FF',
    accent: '#9333EA',
    incomingBubble: '#FFFFFF',
    incomingText: '#1E293B',
  },
  NOTICE: {
    key: 'NOTICE',
    label: 'Notice',
    icon: '📢',
    headerBg: '#DC2626',
    headerText: '#FFFFFF',
    chatBg: '#FEF2F2',
    accent: '#DC2626',
    incomingBubble: '#FFFFFF',
    incomingText: '#1E293B',
  },
  DEFAULT: {
    key: 'DEFAULT',
    label: 'Message',
    icon: '🔎',
    headerBg: '#2563EB',
    headerText: '#FFFFFF',
    chatBg: '#F4F7FF',
    accent: '#2563EB',
    incomingBubble: '#E8EEFC',
    incomingText: '#0B1220',
  },
};

/** Dark-mode variants for chat backgrounds per platform */
export const PLATFORM_DARK_CHAT_BG: Record<PlatformKey, string> = {
  WHATSAPP: '#1A2C2C',
  WHATSAPP_GROUP: '#1A2F2A',
  SMS: '#1A202C',
  EMAIL: '#1E2028',
  TELEGRAM: '#1A2835',
  BANK: '#141E2B',
  TELECOM: '#1E1B2E',
  MARKETPLACE: '#1E1930',
  NOTICE: '#2A1A1A',
  DEFAULT: '#151E2B',
};

export function getPlatformStyle(platform: string, themeMode: 'light' | 'dark' = 'light'): PlatformStyle {
  // Defensive guard against undefined/empty platform value
  const safePlatform = platform ?? 'DEFAULT';
  const key = safePlatform.toUpperCase() as PlatformKey;
  const base = PLATFORM_STYLES[key] ?? PLATFORM_STYLES.DEFAULT;
  
  if (themeMode === 'dark') {
    return {
      ...base,
      chatBg: PLATFORM_DARK_CHAT_BG[key] ?? PLATFORM_DARK_CHAT_BG.DEFAULT,
    };
  }
  
  return base;
}

