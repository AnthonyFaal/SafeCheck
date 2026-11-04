import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { PlatformStyle } from '../platformTheme';
import type { Theme } from '../theme';

type Props = {
  platform: PlatformStyle;
  contactName?: string;
  difficulty?: number;
  theme: Theme;
};

export function PlatformChatHeader({
  platform,
  contactName,
  difficulty,
}: Props) {
  return (
    <View style={[styles.header, { backgroundColor: platform.headerBg }]}>
      <View style={styles.headerTop}>
        <Text style={[styles.platformIcon, { color: platform.headerText }]}>
          {platform.icon}
        </Text>

        <View style={styles.headerTextBlock}>
          <Text style={[styles.platformLabel, { color: platform.headerText }]}>
            {platform.label}
          </Text>

          {contactName ? (
            <Text
              style={[
                styles.contactName,
                { color: platform.headerText, opacity: 0.9 },
              ]}
            >
              {contactName}
            </Text>
          ) : null}
        </View>

{difficulty != null ? (
          <View style={styles.diffBadge}>
            <Text style={styles.diffText}>Difficulty {difficulty}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  platformIcon: {
    fontSize: 22,
  },
  headerTextBlock: {
    flex: 1,
  },
  platformLabel: {
    fontSize: 15,
    fontWeight: '800',
  },
  contactName: {
    fontSize: 12,
    marginTop: 1,
  },
  diffBadge: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  diffText: {
    color: '#FFF',
    fontSize: 11,
    fontWeight: '800',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
    flexWrap: 'wrap',
  },
  categoryChip: {
    fontSize: 11,
    fontWeight: '600',
    opacity: 0.85,
  },
  challengeBadge: {
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  challengeText: {
    fontSize: 10,
    fontWeight: '800',
  },
});