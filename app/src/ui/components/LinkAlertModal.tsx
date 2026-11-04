import React, { useEffect, useRef } from 'react';
import { View, Text, Pressable, Animated, StyleSheet, Dimensions } from 'react-native';
import type { Theme } from '../theme';

type Props = {
  visible: boolean;
  url: string;
  theme: Theme;
  onDismiss: () => void;
};

const { width: SCREEN_WIDTH } = Dimensions.get('window');

/**
 * LinkAlertModal — a themed, animated modal that replaces the native
 * Alert.alert() for link taps. Displays educational content about
 * simulated scam links in a consistent style matching the rest of the app.
 *
 * @example
 * ```tsx
 * <LinkAlertModal
 *   visible={showAlert}
 *   url="https://evil-phish.com"
 *   theme={theme}
 *   onDismiss={() => setShowAlert(false)}
 * />
 * ```
 */
export function LinkAlertModal({ visible, url, theme, onDismiss }: Props) {
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
        style={[styles.backdrop, { opacity: backdropOpacity }]}
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
            <Text style={styles.iconText}>🔗</Text>
          </View>
        </View>

        {/* Title */}
        <Text style={[styles.title, { color: theme.textPrimary }]}>
          Scam Link Detected
        </Text>

        {/* URL display */}
        <View style={[styles.urlContainer, { backgroundColor: theme.surface, borderColor: theme.cardBorder }]}>
          <Text style={[styles.urlText, { color: theme.danger }]} numberOfLines={3} ellipsizeMode="tail">
            {url}
          </Text>
        </View>

        {/* Description */}
        <Text style={[styles.description, { color: theme.textSecondary }]}>
          This is a simulated phishing link used for training purposes. In a real scenario, clicking links like this could lead to stolen credentials, malware, or financial loss.
        </Text>

        {/* Tip bar */}
        <View style={[styles.tipBar, { backgroundColor: theme.warning + '15', borderColor: theme.warning + '30' }]}>
          <Text style={styles.tipIcon}>💡</Text>
          <Text style={[styles.tipText, { color: theme.warning }]}>
            Always verify the domain before clicking.
          </Text>
        </View>

        {/* Action button */}
        <Pressable
          onPress={onDismiss}
          style={({ pressed }) => [
            styles.dismissButton,
            {
              backgroundColor: pressed ? '#6D28D9' : '#7C3AED',
              opacity: pressed ? 0.9 : 1,
            },
          ]}
        >
          <Text style={styles.dismissButtonText}>Understood</Text>
        </Pressable>
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
    marginBottom: 12,
  },
  urlContainer: {
    width: '100%',
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
  },
  urlText: {
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
    lineHeight: 18,
  },
  description: {
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 16,
    paddingHorizontal: 4,
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
  dismissButton: {
    width: '100%',
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dismissButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
  },
});

