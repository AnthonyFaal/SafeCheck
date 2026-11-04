import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { ResolvedMessage } from '../../core/game/CharacterResolver';
import type { PlatformStyle } from '../platformTheme';
import type { Theme } from '../theme';
import { LinkifiedText } from './LinkifiedText';

type Props = {
  resolved: ResolvedMessage;
  platform: PlatformStyle;
  theme: Theme;
  showTyping?: boolean;
  timestamp?: string;
  showReadReceipt?: boolean;
};

export function ChatBubble({ resolved, platform, theme, showTyping, timestamp, showReadReceipt }: Props) {
  const { isPlayer, displayName, avatar, message, isSystem } = resolved;

  if (isSystem) {
    return (
      <View style={styles.systemRow}>
        <View style={[styles.systemBubble, { backgroundColor: theme.divider }]}>
          <LinkifiedText
            text={message.text}
            baseStyle={[styles.systemText, { color: theme.textMuted }]}
            linkStyle={{ color: theme.textMuted, textDecorationLine: 'underline', fontWeight: '700', opacity: 0.85 }}
            theme={theme}
          />
        </View>
      </View>
    );
  }

  const bubbleBg = isPlayer
    ? theme.mode === 'light'
      ? theme.bubbleRightBg
      : '#005C4B'
    : theme.mode === 'light'
      ? platform.incomingBubble
      : theme.bubbleLeftBg;

  const textColor = isPlayer
    ? theme.mode === 'light'
      ? theme.bubbleRightText
      : theme.bubbleRightText
    : theme.mode === 'light'
      ? platform.incomingText
      : theme.bubbleLeftText;

  return (
    <View style={[styles.row, isPlayer ? styles.rowRight : styles.rowLeft]}>
      {!isPlayer ? (
        <View style={[styles.avatarCircle, { backgroundColor: theme.divider }]}>
          <Text style={styles.avatarEmoji}>{avatar}</Text>
        </View>
      ) : null}

      <View style={[styles.bubbleWrap, isPlayer ? styles.bubbleWrapRight : styles.bubbleWrapLeft]}>
        {!isPlayer ? (
          <Text style={[styles.senderName, { color: theme.textMuted }]}>{displayName}</Text>
        ) : null}

        <View
          style={[
            styles.bubble,
            isPlayer ? styles.bubbleRight : styles.bubbleLeft,
            { backgroundColor: bubbleBg },
            // Add distinct border for player messages to improve differentiation
            isPlayer && { borderWidth: 1.5, borderColor: theme.buttonPrimaryBg + '40' },
          ]}
        >
          {/* "You" badge inside the bubble for clear identification */}
          {isPlayer ? (
            <View style={[styles.youBadgeInline, { backgroundColor: theme.buttonPrimaryBg }]}>
              <Text style={styles.youBadgeText}>YOU</Text>
            </View>
          ) : null}

            {showTyping ? (
            <Text style={[styles.bubbleText, { color: textColor, fontStyle: 'italic' }]}>typing…</Text>
          ) : (
            <LinkifiedText
              text={message.text}
              baseStyle={[styles.bubbleText, { color: textColor }]}
              linkStyle={{
                color: textColor,
                textDecorationLine: 'underline',
                fontWeight: '700',
              }}
              theme={theme}
            />
          )}

          {!!message.tags?.length && !showTyping ? (
            <View style={styles.tagRow}>
              {message.tags.slice(0, 2).map((tag) => (
                <View key={tag} style={[styles.tag, { backgroundColor: theme.systemTagBg }]}>
                  <Text style={[styles.tagText, { color: theme.systemTagText }]}>{tag}</Text>
                </View>
              ))}
            </View>
          ) : null}

          {/* Timestamp on bubbles */}
          {timestamp && !showTyping ? (
            <View style={styles.metaRow}>
              <Text style={[styles.timestampText, { color: textColor, opacity: 0.5 }]}>{timestamp}</Text>
              {isPlayer && showReadReceipt ? (
                <Text style={[styles.readReceiptText, { color: textColor, opacity: 0.6 }]}> ✓✓</Text>
              ) : null}
            </View>
          ) : null}
        </View>
      </View>

      {isPlayer ? (
        <View style={[styles.avatarCircle, { backgroundColor: theme.buttonPrimaryBg }]}>
          <Text style={styles.avatarEmoji}>{avatar}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginBottom: 10,
    gap: 8,
  },
  rowLeft: { justifyContent: 'flex-start' },
  rowRight: { justifyContent: 'flex-end' },
  avatarCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarEmoji: { fontSize: 16 },
  bubbleWrap: { maxWidth: '78%' },
  bubbleWrapLeft: { alignItems: 'flex-start' },
  bubbleWrapRight: { alignItems: 'flex-end' },
  senderName: { fontSize: 11, fontWeight: '700', marginBottom: 3, marginLeft: 4 },
  youBadgeInline: {
    alignSelf: 'flex-start',
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
    marginBottom: 4,
  },
  youBadgeText: { color: '#FFF', fontSize: 9, fontWeight: '900', letterSpacing: 0.5 },
  bubble: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  bubbleLeft: {
    borderTopLeftRadius: 4,
    borderTopRightRadius: 16,
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 16,
  },
  bubbleRight: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 4,
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 16,
  },
  bubbleText: { fontSize: 14, lineHeight: 20 },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 6 },
  tag: { borderRadius: 999, paddingHorizontal: 6, paddingVertical: 2 },
  tagText: { fontSize: 9, fontWeight: '800' },
  systemRow: { alignItems: 'center', marginVertical: 8 },
  systemBubble: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5 },
  systemText: { fontSize: 11, fontWeight: '600' },
  metaRow: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  timestampText: { fontSize: 10, fontWeight: '500' },
  readReceiptText: { fontSize: 11, fontWeight: '700' },
});
