export type ThemeMode = 'light' | 'dark';

/** Phase metadata — colors, icons, labels, celebration messages */
export const PHASE_META: Record<number, { label: string; icon: string; color: string; darkColor: string; celebration: string }> = {
  1: { label: 'Beginner', icon: '🪖', color: '#22C55E', darkColor: '#4ADE80', celebration: 'Every expert was once a beginner!' },
  2: { label: 'Explorer', icon: '🗺️', color: '#3B82F6', darkColor: '#60A5FA', celebration: 'You\'re exploring new frontiers!' },
  3: { label: 'Defender', icon: '🛡️', color: '#8B5CF6', darkColor: '#A78BFA', celebration: 'You\'re becoming a skilled defender!' },
  4: { label: 'Expert', icon: '👑', color: '#F59E0B', darkColor: '#FBBF24', celebration: 'You\'ve reached scam-awareness mastery!' },
};

/** XP thresholds for each phase */
export const PHASE_XP_THRESHOLDS = [0, 500, 1500, 3000, 5000];

export function getPhaseColor(phase: number, mode: ThemeMode): string {
  const meta = PHASE_META[phase] ?? PHASE_META[1];
  return mode === 'dark' ? meta.darkColor : meta.color;
}

export type Theme = {
  mode: ThemeMode;
  background: string;
  surface: string;
  cardBg: string;
  cardBorder: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  buttonPrimaryBg: string;
  buttonSecondaryBg: string;
  buttonPrimaryText: string;
  buttonSecondaryText: string;
  bubbleRightBg: string;
  bubbleRightText: string;
  bubbleLeftBg: string;
  bubbleLeftText: string;
  choiceBg: string;
  choiceBorder: string;
  choiceText: string;
  divider: string;
  systemTagBg: string;
  systemTagText: string;
  success: string;
  danger: string;
  warning: string;
  shadow: string;
};

export const lightTheme: Theme = {
  mode: 'light',
  background: '#F0F4FA',
  surface: '#FFFFFF',
  cardBg: '#FFFFFF',
  cardBorder: '#E2E8F0',
  textPrimary: '#0F172A',
  textSecondary: '#475569',
  textMuted: '#94A3B8',
  buttonPrimaryBg: '#7C3AED',
  buttonSecondaryBg: '#F5F3FF',
  buttonPrimaryText: '#FFFFFF',
  buttonSecondaryText: '#6D28D9',
  bubbleRightBg: '#DCF8C6',
  bubbleRightText: '#111827',
  bubbleLeftBg: '#FFFFFF',
  bubbleLeftText: '#111827',
  choiceBg: '#F8FAFC',
  choiceBorder: '#CBD5E1',
  choiceText: '#0F172A',
  divider: '#E2E8F0',
  systemTagBg: '#0EA5E9',
  systemTagText: '#FFFFFF',
  success: '#16A34A',
  danger: '#DC2626',
  warning: '#D97706',
  shadow: 'rgba(15, 23, 42, 0.08)',
};

export const darkTheme: Theme = {
  mode: 'dark',
  background: '#0B1120',
  surface: '#111827',
  cardBg: '#1E293B',
  cardBorder: '#334155',
  textPrimary: '#F1F5F9',
  textSecondary: '#CBD5E1',
  textMuted: '#64748B',
  buttonPrimaryBg: '#8B5CF6',
  buttonSecondaryBg: '#1E1B4B',
  buttonPrimaryText: '#FFFFFF',
  buttonSecondaryText: '#A78BFA',
  bubbleRightBg: '#005C4B',
  bubbleRightText: '#E2E8F0',
  bubbleLeftBg: '#1E293B',
  bubbleLeftText: '#F1F5F9',
  choiceBg: '#1E293B',
  choiceBorder: '#334155',
  choiceText: '#F1F5F9',
  divider: '#334155',
  systemTagBg: '#0284C7',
  systemTagText: '#FFFFFF',
  success: '#22C55E',
  danger: '#EF4444',
  warning: '#F59E0B',
  shadow: 'rgba(0, 0, 0, 0.35)',
};
