import React, { useCallback, useState } from 'react';
import { Text, StyleSheet, type TextStyle } from 'react-native';
import type { Theme } from '../theme';
import { LinkAlertModal } from './LinkAlertModal';

/**
 * Regular expression to detect URLs (http, https, www, or domain-based).
 * Captures full URLs including paths, query params, and fragments.
 */
const URL_REGEX = /(https?:\/\/[^\s]+)|(www\.[^\s]+)|([a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+\/[^\s]*)/gi;

type LinkifiedTextProps = {
  text: string;
  baseStyle?: TextStyle | TextStyle[];
  linkStyle?: TextStyle | TextStyle[];
  /** Custom link press handler. If provided, overrides the default educational alert. */
  onLinkPress?: (url: string) => void;
  /** Theme object for consistent styling of the link alert modal. */
  theme: Theme;
};

/**
 * Parses a string of text and renders embedded URLs as styled, pressable links.
 *
 * URL segments are rendered with the `linkStyle` (default: blue + underline),
 * while non-URL segments use the `baseStyle`.
 *
 * Tapping on a detected link shows an educational modal explaining it's
 * a simulated scam link, unless a custom `onLinkPress` handler is provided.
 *
 * @example
 * ```tsx
 * <LinkifiedText
 *   text="Visit https://example.com for more info"
 *   baseStyle={{ fontSize: 14, color: '#333' }}
 *   linkStyle={{ color: '#1A73E8', textDecorationLine: 'underline' }}
 *   theme={theme}
 * />
 * ```
 */
export function LinkifiedText({
  text,
  baseStyle,
  linkStyle,
  onLinkPress,
  theme,
}: LinkifiedTextProps) {
  const [tappedUrl, setTappedUrl] = useState<string | null>(null);
  const [showAlert, setShowAlert] = useState(false);

  const handleLinkPress = useCallback(
    (url: string) => {
      if (onLinkPress) {
        onLinkPress(url);
        return;
      }

      setTappedUrl(url);
      setShowAlert(true);
    },
    [onLinkPress]
  );

  const handleDismiss = useCallback(() => {
    setShowAlert(false);
    setTappedUrl(null);
  }, []);

  // Split text by URL matches, preserving both the matched URLs and non-URL segments
  const segments: Array<{ text: string; isLink: boolean }> = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  const regex = new RegExp(URL_REGEX.source, URL_REGEX.flags);

  while ((match = regex.exec(text)) !== null) {
    // Push text before the match
    if (match.index > lastIndex) {
      segments.push({
        text: text.slice(lastIndex, match.index),
        isLink: false,
      });
    }

    // The matched URL
    const matchedUrl = match[0];

    segments.push({
      text: matchedUrl,
      isLink: true,
    });

    lastIndex = match.index + matchedUrl.length;
  }

  // Push remaining text after the last match
  if (lastIndex < text.length) {
    segments.push({
      text: text.slice(lastIndex),
      isLink: false,
    });
  }

  // If no URLs found, render plain text for performance
  if (segments.length === 1 && !segments[0].isLink) {
    return (
      <>
        <Text style={baseStyle as TextStyle}>{text}</Text>
        {tappedUrl ? (
          <LinkAlertModal
            visible={showAlert}
            url={tappedUrl}
            theme={theme}
            onDismiss={handleDismiss}
          />
        ) : null}
      </>
    );
  }

  return (
    <>
      <Text style={baseStyle as TextStyle}>
        {segments.map((segment, index) => {
          if (segment.isLink) {
            return (
              <Text
                key={`link-${index}`}
                style={[defaultStyles.link, linkStyle]}
                onPress={() => handleLinkPress(segment.text)}
                accessibilityLabel={`Link: ${segment.text}. Tap to learn more.`}
                accessibilityRole="link"
              >
                {segment.text}
              </Text>
            );
          }
          return <Text key={`text-${index}`}>{segment.text}</Text>;
        })}
      </Text>
      {tappedUrl ? (
        <LinkAlertModal
          visible={showAlert}
          url={tappedUrl}
          theme={theme}
          onDismiss={handleDismiss}
        />
      ) : null}
    </>
  );
}

const defaultStyles = StyleSheet.create({
  link: {
    color: '#1A73E8',
    textDecorationLine: 'underline',
    fontWeight: '700',
  },
});

