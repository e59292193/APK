/**
 * RandomPickModal — full-screen random wish picker with card flip animation.
 * Shows a randomly selected pending wish with a flip effect.
 * Two actions: "换一个" (re-roll) or "就它了！去完成" (complete this one).
 *
 * Pure RN Animated, no third-party dependencies.
 */
import React, { useEffect, useRef, useCallback } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  Dimensions,
  Animated,
  Easing,
  Platform,
  StatusBar,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { CachedImage } from '../lib/imageCache';
import { colors, typography, spacing, radius, shadows } from '../theme';
import { Button, IconButton } from './ui';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

export default function RandomPickModal({ visible, item, onReroll, onComplete, onClose }) {
  const insets = useSafeAreaInsets();
  const flipAnim = useRef(new Animated.Value(0)).current;
  const cardScale = useRef(new Animated.Value(0.8)).current;
  const bgOpacity = useRef(new Animated.Value(0)).current;

  // Card flip interpolation: 0 = front, 1 = back (invisible), 2 = new front
  const flipScaleX = flipAnim.interpolate({
    inputRange: [0, 1, 2],
    outputRange: [1, 0, 1],
  });

  const cardOpacity = flipAnim.interpolate({
    inputRange: [0, 0.9, 1.1, 2],
    outputRange: [1, 0, 0, 1],
  });

  const playFlipIn = useCallback(() => {
    // Start from flipped state (showing back), flip to front
    flipAnim.setValue(2);
    Animated.timing(flipAnim, {
      toValue: 0,
      duration: 400,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, []);

  const playFlipOut = useCallback((callback) => {
    // Flip from front to back (hide), then callback to switch content
    Animated.timing(flipAnim, {
      toValue: 2,
      duration: 300,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(() => {
      if (callback) callback();
      // Flip back to front with new content
      Animated.timing(flipAnim, {
        toValue: 0,
        duration: 300,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    });
  }, []);

  // Play entrance animation when modal becomes visible
  useEffect(() => {
    if (visible) {
      bgOpacity.setValue(0);
      cardScale.setValue(0.5);
      flipAnim.setValue(2);

      Animated.parallel([
        Animated.timing(bgOpacity, {
          toValue: 1,
          duration: 250,
          useNativeDriver: true,
        }),
        Animated.spring(cardScale, {
          toValue: 1,
          friction: 6,
          tension: 80,
          useNativeDriver: true,
        }),
        Animated.timing(flipAnim, {
          toValue: 0,
          duration: 400,
          delay: 100,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [visible]);

  const handleReroll = () => {
    playFlipOut(() => {
      if (onReroll) onReroll();
    });
  };

  const handleComplete = () => {
    // Fade out then close
    Animated.parallel([
      Animated.timing(bgOpacity, {
        toValue: 0,
        duration: 250,
        useNativeDriver: true,
      }),
      Animated.timing(cardScale, {
        toValue: 0.5,
        duration: 250,
        useNativeDriver: true,
      }),
    ]).start(() => {
      if (onComplete) onComplete(item);
    });
  };

  if (!visible) return null;

  return (
    <Modal visible={true} transparent={true} animationType="none" statusBarTranslucent={true}>
      <Animated.View style={[styles.overlay, { opacity: bgOpacity }]}>
        {/* Close button — 44x44 IconButton */}
        <View style={[styles.closeWrap, { top: insets.top + spacing[2] }]}>
          <IconButton
            icon="close"
            size={22}
            color={colors.surface}
            onPress={onClose}
            accessibilityLabel="关闭"
            style={styles.closeButton}
          />
        </View>

        <View style={styles.content}>
          {/* Dice icon */}
          <View style={styles.diceWrap}>
            <Ionicons name="dice-outline" size={40} color={colors.primary[200]} />
          </View>
          <Text style={styles.promptText}>命运为你抽中了</Text>

          {/* Flip card */}
          <Animated.View
            style={[
              styles.cardWrapper,
              {
                transform: [
                  { scaleX: flipScaleX },
                  { scale: cardScale },
                ],
                opacity: cardOpacity,
              },
            ]}
          >
            {item ? (
              <View style={styles.card}>
                {item.image_url ? (
                  <>
                    <CachedImage
                      source={item.image_url}
                      style={styles.cardImage}
                      contentFit="cover"
                      previewable={false}
                    />
                    <View style={styles.cardImageGradient} />
                    <View style={styles.cardContentOverlay}>
                      <Text style={styles.cardTitleLight}>{item.title}</Text>
                      {item.whisper ? (
                        <Text style={styles.cardWhisperLight}>「{item.whisper}」</Text>
                      ) : null}
                    </View>
                  </>
                ) : (
                  <View style={styles.cardNoImageContent}>
                    <View style={styles.cardIconTile}>
                      <Ionicons name="sparkles" size={48} color={colors.primary[400]} />
                    </View>
                    <Text style={styles.cardTitleDark}>{item.title}</Text>
                    {item.whisper ? (
                      <Text style={styles.cardWhisperDark}>「{item.whisper}」</Text>
                    ) : null}
                  </View>
                )}
              </View>
            ) : (
              <View style={styles.emptyCard}>
                <View style={styles.emptyCardIconWrap}>
                  <Ionicons name="sparkles-outline" size={36} color={colors.primary[300]} />
                </View>
                <Text style={styles.emptyCardText}>愿望都完成啦</Text>
                <Text style={styles.emptyCardSubText}>去添加新的吧</Text>
              </View>
            )}
          </Animated.View>

          {/* Action buttons */}
          {item && (
            <View style={styles.actionRow}>
              <Button
                variant="secondary"
                size="medium"
                iconLeft="dice-outline"
                onPress={handleReroll}
                style={styles.actionButton}
              >
                换一个
              </Button>
              <Button
                variant="primary"
                size="medium"
                iconRight="checkmark-circle-outline"
                onPress={handleComplete}
                style={styles.actionButton}
              >
                就它了
              </Button>
            </View>
          )}
        </View>
      </Animated.View>
    </Modal>
  );
}

const CARD_WIDTH = SCREEN_WIDTH * 0.78;
const CARD_HEIGHT = SCREEN_HEIGHT * 0.42;

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeWrap: {
    position: 'absolute',
    right: spacing[3],
    zIndex: 2,
  },
  closeButton: {
    backgroundColor: colors.primary[900],
  },
  content: {
    alignItems: 'center',
    width: '100%',
  },
  diceWrap: {
    marginBottom: spacing[1],
  },
  promptText: {
    ...typography.body,
    color: colors.primary[200],
    marginBottom: spacing[5],
  },
  cardWrapper: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
  },
  card: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    overflow: 'hidden',
    ...shadows.floating,
  },
  cardImage: {
    ...StyleSheet.absoluteFillObject,
  },
  cardImageGradient: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.overlay,
  },
  cardContentOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: spacing[4],
  },
  cardTitleLight: {
    ...typography.cardTitle,
    color: colors.surface,
    textShadowColor: colors.shadow,
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
    marginBottom: spacing[1],
  },
  cardWhisperLight: {
    ...typography.caption,
    color: colors.surface,
    fontStyle: 'italic',
    textShadowColor: colors.shadow,
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  cardNoImageContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing[6],
    backgroundColor: colors.primary[50],
  },
  cardIconTile: {
    width: 96,
    height: 96,
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing[4],
    ...shadows.soft,
  },
  cardTitleDark: {
    ...typography.cardTitle,
    color: colors.textPrimary,
    textAlign: 'center',
    marginBottom: spacing[1],
  },
  cardWhisperDark: {
    ...typography.caption,
    color: colors.textSecondary,
    fontStyle: 'italic',
    textAlign: 'center',
  },
  emptyCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.medium,
  },
  emptyCardIconWrap: {
    width: 72,
    height: 72,
    borderRadius: radius.xl,
    backgroundColor: colors.primary[50],
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing[3],
  },
  emptyCardText: {
    ...typography.cardTitle,
    color: colors.textPrimary,
  },
  emptyCardSubText: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: spacing[1],
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: spacing[8],
    paddingHorizontal: spacing[5],
  },
  actionButton: {
    marginHorizontal: spacing[1],
  },
});
