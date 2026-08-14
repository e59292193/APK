import React, { memo, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getCategoryHint } from '../../lib/drawGuessUtils';
import { COLORS, SIZES } from '../../hooks/useDrawGuessSession';

const C = {
  primary: '#8C69CA',
  primarySoft: '#EEE7FA',
  mint: '#69B79B',
  danger: '#D86560',
  text: '#3D3450',
  sub: '#8B8398',
  border: '#EFEAF6',
  surface: '#FFFFFF',
};

export const QUICK_PHRASES = ['像什么？', '太抽象了😂', '再画一点', '我知道了！', '换个词吧', '厉害！'];

function sameColor(a, b) {
  return Array.isArray(a) && Array.isArray(b) && a.join(',') === b.join(',');
}

function rgb(color) {
  return `rgb(${color[0]},${color[1]},${color[2]})`;
}

export const CountdownPill = memo(function CountdownPill({ seconds, total = 60 }) {
  const value = Math.max(0, Number(seconds) || 0);
  const urgent = value <= 10;
  const ratio = Math.min(1, value / Math.max(1, total));
  return (
    <View style={[styles.timer, urgent && styles.timerUrgent]} accessibilityLabel={`剩余${value}秒`}>
      <Ionicons name="time-outline" size={14} color={urgent ? C.danger : C.primary} />
      <Text style={[styles.timerText, urgent && styles.timerTextUrgent]}>{value}s</Text>
      <View style={styles.timerTrack}>
        <View
          style={[
            styles.timerFill,
            { width: `${Math.round(ratio * 100)}%` },
            urgent && styles.timerFillUrgent,
          ]}
        />
      </View>
    </View>
  );
});

function maskWord(word) {
  return Array.from(String(word || ''))
    .map((char) => (char.trim() ? '＿' : '　'))
    .join(' ');
}

export const WordBar = memo(function WordBar({ game, isDrawer, remainSec }) {
  if (!game || game.status !== 'drawing') return null;
  const word = String(game.word || '');
  let category = '';
  try {
    category = getCategoryHint(word) || '';
  } catch (error) {
    category = '';
  }

  return (
    <View style={styles.wordBar}>
      <View style={styles.wordMain}>
        <Text style={styles.wordEyebrow}>{isDrawer ? '请画出' : category || '猜猜是什么'}</Text>
        <Text style={[styles.wordValue, !isDrawer && styles.wordMask]} numberOfLines={1}>
          {isDrawer ? word : maskWord(word)}
        </Text>
        {!isDrawer ? (
          <Text style={styles.wordMeta}>
            {Array.from(word).length} 个字{game.hint ? ` · 提示：${game.hint}` : ''}
          </Text>
        ) : game.hint ? (
          <Text style={styles.wordMeta}>已提示：{game.hint}</Text>
        ) : null}
      </View>
      <CountdownPill seconds={remainSec} total={60} />
    </View>
  );
});

