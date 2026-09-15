import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Dimensions, Easing, Modal, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { CachedImage } from '../lib/imageCache';
import { typography, spacing, radius, useTheme } from '../theme';
import { Button, IconButton } from './ui';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const CARD_WIDTH = SCREEN_WIDTH * 0.78;
const CARD_HEIGHT = SCREEN_HEIGHT * 0.42;

export default function RandomPickModal({ visible, item, onReroll, onComplete, onClose }) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const flip = useRef(new Animated.Value(0)).current;
  const cardScale = useRef(new Animated.Value(0.8)).current;
  const bgOpacity = useRef(new Animated.Value(0)).current;
  const flipScaleX = flip.interpolate({ inputRange: [0, 1, 2], outputRange: [1, 0, 1] });
  const cardOpacity = flip.interpolate({ inputRange: [0, 0.9, 1.1, 2], outputRange: [1, 0, 0, 1] });

  useEffect(() => {
    if (!visible) return;
    bgOpacity.setValue(0); cardScale.setValue(0.5); flip.setValue(2);
    Animated.parallel([
      Animated.timing(bgOpacity, { toValue: 1, duration: 250, useNativeDriver: true }),
      Animated.spring(cardScale, { toValue: 1, friction: 6, tension: 80, useNativeDriver: true }),
      Animated.timing(flip, { toValue: 0, duration: 400, delay: 100, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start();
  }, [visible, bgOpacity, cardScale, flip]);

  const reroll = () => Animated.timing(flip, { toValue: 2, duration: 300, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(() => {
    onReroll?.();
    Animated.timing(flip, { toValue: 0, duration: 300, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  });
  const complete = () => Animated.parallel([
    Animated.timing(bgOpacity, { toValue: 0, duration: 250, useNativeDriver: true }),
    Animated.timing(cardScale, { toValue: 0.5, duration: 250, useNativeDriver: true }),
  ]).start(() => onComplete?.(item));
  if (!visible) return null;

  return <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={onClose}>
    <Animated.View style={[styles.overlay, { opacity: bgOpacity }]}>
      <View style={[styles.close, { top: insets.top + spacing[2] }]}><IconButton icon="close" size={22} color={colors.textOnPrimary} onPress={onClose} accessibilityLabel="关闭" style={styles.closeButton} /></View>
      <View style={styles.content}>
        <Ionicons name="dice-outline" size={40} color={colors.accent} />
        <Text style={styles.prompt}>命运为你抽中了</Text>
        <Animated.View style={[styles.wrapper, { transform: [{ scaleX: flipScaleX }, { scale: cardScale }], opacity: cardOpacity }]}>
          {item ? <View style={styles.card}>
            {item.image_url ? <><CachedImage source={item.image_url} style={styles.cardImage} contentFit="cover" previewable={false} /><View style={styles.imageOverlay} /><View style={styles.imageText}><Text style={styles.lightTitle}>{item.title}</Text>{item.whisper ? <Text style={styles.lightWhisper}>「{item.whisper}」</Text> : null}</View></> : <View style={styles.noImage}><View style={styles.iconTile}><Ionicons name="sparkles" size={48} color={colors.primary} /></View><Text style={styles.darkTitle}>{item.title}</Text>{item.whisper ? <Text style={styles.darkWhisper}>「{item.whisper}」</Text> : null}</View>}
          </View> : <View style={styles.empty}><Ionicons name="sparkles-outline" size={38} color={colors.primary} /><Text style={styles.darkTitle}>愿望都完成啦</Text><Text style={styles.darkWhisper}>去添加新的吧</Text></View>}
        </Animated.View>
        {item ? <View style={styles.actions}><Button variant="secondary" size="medium" iconLeft="dice-outline" onPress={reroll} style={styles.action}>换一个</Button><Button variant="primary" size="medium" iconRight="checkmark-circle-outline" onPress={complete} style={styles.action}>就它了</Button></View> : null}
      </View>
    </Animated.View>
  </Modal>;
}

const createStyles = (c) => StyleSheet.create({
  overlay: { flex: 1, backgroundColor: c.overlay, justifyContent: 'center', alignItems: 'center' }, close: { position: 'absolute', right: spacing[3], zIndex: 2 }, closeButton: { backgroundColor: c.primaryPressed },
  content: { alignItems: 'center', width: '100%' }, prompt: { ...typography.body, color: c.textOnPrimary, marginTop: spacing[1], marginBottom: spacing[5] }, wrapper: { width: CARD_WIDTH, height: CARD_HEIGHT },
  card: { flex: 1, backgroundColor: c.card, borderRadius: radius.xl, overflow: 'hidden', shadowColor: c.shadow, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.2, shadowRadius: 18, elevation: 7 }, cardImage: { ...StyleSheet.absoluteFillObject }, imageOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: c.overlay }, imageText: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: spacing[4] },
  lightTitle: { ...typography.cardTitle, color: c.textOnPrimary, marginBottom: spacing[1] }, lightWhisper: { ...typography.caption, color: c.textOnPrimary, fontStyle: 'italic' },
  noImage: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing[6], backgroundColor: c.primarySoft }, iconTile: { width: 96, height: 96, borderRadius: radius.xl, backgroundColor: c.card, alignItems: 'center', justifyContent: 'center', marginBottom: spacing[4] }, darkTitle: { ...typography.cardTitle, color: c.text, textAlign: 'center', marginTop: spacing[2] }, darkWhisper: { ...typography.caption, color: c.textSecondary, fontStyle: 'italic', textAlign: 'center', marginTop: spacing[1] },
  empty: { flex: 1, backgroundColor: c.card, borderRadius: radius.xl, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: c.border }, actions: { flexDirection: 'row', justifyContent: 'center', marginTop: spacing[8], paddingHorizontal: spacing[5] }, action: { marginHorizontal: spacing[1] },
});
