import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { Theme } from '../theme';

type StatItem = {
  icon: string;
  label: string;
  value: string | number;
  color: string;
};

type Props = {
  items: StatItem[];
  theme: Theme;
};

export function StatsBar({ items, theme }: Props) {
  return (
    <View style={styles.row}>
      {items.map((item) => (
        <View
          key={item.label}
          style={[
            styles.pill,
            { backgroundColor: theme.surface, borderColor: item.color, shadowColor: theme.shadow },
          ]}
        >
          <Text style={[styles.icon, { color: item.color }]}>{item.icon}</Text>
          <Text style={[styles.label, { color: theme.textMuted }]}>{item.label}</Text>
          <Text style={[styles.value, { color: theme.textPrimary }]}>{item.value}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: {
    flex: 1,
    minWidth: 72,
    borderWidth: 1.5,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 10,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 4,
    elevation: 2,
  },
  icon: { fontSize: 18, marginBottom: 2 },
  label: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.3 },
  value: { fontSize: 17, fontWeight: '900', marginTop: 2 },
});
