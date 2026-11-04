import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Animated, StyleSheet } from 'react-native';
import type { Theme, ThemeMode } from '../theme';
import { PHASE_META, PHASE_XP_THRESHOLDS, getPhaseColor } from '../theme';

type Props = {
  xp: number;
  phase: number;
  theme: Theme;
  themeMode: ThemeMode;
  /** Previous XP value for gain animation (optional) */
  prevXp?: number;
};

export function AnimatedProgressBar({ xp, phase, theme, themeMode, prevXp }: Props) {
  const animatedWidth = useRef(new Animated.Value(0)).current;
  const xpGainOpacity = useRef(new Animated.Value(0)).current;
  const xpGainTranslate = useRef(new Animated.Value(20)).current;

  const [showXpGain, setShowXpGain] = useState(false);
  const [xpGainAmount, setXpGainAmount] = useState(0);

  const phaseMeta = PHASE_META[phase] ?? PHASE_META[1];
  const phaseColor = getPhaseColor(phase, themeMode);

  const floor = PHASE_XP_THRESHOLDS[phase - 1] ?? 0;
  const ceil = PHASE_XP_THRESHOLDS[phase] ?? 5000;
  const phaseRange = Math.max(1, ceil - floor);
  const xpInPhase = Math.max(0, xp - floor);
  const progress = Math.min(100, Math.max(0, (xpInPhase / phaseRange) * 100));
  const remainingXp = Math.max(0, ceil - xp);

  // Milestones within the phase (25%, 50%, 75% of the way to next phase)
  const milestones = [25, 50, 75].map((pct) => ({
    pct,
    xpRequired: Math.round(floor + (phaseRange * pct) / 100),
  }));

  // Animate the bar fill when xp changes
  useEffect(() => {
    Animated.timing(animatedWidth, {
      toValue: progress,
      duration: 800,
      useNativeDriver: false,
    }).start();
  }, [progress, animatedWidth]);

  // Detect XP gain and show floating "+XP" indicator
  useEffect(() => {
    if (prevXp != null && prevXp < xp) {
      const gained = xp - prevXp;
      setXpGainAmount(gained);
      setShowXpGain(true);

      xpGainOpacity.setValue(1);
      xpGainTranslate.setValue(0);

      Animated.parallel([
        Animated.timing(xpGainOpacity, {
          toValue: 0,
          duration: 2000,
          delay: 400,
          useNativeDriver: true,
        }),
        Animated.timing(xpGainTranslate, {
          toValue: -30,
          duration: 2000,
          delay: 400,
          useNativeDriver: true,
        }),
      ]).start(() => {
        setShowXpGain(false);
      });
    }
  }, [xp, prevXp]);

  return (
    <View style={styles.container}>
      {/* Phase Row: badge icon + label + XP total */}
      <View style={styles.phaseRow}>
        <View style={[styles.phaseBadge, { backgroundColor: phaseColor + '20' }]}>
          <Text style={styles.phaseIcon}>{phaseMeta.icon}</Text>
          <Text style={[styles.phaseLabel, { color: phaseColor }]}>{phaseMeta.label}</Text>
        </View>
        <Text style={[styles.xpTotal, { color: theme.textMuted }]}>
          {xp} XP
        </Text>
      </View>

      {/* Progress Bar Track */}
      <View style={styles.barContainer}>
        <View style={[styles.barTrack, { backgroundColor: theme.divider }]}>
          <Animated.View
            style={[
              styles.barFill,
              {
                backgroundColor: phaseColor,
                width: animatedWidth.interpolate({
                  inputRange: [0, 100],
                  outputRange: ['0%', '100%'],
                }),
              },
            ]}
          />
        </View>

        {/* Milestone markers */}
        {milestones.map((m) => (
          <View
            key={m.pct}
            style={[
              styles.milestone,
              {
                left: `${m.pct}%` as any,
                backgroundColor: progress >= m.pct ? phaseColor : theme.textMuted,
              },
            ]}
          />
        ))}
      </View>

      {/* XP gain floating indicator */}
      {showXpGain && (
        <Animated.View
          style={[
            styles.xpGainBadge,
            {
              opacity: xpGainOpacity,
              transform: [{ translateY: xpGainTranslate }],
              backgroundColor: theme.success,
            },
          ]}
        >
          <Text style={styles.xpGainText}>+{xpGainAmount} XP</Text>
        </Animated.View>
      )}

      {/* Progress Info Row */}
      <View style={styles.infoRow}>
        <Text style={[styles.progressPct, { color: phaseColor }]}>
          {Math.round(progress)}%
        </Text>
        {remainingXp > 0 ? (
          <Text style={[styles.remainingText, { color: theme.textMuted }]}>
            {remainingXp} XP to {PHASE_META[phase + 1]?.label ?? 'Max'} {PHASE_META[phase + 1]?.icon ?? '🏆'}
          </Text>
        ) : (
          <Text style={[styles.remainingText, { color: theme.success }]}>
            Max level reached! 🎉
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: 14,
    position: 'relative',
  },
  phaseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  phaseBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  phaseIcon: {
    fontSize: 16,
  },
  phaseLabel: {
    fontSize: 13,
    fontWeight: '800',
  },
  xpTotal: {
    fontSize: 12,
    fontWeight: '700',
  },
  barContainer: {
    position: 'relative',
    height: 14,
    justifyContent: 'center',
  },
  barTrack: {
    height: 14,
    borderRadius: 999,
    overflow: 'hidden',
    position: 'relative',
  },
  barFill: {
    height: '100%',
    borderRadius: 999,
  },
  milestone: {
    position: 'absolute',
    width: 8,
    height: 8,
    borderRadius: 4,
    top: 3,
    marginLeft: -4,
    zIndex: 2,
    borderWidth: 1.5,
    borderColor: '#FFF',
  },
  xpGainBadge: {
    position: 'absolute',
    top: -4,
    right: 0,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    zIndex: 10,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  xpGainText: {
    color: '#FFF',
    fontSize: 11,
    fontWeight: '900',
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  progressPct: {
    fontSize: 12,
    fontWeight: '900',
  },
  remainingText: {
    fontSize: 11,
    fontWeight: '600',
  },
});

