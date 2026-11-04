import React, { useEffect, useRef } from 'react';
import { View, Text, Animated, StyleSheet } from 'react-native';
import type { Theme } from '../theme';

type Props = {
  theme: Theme;
};

function SkeletonPulse({ width, height, color }: { width: number | string; height: number; color: string }) {
  const opacity = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 800, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.3, duration: 800, useNativeDriver: true }),
      ])
    );
    animation.start();
    return () => animation.stop();
  }, [opacity]);

  return (
    <Animated.View
      style={[
        styles.skeletonBlock,
        {
          width: width as any,
          height,
          backgroundColor: color,
          opacity,
        },
      ]}
    />
  );
}

export function ChatSkeleton({ theme }: Props) {
  const skeletonColor = theme.divider;

  return (
    <View style={styles.container}>
      {/* System message skeleton */}
      <View style={styles.systemRow}>
        <SkeletonPulse width={160} height={18} color={skeletonColor} />
      </View>

      {/* Incoming message skeleton (avatar + bubble) */}
      <View style={styles.messageRow}>
        <View style={[styles.avatarCircle, { backgroundColor: skeletonColor }]} />
        <View style={styles.incomingBlock}>
          <SkeletonPulse width={60} height={10} color={skeletonColor} />
          <SkeletonPulse width={200} height={40} color={skeletonColor} />
        </View>
      </View>

      {/* Player message skeleton (bubble + avatar) */}
      <View style={[styles.messageRow, styles.playerRow]}>
        <View style={styles.playerBlock}>
          <SkeletonPulse width={180} height={40} color={skeletonColor} />
        </View>
        <View style={[styles.avatarCircle, { backgroundColor: skeletonColor }]} />
      </View>

      {/* Another incoming */}
      <View style={styles.messageRow}>
        <View style={[styles.avatarCircle, { backgroundColor: skeletonColor }]} />
        <View style={styles.incomingBlock}>
          <SkeletonPulse width={50} height={10} color={skeletonColor} />
          <SkeletonPulse width={220} height={30} color={skeletonColor} />
        </View>
      </View>

      {/* Player short */}
      <View style={[styles.messageRow, styles.playerRow]}>
        <View style={styles.playerBlock}>
          <SkeletonPulse width={120} height={36} color={skeletonColor} />
        </View>
        <View style={[styles.avatarCircle, { backgroundColor: skeletonColor }]} />
      </View>

      {/* Choices skeleton */}
      <View style={styles.choicesSection}>
        <SkeletonPulse width={140} height={14} color={skeletonColor} />
        <SkeletonPulse width="100%" height={48} color={skeletonColor} />
        <SkeletonPulse width="100%" height={48} color={skeletonColor} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 14,
    gap: 12,
  },
  systemRow: {
    alignItems: 'center',
    marginVertical: 8,
  },
  messageRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
  },
  playerRow: {
    justifyContent: 'flex-end',
  },
  avatarCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
  },
  incomingBlock: {
    maxWidth: '78%',
    gap: 6,
  },
  playerBlock: {
    maxWidth: '78%',
  },
  choicesSection: {
    marginTop: 16,
    gap: 8,
  },
  skeletonBlock: {
    borderRadius: 12,
  },
});

