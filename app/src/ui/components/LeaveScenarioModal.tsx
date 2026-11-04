import React, { useEffect, useRef } from 'react';
import { View, Text, Pressable, Animated, StyleSheet, Dimensions } from 'react-native';
import type { Theme } from '../theme';

type Props = {
  visible: boolean;
  theme: Theme;
  onStay: () => void;
  onLeave: () => void;
};

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export function LeaveScenarioModal({ visible, theme, onStay, onLeave }: Props) {
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  const modalScale = useRef(new Animated.Value(0.85)).current;
  const modalTranslateY = useRef(new Animated.Value(60)).current;

  useEffect(() => {
    if (visible) {
      backdropOpacity.setValue(0);
      modalScale.setValue(0.85);
      modalTranslateY.setValue(60);

      Animated.parallel([
        Animated.timing(backdropOpacity, {
          toValue: 1,
          duration: 250,
          useNativeDriver: true,
        }),
        Animated.spring(modalScale, {
          toValue: 1,
          friction: 8,
          tension: 100,
          useNativeDriver: true,
        }),
        Animated.timing(modalTranslateY, {
          toValue: 0,
          duration: 250,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [visible, backdropOpacity, modalScale, modalTranslateY]);

  if (!visible) return null;

  return (
    <View style={styles.overlay}>
      {/* Animated backdrop */}
      <Animated.View
        style={[
          styles.backdrop,
          { opacity: backdropOpacity },
        ]}
        pointerEvents="none"
      />

      {/* Modal card */}
      <Animated.View
        style={[
          styles.modalCard,
          {
            backgroundColor: theme.cardBg,
            borderColor: theme.cardBorder,
            shadowColor: theme.shadow,
            transform: [
              { scale: modalScale },
              { translateY: modalTranslateY },
            ],
          },
        ]}
      >
        {/* Icon */}
        <View style={[styles.iconContainer, { backgroundColor: theme.danger + '20' }]}>
          <View style={[styles.iconInner, { backgroundColor: theme.danger + '40' }]}>
            <Text style={styles.iconText}>⚠️</Text>
          </View>
        </View>

        {/* Title */}
        <Text style={[styles.title, { color: theme.textPrimary }]}>
          Leave Scenario?
        </Text>

        {/* Description */}
        <Text style={[styles.description, { color: theme.textSecondary }]}>
          Your progress in this scenario will be lost. Are you sure you want to exit?
        </Text>

        {/* Tip bar */}
        <View style={[styles.tipBar, { backgroundColor: theme.warning + '15', borderColor: theme.warning + '30' }]}>
          <Text style={styles.tipIcon}>💡</Text>
          <Text style={[styles.tipText, { color: theme.warning }]}>
            You can replay any scenario from the home screen
          </Text>
        </View>

        {/* Action buttons */}
        <View style={styles.actions}>
          <Pressable
            onPress={onLeave}
            style={({ pressed }) => [
              styles.leaveButton,
              {
                backgroundColor: pressed ? theme.danger + '15' : 'transparent',
                borderColor: theme.danger,
                opacity: pressed ? 0.8 : 1,
              },
            ]}
          >
            <Text style={[styles.leaveButtonText, { color: theme.danger }]}>
              Leave
            </Text>
          </Pressable>

          <Pressable
            onPress={onStay}
            style={({ pressed }) => [
              styles.stayButton,
              {
                backgroundColor: pressed ? '#6D28D9' : '#7C3AED',
                opacity: pressed ? 0.9 : 1,
              },
            ]}
          >
            <Text style={styles.stayButtonText}>Stay & Continue</Text>
          </Pressable>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 200,
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  modalCard: {
    width: SCREEN_WIDTH - 48,
    maxWidth: 360,
    borderRadius: 24,
    borderWidth: 1,
    paddingHorizontal: 24,
    paddingVertical: 28,
    alignItems: 'center',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.35,
    shadowRadius: 24,
    elevation: 16,
  },
  iconContainer: {
    width: 72,
    height: 72,
    borderRadius: 36,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  iconInner: {
    width: 52,
    height: 52,
    borderRadius: 26,
    justifyContent: 'center',
    alignItems: 'center',
  },
  iconText: {
    fontSize: 28,
  },
  title: {
    fontSize: 22,
    fontWeight: '900',
    textAlign: 'center',
    marginBottom: 8,
  },
  description: {
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 16,
    paddingHorizontal: 8,
  },
  tipBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 20,
    width: '100%',
  },
  tipIcon: {
    fontSize: 16,
  },
  tipText: {
    fontSize: 12,
    fontWeight: '700',
    flex: 1,
    lineHeight: 16,
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    width: '100%',
  },
  leaveButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  leaveButtonText: {
    fontSize: 15,
    fontWeight: '800',
  },
  stayButton: {
    flex: 1.5,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stayButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
  },
});

