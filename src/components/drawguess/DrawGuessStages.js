import React, { memo, useEffect, useRef } from 'react';
import { ActivityIndicator, Animated, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { TOTAL_ROUNDS } from '../../lib/drawGuessRoom';

const C = {
  primary: '#8C69CA',
  primarySoft: '#EEE7FA',
  mint: '#69B79B',
  mintSoft: '#E7F5F0',
  orange: '#E69A55',
  danger: '#D86560',
  text: '#3D3450',
  sub: '#8B8398',
  border: '#EFEAF6',
  surface: '#FFFFFF',
};

function Btn({ title, icon, onPress, disabled, secondary, danger }) {
  return (
    <TouchableOpacity
      style={[
        styles.btn,
        secondary && styles.btnSecondary,
        danger && styles.btnDanger,
        disabled && styles.btnDisabled,
      ]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.82}
    >
      {disabled ? (
        <ActivityIndicator size="small" color={secondary ? C.primary : '#FFF'} />
      ) : icon ? (
        <Ionicons name={icon} size={17} color={secondary ? C.primary : '#FFF'} />
      ) : null}
      <Text style={[styles.btnText, secondary && styles.btnTextSecondary]}>{title}</Text>
    </TouchableOpacity>
  );
}

export const RoundProgress = memo(function RoundProgress({ round = 1, status }) {
  return (
    <View style={styles.roundWrap}>
      <Text style={styles.roundText}>
        {status === 'finished' ? '对局完成' : `第 ${Math.min(round, TOTAL_ROUNDS)} / ${TOTAL_ROUNDS} 轮`}
      </Text>
      <View style={styles.dots}>
        {Array.from({ length: TOTAL_ROUNDS }).map((_, index) => (
          <View
            key={index}
            style={[
              styles.dot,
              index + 1 < round && styles.dotDone,
              index + 1 === round && status !== 'finished' && styles.dotCurrent,
              status === 'finished' && styles.dotDone,
            ]}
          />
        ))}
      </View>
    </View>
  );
});

export const EmptyPanel = memo(function EmptyPanel({ busy, onCreate, onGallery, onWords }) {
  return (
    <View style={styles.panel}>
      <View style={styles.heroArt}>
        <View style={styles.heroPaper}>
          <Ionicons name="brush-outline" size={42} color={C.primary} />
          <View style={styles.heroStroke} />
        </View>
        <View style={[styles.spark, styles.sparkOne]} />
        <View style={[styles.spark, styles.sparkTwo]} />
      </View>
      <Text style={styles.title}>你画，我来猜</Text>
      <Text style={styles.subtitle}>六轮默契挑战，画笔实时同步。轮流画、轮流猜，把好玩的画留进你们的画廊。</Text>
      <Btn title="发起一局" icon="play" onPress={onCreate} disabled={busy} />
      <View style={styles.actionPair}>
        <TouchableOpacity style={styles.miniAction} onPress={onGallery}>
          <Ionicons name="images-outline" size={18} color={C.primary} />
          <Text style={styles.miniActionText}>我们的画廊</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.miniAction} onPress={onWords}>
          <Ionicons name="sparkles-outline" size={18} color={C.primary} />
          <Text style={styles.miniActionText}>私房词库</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
});

export const WaitingPanel = memo(function WaitingPanel({ game, userId, busy, onCancel }) {
  const mine = game && game.creator_id === userId;
  return (
    <View style={styles.panel}>
      <View style={styles.pulseWrap}>
        <View style={styles.pulseOuter} />
        <View style={styles.pulseInner}>
          <Ionicons name={mine ? 'paper-plane' : 'log-in-outline'} size={30} color={C.primary} />
        </View>
      </View>
      <Text style={styles.title}>{mine ? '邀请已经飞过去啦' : '正在加入对局'}</Text>
      <Text style={styles.subtitle}>
        {mine ? '等对方打开邀请后就会自动开始。你会先画第一轮。' : '正在同步题库与对局状态，请稍等片刻。'}
      </Text>
      <View style={styles.waitLine}>
        <ActivityIndicator size="small" color={C.primary} />
        <Text style={styles.waitText}>保持页面开启，同步会更快</Text>
      </View>
      {mine ? <Btn title="取消邀请" onPress={onCancel} disabled={busy} secondary danger /> : null}
    </View>
  );
});

export const PickingPanel = memo(function PickingPanel({ round, isDrawer, choices, busy, onPick, onShuffle }) {
  const list = choices || [];
  return (
    <View style={styles.panel}>
      <RoundProgress round={round} status="picking" />
      {isDrawer ? (
        <>
          <View style={styles.stageIcon}>
            <Ionicons name="color-palette-outline" size={32} color={C.primary} />
          </View>
          <Text style={styles.title}>选一个想画的词</Text>
          <Text style={styles.subtitle}>只有你能看到答案。选好后倒计时立即开始。</Text>
          <View style={styles.choiceList}>
            {list.map((word, index) => (
              <TouchableOpacity
                key={`${word}-${index}`}
                style={styles.choice}
                disabled={busy}
                onPress={() => onPick && onPick(word)}
                activeOpacity={0.78}
              >
                <View style={styles.choiceNumber}><Text style={styles.choiceNumberText}>{index + 1}</Text></View>
                <Text style={styles.choiceText}>{word}</Text>
                <Ionicons name="chevron-forward" size={18} color={C.primary} />
              </TouchableOpacity>
            ))}
          </View>
          <TouchableOpacity style={styles.shuffle} onPress={onShuffle} disabled={busy}>
            <Ionicons name="shuffle-outline" size={16} color={C.sub} />
            <Text style={styles.shuffleText}>换一批</Text>
          </TouchableOpacity>
        </>
      ) : (
        <>
          <View style={styles.stageIcon}>
            <Ionicons name="hourglass-outline" size={32} color={C.mint} />
          </View>
          <Text style={styles.title}>对方正在选词</Text>
          <Text style={styles.subtitle}>准备好脑洞，画笔落下后你就可以开始猜啦。</Text>
          <ActivityIndicator style={styles.stageSpinner} color={C.primary} />
        </>
      )}
    </View>
  );
});

function resultText(result) {
  if (!result) return '未完成';
  if (result.winner === 'win') return result.duration != null ? `${result.duration}s 猜中` : '猜中';
  if (result.winner === 'gaveup') return '公布答案';
  return '超时';
}

function resultIcon(result) {
  if (result && result.winner === 'win') return 'checkmark-circle';
  if (result && result.winner === 'gaveup') return 'eye-outline';
  return 'time-outline';
}

export const FinishedPanel = memo(function FinishedPanel({
  game,
  busy,
  saving,
  pendingRematchId,
  onRematch,
  onSave,
  onGallery,
}) {
  const results = Array.isArray(game && game.round_results) ? game.round_results : [];
  const wins = results.filter((r) => r && r.winner === 'win').length;
  const best = results
    .filter((r) => r && r.winner === 'win' && Number.isFinite(r.duration))
    .sort((a, b) => a.duration - b.duration)[0];

  return (
    <View style={[styles.panel, styles.finishedPanel]}>
      <RoundProgress round={TOTAL_ROUNDS} status="finished" />
      <View style={styles.trophy}>
        <Ionicons name={wins >= 4 ? 'trophy' : 'heart'} size={38} color={wins >= 4 ? C.orange : C.primary} />
      </View>
      <Text style={styles.title}>{wins >= 4 ? '默契满分！' : '这局完成啦'}</Text>
      <Text style={styles.subtitle}>
        一共猜中 {wins} / {TOTAL_ROUNDS} 题{best ? `，最快 ${best.duration} 秒猜出「${best.word}」` : '，下一局继续加油'}。
      </Text>

      <View style={styles.resultList}>
        {results.map((item, index) => (
          <View key={String(item.round || index)} style={styles.resultRow}>
            <View style={[styles.resultIcon, item.winner === 'win' && styles.resultIconWin]}>
              <Ionicons name={resultIcon(item)} size={15} color={item.winner === 'win' ? C.mint : C.sub} />
            </View>
            <Text style={styles.resultRound}>第 {item.round || index + 1} 轮</Text>
            <Text style={styles.resultWord} numberOfLines={1}>{item.word || '未知题目'}</Text>
            <Text style={[styles.resultState, item.winner === 'win' && styles.resultStateWin]}>{resultText(item)}</Text>
          </View>
        ))}
      </View>

      <Btn
        title={pendingRematchId ? '接受再来一局' : '再来一局'}
        icon="refresh"
        onPress={onRematch}
        disabled={busy}
      />
      <View style={styles.actionPair}>
        <TouchableOpacity style={styles.miniAction} onPress={onSave} disabled={saving}>
          {saving ? <ActivityIndicator size="small" color={C.primary} /> : <Ionicons name="download-outline" size={18} color={C.primary} />}
          <Text style={styles.miniActionText}>保存上一幅</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.miniAction} onPress={onGallery}>
          <Ionicons name="images-outline" size={18} color={C.primary} />
          <Text style={styles.miniActionText}>打开画廊</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
});

export const ResultToast = memo(function ResultToast({ toast }) {
  const scale = useRef(new Animated.Value(0.92)).current;
  useEffect(() => {
    if (!toast) return;
    scale.setValue(0.92);
    Animated.spring(scale, { toValue: 1, friction: 7, tension: 90, useNativeDriver: true }).start();
  }, [toast, scale]);
  if (!toast) return null;

  const icon = toast.kind === 'win' ? 'sparkles' : toast.kind === 'warn' ? 'alert-circle' : 'information-circle';
  return (
    <Animated.View style={[styles.toast, toast.kind === 'win' && styles.toastWin, { transform: [{ scale }] }]} pointerEvents="none">
      <Ionicons name={icon} size={17} color="#FFF" />
      <Text style={styles.toastText}>{toast.text}</Text>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  panel: { width: '100%', alignItems: 'center', paddingHorizontal: 18, paddingVertical: 20 },
  finishedPanel: { paddingTop: 8 },
  heroArt: { width: 124, height: 116, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  heroPaper: { width: 88, height: 88, borderRadius: 24, alignItems: 'center', justifyContent: 'center', transform: [{ rotate: '-5deg' }], backgroundColor: C.primarySoft, borderWidth: 1, borderColor: '#E1D5F4' },
  heroStroke: { width: 40, height: 4, borderRadius: 4, marginTop: 5, transform: [{ rotate: '-8deg' }], backgroundColor: C.mint },
  spark: { position: 'absolute', width: 9, height: 9, borderRadius: 5, backgroundColor: C.orange },
  sparkOne: { right: 7, top: 18 },
  sparkTwo: { left: 8, bottom: 22, width: 6, height: 6 },
  title: { color: C.text, fontSize: 21, fontWeight: '800', marginTop: 8, textAlign: 'center' },
  subtitle: { maxWidth: 310, color: C.sub, fontSize: 13, lineHeight: 20, textAlign: 'center', marginTop: 7, marginBottom: 18 },
  btn: { minWidth: 178, minHeight: 45, paddingHorizontal: 20, borderRadius: 16, flexDirection: 'row', gap: 7, alignItems: 'center', justifyContent: 'center', backgroundColor: C.primary },
  btnSecondary: { backgroundColor: C.primarySoft },
  btnDanger: { borderWidth: 1, borderColor: '#F1D7D5' },
  btnDisabled: { opacity: 0.55 },
  btnText: { color: '#FFF', fontSize: 14, fontWeight: '700' },
  btnTextSecondary: { color: C.primary },
  actionPair: { width: '100%', flexDirection: 'row', gap: 10, marginTop: 12 },
  miniAction: { flex: 1, minHeight: 42, borderRadius: 14, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center' },
  miniActionText: { color: C.primary, fontSize: 12, fontWeight: '700' },
  pulseWrap: { width: 104, height: 104, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  pulseOuter: { position: 'absolute', width: 100, height: 100, borderRadius: 50, backgroundColor: C.primarySoft, opacity: 0.56 },
  pulseInner: { width: 68, height: 68, borderRadius: 34, backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.border },
  waitLine: { flexDirection: 'row', gap: 8, alignItems: 'center', marginBottom: 18 },
  waitText: { color: C.sub, fontSize: 12 },
  roundWrap: { width: '100%', alignItems: 'center', marginBottom: 12 },
  roundText: { color: C.sub, fontSize: 11, fontWeight: '700' },
  dots: { flexDirection: 'row', gap: 6, marginTop: 7 },
  dot: { width: 16, height: 4, borderRadius: 3, backgroundColor: '#E8E2EF' },
  dotDone: { backgroundColor: C.mint },
  dotCurrent: { width: 28, backgroundColor: C.primary },
  stageIcon: { width: 66, height: 66, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: C.primarySoft },
  stageSpinner: { marginTop: 4 },
  choiceList: { width: '100%', gap: 9 },
  choice: { width: '100%', minHeight: 54, borderRadius: 17, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', backgroundColor: C.surface, borderWidth: 1, borderColor: C.border },
  choiceNumber: { width: 28, height: 28, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: C.primarySoft },
  choiceNumberText: { color: C.primary, fontWeight: '800', fontSize: 12 },
  choiceText: { flex: 1, marginLeft: 11, color: C.text, fontSize: 16, fontWeight: '700' },
  shuffle: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 13, paddingHorizontal: 18 },
  shuffleText: { color: C.sub, fontSize: 12, fontWeight: '600' },
  trophy: { width: 74, height: 74, borderRadius: 27, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFF3E6' },
  resultList: { width: '100%', borderRadius: 17, overflow: 'hidden', borderWidth: 1, borderColor: C.border, marginBottom: 14 },
  resultRow: { minHeight: 42, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', backgroundColor: C.surface, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.border },
  resultIcon: { width: 25, height: 25, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F2EFF5' },
  resultIconWin: { backgroundColor: C.mintSoft },
  resultRound: { width: 52, marginLeft: 7, color: C.sub, fontSize: 11 },
  resultWord: { flex: 1, color: C.text, fontSize: 13, fontWeight: '700' },
  resultState: { color: C.sub, fontSize: 11 },
  resultStateWin: { color: C.mint, fontWeight: '700' },
  toast: { position: 'absolute', zIndex: 30, top: 82, alignSelf: 'center', maxWidth: '88%', minHeight: 42, borderRadius: 16, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: 'rgba(61,52,80,0.94)' },
  toastWin: { backgroundColor: 'rgba(105,183,155,0.96)' },
  toastText: { flexShrink: 1, color: '#FFF', fontSize: 13, fontWeight: '700' },
});

export default { EmptyPanel, WaitingPanel, PickingPanel, FinishedPanel, ResultToast, RoundProgress };