export const Toolbar = memo(function Toolbar({ tool, disabled, onChangeTool, onUndo, onClear }) {
  const value = tool || { color: COLORS[0], width: SIZES[1], isEraser: false };
  const patch = (next) => onChangeTool && onChangeTool({ ...value, ...next });

  return (
    <View style={[styles.toolbar, disabled && styles.disabled]} pointerEvents={disabled ? 'none' : 'auto'}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.toolbarScroll}
      >
        <View style={styles.colorRow}>
          {COLORS.map((color) => {
            const selected = !value.isEraser && sameColor(value.color, color);
            return (
              <TouchableOpacity
                key={color.join('-')}
                accessibilityRole="button"
                accessibilityLabel="画笔颜色"
                style={[styles.colorHit, selected && styles.colorHitSelected]}
                onPress={() => patch({ color, isEraser: false })}
              >
                <View style={[styles.colorDot, { backgroundColor: rgb(color) }]} />
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={styles.divider} />

        <View style={styles.sizeRow}>
          {SIZES.map((width) => {
            const selected = !value.isEraser && value.width === width;
            return (
              <TouchableOpacity
                key={width}
                style={[styles.iconBtn, selected && styles.iconBtnSelected]}
                accessibilityLabel={`画笔粗细${width}`}
                onPress={() => patch({ width, isEraser: false })}
              >
                <View
                  style={[
                    styles.sizeDot,
                    {
                      width: Math.max(4, width + 2),
                      height: Math.max(4, width + 2),
                      borderRadius: width + 2,
                    },
                  ]}
                />
              </TouchableOpacity>
            );
          })}
        </View>

        <TouchableOpacity
          style={[styles.iconBtn, value.isEraser && styles.iconBtnSelected]}
          accessibilityLabel="橡皮擦"
          onPress={() => patch({ isEraser: true })}
        >
          <Ionicons name="bandage-outline" size={19} color={value.isEraser ? C.primary : C.sub} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.iconBtn} accessibilityLabel="撤销" onPress={onUndo}>
          <Ionicons name="arrow-undo-outline" size={20} color={C.sub} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.iconBtn} accessibilityLabel="清空画布" onPress={onClear}>
          <Ionicons name="trash-outline" size={19} color={C.danger} />
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
});

export const GuessBar = memo(function GuessBar({ disabled, onSubmit, onQuick }) {
  const [value, setValue] = useState('');

  const submit = () => {
    const text = value.trim();
    if (!text || disabled) return;
    setValue('');
    if (onSubmit) onSubmit(text);
  };

  return (
    <View style={styles.guessArea}>
      <ScrollView
        horizontal
        keyboardShouldPersistTaps="handled"
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.quickRow}
      >
        {QUICK_PHRASES.map((text) => (
          <TouchableOpacity
            key={text}
            style={styles.quickChip}
            disabled={disabled}
            onPress={() => onQuick && onQuick(text)}
          >
            <Text style={styles.quickText}>{text}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
      <View style={styles.guessRow}>
        <TextInput
          style={styles.guessInput}
          value={value}
          onChangeText={setValue}
          editable={!disabled}
          maxLength={30}
          placeholder={disabled ? '等待下一轮…' : '输入你的答案'}
          placeholderTextColor={C.sub}
          returnKeyType="send"
          blurOnSubmit={false}
          onSubmitEditing={submit}
        />
        <TouchableOpacity
          style={[styles.sendBtn, (!value.trim() || disabled) && styles.sendBtnDisabled]}
          disabled={!value.trim() || disabled}
          onPress={submit}
          accessibilityLabel="发送答案"
        >
          <Ionicons name="send" size={17} color="#FFF" />
        </TouchableOpacity>
      </View>
    </View>
  );
});

const FeedItem = memo(function FeedItem({ item, mine, index }) {
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(progress, {
      toValue: 1,
      duration: 4100,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [progress]);

  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [16, -34] });
  const opacity = progress.interpolate({
    inputRange: [0, 0.12, 0.78, 1],
    outputRange: [0, 1, 1, 0],
  });
  const tint = item.kind === 'win' ? styles.feedWin : mine ? styles.feedMine : styles.feedOther;

  return (
    <Animated.View
      style={[
        styles.feedItem,
        tint,
        { top: 12 + (index % 4) * 40, opacity, transform: [{ translateY }] },
      ]}
    >
      <Text style={styles.feedText} numberOfLines={1}>{item.text}</Text>
    </Animated.View>
  );
});

export const FeedOverlay = memo(function FeedOverlay({ items, userId }) {
  return (
    <View style={styles.feedLayer} pointerEvents="none">
      {(items || []).map((item, index) => (
        <FeedItem key={item.id} item={item} mine={item.from === userId} index={index} />
      ))}
    </View>
  );
});

// 本轮猜词记录（持久显示）：画画方能看到对方猜过的每个词，
// 弥补弹幕 4 秒即逝、专注画画容易错过的问题
export const GuessHistory = memo(function GuessHistory({ items }) {
  const list = items || [];
  if (list.length === 0) return null;
  return (
    <ScrollView
      horizontal
      style={styles.guessHistory}
      contentContainerStyle={styles.guessHistoryRow}
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      pointerEvents="none"
    >
      {list.map((item) => (
        <View
          key={item.id}
          style={[styles.guessChip, item.kind === 'win' && styles.guessChipWin]}
        >
          <Text style={styles.guessChipText} numberOfLines={1}>{item.text}</Text>
        </View>
      ))}
    </ScrollView>
  );
});

export const HeaderActions = memo(function HeaderActions({ onGallery, onWords }) {
  return (
    <View style={styles.headerActions}>
      <TouchableOpacity style={styles.headerBtn} onPress={onWords} accessibilityLabel="自定义词库">
        <Ionicons name="sparkles-outline" size={18} color={C.primary} />
      </TouchableOpacity>
      <TouchableOpacity style={styles.headerBtn} onPress={onGallery} accessibilityLabel="画廊">
        <Ionicons name="images-outline" size={18} color={C.primary} />
      </TouchableOpacity>
    </View>
  );
});

const styles = StyleSheet.create({
  wordBar: { width: '100%', minHeight: 66, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 18, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border },
  wordMain: { flex: 1, paddingRight: 10 },
  wordEyebrow: { color: C.sub, fontSize: 11, fontWeight: '600' },
  wordValue: { color: C.text, fontSize: 20, lineHeight: 25, fontWeight: '800', marginTop: 1 },
  wordMask: { letterSpacing: 1, fontSize: 17 },
  wordMeta: { color: C.sub, fontSize: 11, marginTop: 2 },
  timer: { minWidth: 70, paddingHorizontal: 9, paddingVertical: 7, borderRadius: 13, backgroundColor: C.primarySoft, flexDirection: 'row', alignItems: 'center', gap: 4 },
  timerUrgent: { backgroundColor: '#FCECEB' },
  timerText: { color: C.primary, fontWeight: '800', fontVariant: ['tabular-nums'] },
  timerTextUrgent: { color: C.danger },
  timerTrack: { position: 'absolute', left: 8, right: 8, bottom: 3, height: 2, borderRadius: 2, overflow: 'hidden', backgroundColor: '#DDD5EA' },
  timerFill: { height: 2, borderRadius: 2, backgroundColor: C.primary },
  timerFillUrgent: { backgroundColor: C.danger },
  toolbar: { width: '100%', height: 50, borderRadius: 16, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border },
  disabled: { opacity: 0.45 },
  toolbarScroll: { minWidth: '100%', paddingHorizontal: 7, alignItems: 'center' },
  colorRow: { flexDirection: 'row', alignItems: 'center' },
  colorHit: { width: 31, height: 34, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  colorHitSelected: { backgroundColor: C.primarySoft },
  colorDot: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: '#FFF' },
  divider: { width: 1, height: 24, marginHorizontal: 4, backgroundColor: C.border },
  sizeRow: { flexDirection: 'row' },
  iconBtn: { width: 35, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  iconBtnSelected: { backgroundColor: C.primarySoft },
  sizeDot: { backgroundColor: C.text },
  guessArea: { width: '100%' },
  quickRow: { gap: 7, paddingBottom: 8 },
  quickChip: { paddingHorizontal: 11, paddingVertical: 7, borderRadius: 15, backgroundColor: C.primarySoft },
  quickText: { color: C.primary, fontSize: 12, fontWeight: '600' },
  guessRow: { height: 46, flexDirection: 'row', gap: 8 },
  guessInput: { flex: 1, borderRadius: 15, borderWidth: 1, borderColor: C.border, backgroundColor: C.surface, color: C.text, paddingHorizontal: 14, fontSize: 14 },
  sendBtn: { width: 46, borderRadius: 15, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center' },
  sendBtnDisabled: { opacity: 0.42 },
  feedLayer: { ...StyleSheet.absoluteFillObject, overflow: 'hidden', zIndex: 10 },
  feedItem: { position: 'absolute', maxWidth: '78%', paddingHorizontal: 11, paddingVertical: 7, borderRadius: 14 },
  feedMine: { right: 12, backgroundColor: 'rgba(140,105,202,0.9)' },
  feedOther: { left: 12, backgroundColor: 'rgba(61,52,80,0.83)' },
  feedWin: { left: '18%', backgroundColor: 'rgba(105,183,155,0.94)' },
  feedText: { color: '#FFF', fontSize: 12, fontWeight: '700' },
  guessHistory: { width: '100%', maxHeight: 30, marginTop: 8 },
  guessHistoryRow: { gap: 6, alignItems: 'center' },
  guessChip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 13, backgroundColor: 'rgba(61,52,80,0.78)' },
  guessChipWin: { backgroundColor: 'rgba(105,183,155,0.94)' },
  guessChipText: { color: '#FFF', fontSize: 12, fontWeight: '600' },
  headerActions: { flexDirection: 'row', gap: 8 },
  headerBtn: { width: 36, height: 36, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: C.primarySoft },
});

export default { CountdownPill, WordBar, Toolbar, GuessBar, FeedOverlay, GuessHistory, HeaderActions };
