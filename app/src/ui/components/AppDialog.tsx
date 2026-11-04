import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Dimensions,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

export type DialogVariant = 'info' | 'success' | 'warning' | 'danger';

export type DialogButton = {
  label: string;
  variant?: 'primary' | 'secondary' | 'danger';
  onPress?: () => void;
};

type Props = {
  visible: boolean;
  title: string;
  message: string;
  icon?: string;
  variant?: DialogVariant;
  buttons?: DialogButton[];
  onDismiss: () => void;
  appearance?: 'light' | 'dark';
};

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const toneMap: Record<DialogVariant, { accent: string; surface: string; iconBg: string; text: string }> = {
  info: {
    accent: '#52B6FF',
    surface: '#173B4C',
    iconBg: '#1F4A5D',
    text: '#D7F0FF',
  },
  success: {
    accent: '#42C59A',
    surface: '#16362B',
    iconBg: '#214B3A',
    text: '#DFF8EC',
  },
  warning: {
    accent: '#FFBD59',
    surface: '#35271A',
    iconBg: '#4B351D',
    text: '#FFE4B6',
  },
  danger: {
    accent: '#F36F70',
    surface: '#3A1C22',
    iconBg: '#4B242B',
    text: '#FFD4D7',
  },
};

export function AppDialog({
  visible,
  title,
  message,
  icon = '💬',
  variant = 'info',
  buttons = [{ label: 'Close' }],
  onDismiss,
  appearance = 'dark',
}: Props) {
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  const cardScale = useRef(new Animated.Value(0.95)).current;
  const cardTranslateY = useRef(new Animated.Value(18)).current;

  useEffect(() => {
    if (!visible) return;

    backdropOpacity.setValue(0);
    cardScale.setValue(0.95);
    cardTranslateY.setValue(18);

    Animated.parallel([
      Animated.timing(backdropOpacity, {
        toValue: 1,
        duration: 220,
        useNativeDriver: true,
      }),
      Animated.spring(cardScale, {
        toValue: 1,
        friction: 8,
        tension: 100,
        useNativeDriver: true,
      }),
      Animated.timing(cardTranslateY, {
        toValue: 0,
        duration: 220,
        useNativeDriver: true,
      }),
    ]).start();
  }, [visible, backdropOpacity, cardScale, cardTranslateY]);

  if (!visible) return null;

  const tone = toneMap[variant];

  return (
    <Modal transparent visible={visible} animationType="none" onRequestClose={onDismiss}>
      <View style={styles.overlay}>
        <Animated.View style={[styles.backdrop, { opacity: backdropOpacity }]} />
        <Pressable style={styles.backdropPress} onPress={onDismiss} />

        <Animated.View
          style={[
            styles.card,
            {
              backgroundColor: '#111A24',
              ...(appearance === 'light' ? { backgroundColor: '#FFFFFF' } : {}),
              borderColor: tone.accent + '44',
              transform: [{ scale: cardScale }, { translateY: cardTranslateY }],
            },
          ]}
        >
          <View style={[styles.iconWrap, { backgroundColor: tone.iconBg }]}> 
            <View style={[styles.iconCircle, { backgroundColor: tone.surface }]}> 
              <Text style={[styles.icon, { color: tone.accent }]}>{icon}</Text>
            </View>
          </View>

          <Text style={[styles.title, appearance === 'light' && light.title]}>{title}</Text>
          <Text style={[styles.message, appearance === 'light' && light.message]}>{message}</Text>

          <View style={styles.actions}>
            {buttons.map((button, index) => {
              const styleVariant = button.variant ?? (index === buttons.length - 1 ? 'primary' : 'secondary');
              const isDanger = styleVariant === 'danger';
              return (
                <Pressable
                  key={`${button.label}-${index}`}
                  onPress={() => {
                    button.onPress?.();
                    onDismiss();
                  }}
                  style={({ pressed }) => [
                    styles.button,
                    styleVariant === 'secondary' && styles.buttonSecondary,
                    styleVariant === 'danger' && styles.buttonDanger,
                    styleVariant === 'primary' && {
                      backgroundColor: pressed ? '#3B82F6' : tone.accent,
                    },
                    styleVariant === 'secondary' && {
                      backgroundColor: pressed ? '#203644' : 'transparent',
                      borderColor: tone.accent + '66',
                    },
                    styleVariant === 'danger' && {
                      backgroundColor: pressed ? '#C53D42' : '#B6444B',
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.buttonText,
                      styleVariant === 'secondary' && { color: tone.text },
                      isDanger && { color: '#FFFFFF' },
                      styleVariant === 'primary' && { color: '#07141C' },
                    ]}
                  >
                    {button.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(2, 8, 20, 0.72)',
  },
  backdropPress: {
    ...StyleSheet.absoluteFill,
  },
  card: {
    width: SCREEN_WIDTH - 48,
    maxWidth: 360,
    borderRadius: 24,
    borderWidth: 1,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.3,
    shadowRadius: 24,
    elevation: 18,
  },
  iconWrap: {
    width: 74,
    height: 74,
    borderRadius: 37,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: 14,
  },
  iconCircle: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: {
    fontSize: 26,
  },
  title: {
    color: '#F8FAFC',
    fontSize: 20,
    fontWeight: '800',
    textAlign: 'center',
  },
  message: {
    marginTop: 8,
    color: '#C8D4E1',
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 10,
    marginTop: 20,
    flexWrap: 'wrap',
  },
  button: {
    minWidth: 110,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonSecondary: {
    borderWidth: 1,
  },
  buttonDanger: {
    backgroundColor: '#B6444B',
  },
  buttonText: {
    fontWeight: '800',
    fontSize: 13,
  },
});

const light = StyleSheet.create({
  title: { color: '#15212B' },
  message: { color: '#526473' },
});
