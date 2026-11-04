import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

type Props = {
  visible: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  appearance?: 'light' | 'dark';
};

export function AppBottomSheet({ visible, title, subtitle, onClose, children, appearance = 'dark' }: Props) {
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(28)).current;
  const contentOpacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.98)).current;

  useEffect(() => {
    if (!visible) return;

    backdropOpacity.setValue(0);
    translateY.setValue(28);
    contentOpacity.setValue(0);
    scale.setValue(0.98);

    Animated.parallel([
      Animated.timing(backdropOpacity, {
        toValue: 1,
        duration: 220,
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration: 260,
        useNativeDriver: true,
      }),
      Animated.timing(contentOpacity, {
        toValue: 1,
        duration: 260,
        delay: 80,
        useNativeDriver: true,
      }),
      Animated.spring(scale, {
        toValue: 1,
        friction: 8,
        tension: 90,
        useNativeDriver: true,
      }),
    ]).start();
  }, [visible, backdropOpacity, translateY, contentOpacity, scale]);

  return (
    <Modal transparent visible={visible} animationType="none" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Animated.View style={[styles.backdrop, { opacity: backdropOpacity }]} />
        <Pressable style={styles.backdropPress} onPress={onClose} />

        <Animated.View
          style={[
            styles.sheet,
            appearance === 'light' && light.sheet,
            {
              transform: [{ translateY }, { scale }],
            },
          ]}
        >
          <View style={[styles.handle, appearance === 'light' && light.handle]} />
          <View style={styles.header}>
            <View style={styles.titleWrap}>
              <Text style={[styles.title, appearance === 'light' && light.title]}>{title}</Text>
              {subtitle ? <Text style={[styles.subtitle, appearance === 'light' && light.subtitle]}>{subtitle}</Text> : null}
            </View>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel={`Close ${title}`}
              style={[styles.closeButton, appearance === 'light' && light.closeButton]}
            >
              <Text style={[styles.closeText, appearance === 'light' && light.closeText]}>×</Text>
            </Pressable>
          </View>

          <Animated.View style={{ opacity: contentOpacity }}>
            <ScrollView
              style={styles.scroll}
              contentContainerStyle={styles.content}
              keyboardShouldPersistTaps="handled"
            >
              {children}
            </ScrollView>
          </Animated.View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(2, 8, 20, 0.72)',
  },
  backdropPress: {
    ...StyleSheet.absoluteFill,
  },
  sheet: {
    backgroundColor: '#111A24',
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    borderWidth: 1,
    borderColor: '#2D4760',
    maxHeight: '92%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -16 },
    shadowOpacity: 0.28,
    shadowRadius: 24,
    elevation: 20,
  },
  handle: {
    alignSelf: 'center',
    width: 44,
    height: 5,
    borderRadius: 999,
    backgroundColor: '#506070',
    marginTop: 12,
    marginBottom: 10,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 12,
  },
  titleWrap: {
    flex: 1,
    paddingRight: 12,
  },
  title: {
    color: '#F8FAFC',
    fontSize: 19,
    fontWeight: '800',
  },
  subtitle: {
    color: '#84A7BE',
    fontSize: 12,
    marginTop: 4,
    lineHeight: 16,
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1D2A35',
  },
  closeText: {
    color: '#C7D3DF',
    fontSize: 24,
    lineHeight: 24,
  },
  scroll: {
    maxHeight: '100%',
  },
  content: {
    paddingHorizontal: 20,
    paddingBottom: 36,
  },
});

const light = StyleSheet.create({
  sheet: { backgroundColor: '#FFFFFF', borderColor: '#D7E0E8' },
  handle: { backgroundColor: '#B4C1CC' },
  title: { color: '#15212B' },
  subtitle: { color: '#526473' },
  closeButton: { backgroundColor: '#EAF0F5' },
  closeText: { color: '#304252' },
});
