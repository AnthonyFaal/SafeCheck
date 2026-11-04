import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import * as Haptics from 'expo-haptics';
import type { Choice } from '../../models/Choice';
import type { Theme } from '../theme';

type Props = {
  choices: Choice[];
  onSelect: (choice: Choice) => void;
  disabled?: boolean;
  theme: Theme;
};

export function ChoiceButtons({ choices, onSelect, disabled, theme }: Props) {
  const handleSelect = (choice: Choice) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onSelect(choice);
  };

  return (
    <View style={styles.container}>
      <Text style={[styles.prompt, { color: theme.textSecondary }]}>What would you do?</Text>
      {choices.map((choice, index) => (
        <Pressable
          key={choice.id}
          onPress={() => handleSelect(choice)}
          disabled={disabled}
          style={({ pressed }) => [
            styles.button,
            {
              backgroundColor: pressed ? theme.buttonSecondaryBg : theme.choiceBg,
              borderColor: theme.choiceBorder,
              opacity: disabled ? 0.6 : 1,
            },
          ]}
        >
          <View style={[styles.indexBadge, { backgroundColor: theme.buttonPrimaryBg }]}>
            <Text style={styles.indexText}>{String.fromCharCode(65 + index)}</Text>
          </View>
          <Text style={[styles.buttonText, { color: theme.choiceText }]}>{choice.text}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginTop: 16, gap: 8 },
  prompt: { fontSize: 13, fontWeight: '700', marginBottom: 4 },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1.5,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  indexBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  indexText: { color: '#FFF', fontWeight: '900', fontSize: 13 },
  buttonText: { flex: 1, fontSize: 14, lineHeight: 20, fontWeight: '600' },
});
