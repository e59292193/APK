import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import DrawCanvas from '../components/drawguess/DrawCanvas';
import {
  FeedOverlay,
  GuessBar,
  HeaderActions,
  Toolbar,
  WordBar,
} from '../components/drawguess/DrawGuessControls';
import {
  EmptyPanel,
  FinishedPanel,
  PickingPanel,
  ResultToast,
  RoundProgress,
  WaitingPanel,
} from '../components/drawguess/DrawGuessStages';
import {
  CustomWordsModal,
  GalleryModal,
  ViewerModal,
} from '../components/drawguess/DrawGuessModals';
import { useDrawGuessSession } from '../hooks/useDrawGuessSession';
import { fetchGallery } from '../lib/drawGuessRoom';
import { addCustomWord, deleteCustomWord, deleteGalleryItem } from '../lib/drawGuessAssets';
import { saveImageToGallery } from '../lib/imageSaver';

const SCREEN_WIDTH = Dimensions.get('window').width;
const CW = Math.floor(SCREEN_WIDTH * 0.9);
const CH = CW;

const C = {
  primary: '#8C69CA',
  primarySoft: '#EEE7FA',
  background: '#FAF9FC',
  surface: '#FFFFFF',
  border: '#EFEAF6',
  text: '#3D3450',
  sub: '#8B8398',
  danger: '#D86560',
  mint: '#69B79B',
};

function partnerFor(userId) {
  return userId === 'momo' ? '苞米' : 'momo';
}

function imageUri(item) {
  return item && (item.image_url || item.url || item.public_url);
}

export default function DrawGuessGameScreen({ gameId, userId, onBack }) {
  const insets = useSafeAreaInsets();
  const session = useDrawGuessSession({
    gameId,
    userId,
    partnerId: partnerFor(userId),
    size: CW,
  });

  const actionRef = useRef(session.actions);
  actionRef.current = session.actions;
  const stable = useMemo(
    () => ({
      create: () => actionRef.current.createInvite(),
      cancel: () => actionRef.current.cancelInvite(),
      pick: (word) => actionRef.current.pick(word),
      shuffle: () => actionRef.current.reshuffleChoices(),
      guess: (text) => actionRef.current.submitGuess(text),
      quick: (text) => actionRef.current.sendQuickChat(text),
      undo: () => actionRef.current.undo(),
      clear: () => actionRef.current.clearBoard(),
      save: () => actionRef.current.saveDrawing(),
      rematch: () => actionRef.current.rematch(),
      hint: (text) => actionRef.current.sendHintText(text),
      refreshWords: () => actionRef.current.refreshCustomWords(),
      toast: (text, kind) => actionRef.current.showToast(text, kind),
    }),
    []
  );

  const [hintText, setHintText] = useState('');
  const [galleryVisible, setGalleryVisible] = useState(false);
  const [galleryLoading, setGalleryLoading] = useState(false);
  const [galleryItems, setGalleryItems] = useState([]);
  const [viewerItem, setViewerItem] = useState(null);
  const [viewerSaving, setViewerSaving] = useState(false);
  const [wordsVisible, setWordsVisible] = useState(false);
  const [wordInput, setWordInput] = useState('');
  const [wordBusy, setWordBusy] = useState(false);

  const openGallery = useCallback(async () => {
    setGalleryVisible(true);
    setGalleryLoading(true);
    try {
      setGalleryItems(await fetchGallery(60));
    } catch (e) {
      stable.toast('画廊加载失败，请稍后重试', 'warn');
    } finally {
      setGalleryLoading(false);
    }
  }, [stable]);

  const confirmDeleteGallery = useCallback((item) => {
    Alert.alert('删除画作', '确定要从我们的画廊中删除这幅画吗？', [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteGalleryItem(item);
            setGalleryItems((prev) => prev.filter((x) => x.id !== item.id));
            if (viewerItem && viewerItem.id === item.id) setViewerItem(null);
          } catch (e) {
            stable.toast('删除失败，请稍后重试', 'warn');
          }
        },
      },
    ]);
  }, [stable, viewerItem]);

  const saveToAlbum = useCallback(async (item) => {
    const uri = imageUri(item);
    if (!uri) return;
    setViewerSaving(true);
    try {
      await saveImageToGallery(uri);
    } finally {
      setViewerSaving(false);
    }
  }, []);

  const openWords = useCallback(() => {
    setWordsVisible(true);
    stable.refreshWords();
  }, [stable]);

  const addWord = useCallback(async () => {
    const value = wordInput.trim();
    if (!value || wordBusy) return;
    if (session.customWords.some((item) => item.word === value)) {
      stable.toast('这个词已经在词库里了', 'info');
      return;
    }
    setWordBusy(true);
    try {
      await addCustomWord(userId, value);
      setWordInput('');
      await stable.refreshWords();
    } catch (e) {
      stable.toast('添加失败，请先执行词库权限补丁', 'warn');
    } finally {
      setWordBusy(false);
    }
  }, [session.customWords, stable, userId, wordBusy, wordInput]);

  const removeWord = useCallback((item) => {
    Alert.alert('删除词语', `确定删除「${item.word}」吗？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteCustomWord(item.id);
            await stable.refreshWords();
          } catch (e) {
            stable.toast('删除失败，请稍后重试', 'warn');
          }
        },
      },
    ]);
  }, [stable]);

  const sendHint = useCallback(() => {
    const value = hintText.trim();
    if (!value) return;
    setHintText('');
    stable.hint(value);
  }, [hintText, stable]);

  const confirmGiveUp = useCallback(() => {
    Alert.alert('公布答案', '确定结束这一轮并公布答案吗？', [
      { text: '继续画', style: 'cancel' },
      { text: '公布答案', style: 'destructive', onPress: () => actionRef.current.giveUp() },
    ]);
  }, []);

  const game = session.game;
  const drawing = game && game.status === 'drawing';
  const canSavePrevious = game && game.status === 'picking' && game.round > 1;

  function renderStage() {
    if (session.loading) {
      return (
        <View style={styles.centerState}>
          <ActivityIndicator size="large" color={C.primary} />
          <Text style={styles.centerText}>正在同步对局…</Text>
        </View>
      );
    }

    if (!game) {
      return (
        <>
          {session.errorText ? (
            <View style={styles.errorBox}>
              <Ionicons name="cloud-offline-outline" size={17} color={C.danger} />
              <Text style={styles.errorText}>{session.errorText}</Text>
            </View>
          ) : null}
          <EmptyPanel
            busy={session.busy}
            onCreate={stable.create}
            onGallery={openGallery}
            onWords={openWords}
          />
        </>
      );
    }

    if (game.status === 'waiting') {
      return <WaitingPanel game={game} userId={userId} busy={session.busy} onCancel={stable.cancel} />;
    }

    if (game.status === 'picking') {
      return (
        <>
          <PickingPanel
            round={game.round}
            isDrawer={session.isDrawer}
            choices={session.choices}
            busy={session.busy}
            onPick={stable.pick}
            onShuffle={stable.shuffle}
          />
          {canSavePrevious ? (
            <TouchableOpacity style={styles.previousSave} onPress={stable.save} disabled={session.saving}>
              {session.saving ? (
                <ActivityIndicator size="small" color={C.primary} />
              ) : (
                <Ionicons name="download-outline" size={16} color={C.primary} />
              )}
              <Text style={styles.previousSaveText}>保存上一轮画作</Text>
            </TouchableOpacity>
          ) : null}
        </>
      );
    }

    if (game.status === 'finished') {
      return (
        <FinishedPanel
          game={game}
          busy={session.busy}
          saving={session.saving}
          pendingRematchId={session.pendingRematchId}
          onRematch={stable.rematch}
          onSave={stable.save}
          onGallery={openGallery}
        />
      );
    }

    return null;
  }

  return (
    <View style={styles.screen}>
      <StatusBar barStyle="dark-content" backgroundColor={C.background} />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
        <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
          <TouchableOpacity style={styles.backBtn} onPress={onBack} accessibilityLabel="返回">
            <Ionicons name="chevron-back" size={22} color={C.text} />
          </TouchableOpacity>
          <View style={styles.headerTitleWrap}>
            <Text style={styles.headerTitle}>你画我猜</Text>
            <Text style={styles.headerSub}>默契画室</Text>
          </View>
          <HeaderActions onGallery={openGallery} onWords={openWords} />
        </View>

        <ScrollView
          style={styles.flex}
          contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, 12) + 18 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          bounces={false}
        >
          {drawing ? (
            <View style={styles.gameArea}>
              <RoundProgress round={game.round} status={game.status} />
              <WordBar game={game} isDrawer={session.isDrawer} remainSec={session.remainSec} />

              <DrawCanvas
                width={CW}
                height={CH}
                strokes={session.strokes}
                liveStroke={session.liveStroke}
                remoteStroke={session.remoteStroke}
                responderProps={session.canDraw ? session.panHandlers : null}
                style={styles.canvas}
              >
                <FeedOverlay items={session.feed} userId={userId} />
                {!session.isDrawer ? (
                  <View style={styles.guessBadge} pointerEvents="none">
                    <Ionicons name="eye-outline" size={14} color={C.mint} />
                    <Text style={styles.guessBadgeText}>对方正在画</Text>
                  </View>
                ) : null}
              </DrawCanvas>

              {session.isDrawer ? (
                <>
                  <Toolbar
                    tool={session.tool}
                    onChangeTool={session.setTool}
                    onUndo={stable.undo}
                    onClear={stable.clear}
                    disabled={!session.canDraw}
                  />
                  <View style={styles.hintRow}>
                    <TextInput
                      style={styles.hintInput}
                      value={hintText}
                      onChangeText={setHintText}
                      editable={!game.hint && !session.busy}
                      placeholder={game.hint ? `已发送提示：${game.hint}` : '卡住了？给一个提示（加时15秒）'}
                      placeholderTextColor={C.sub}
                      maxLength={24}
                      returnKeyType="send"
                      onSubmitEditing={sendHint}
                    />
                    <TouchableOpacity
                      style={[styles.hintBtn, (!hintText.trim() || !!game.hint) && styles.actionDisabled]}
                      onPress={sendHint}
                      disabled={!hintText.trim() || !!game.hint || session.busy}
                    >
                      <Ionicons name="bulb-outline" size={17} color="#FFF" />
                    </TouchableOpacity>
                  </View>
                  <View style={styles.drawingActions}>
                    <TouchableOpacity style={styles.softAction} onPress={stable.save} disabled={session.saving}>
                      <Ionicons name="download-outline" size={16} color={C.primary} />
                      <Text style={styles.softActionText}>保存画作</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.softAction} onPress={confirmGiveUp}>
                      <Ionicons name="eye-outline" size={16} color={C.danger} />
                      <Text style={[styles.softActionText, { color: C.danger }]}>公布答案</Text>
                    </TouchableOpacity>
                  </View>
                </>
              ) : (
                <GuessBar disabled={!drawing} onSubmit={stable.guess} onQuick={stable.quick} />
              )}
            </View>
          ) : (
            <View style={styles.stageCard}>{renderStage()}</View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      <ResultToast toast={session.toast} />

      <GalleryModal
        visible={galleryVisible}
        loading={galleryLoading}
        items={galleryItems}
        onClose={() => setGalleryVisible(false)}
        onOpenItem={setViewerItem}
        onDeleteItem={confirmDeleteGallery}
      />
      <ViewerModal
        visible={!!viewerItem}
        item={viewerItem}
        saving={viewerSaving}
        onClose={() => setViewerItem(null)}
        onSaveToAlbum={saveToAlbum}
      />
      <CustomWordsModal
        visible={wordsVisible}
        loading={false}
        busy={wordBusy}
        words={session.customWords}
        input={wordInput}
        onChangeInput={setWordInput}
        onAdd={addWord}
        onDelete={removeWord}
        onClose={() => setWordsVisible(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  screen: { flex: 1, backgroundColor: C.background },
  header: { minHeight: 64, paddingHorizontal: 16, paddingBottom: 10, flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.border, backgroundColor: C.background },
  backBtn: { width: 38, height: 38, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: C.surface, borderWidth: 1, borderColor: C.border },
  headerTitleWrap: { flex: 1, marginLeft: 11 },
  headerTitle: { color: C.text, fontSize: 18, lineHeight: 22, fontWeight: '800' },
  headerSub: { color: C.sub, fontSize: 10, marginTop: 1 },
  content: { flexGrow: 1, alignItems: 'center', paddingTop: 12 },
  stageCard: { width: CW, flexGrow: 1, minHeight: 440, alignItems: 'center', justifyContent: 'center', borderRadius: 24, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, overflow: 'hidden' },
  centerState: { alignItems: 'center', gap: 10 },
  centerText: { color: C.sub, fontSize: 13 },
  errorBox: { width: '90%', marginBottom: 4, padding: 11, borderRadius: 13, flexDirection: 'row', gap: 7, alignItems: 'center', backgroundColor: '#FCECEB' },
  errorText: { flex: 1, color: C.danger, fontSize: 12 },
  gameArea: { width: CW, alignItems: 'center', gap: 10 },
  canvas: { shadowColor: '#342B45', shadowOpacity: 0.08, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 3, borderWidth: 1, borderColor: C.border },
  guessBadge: { position: 'absolute', top: 10, right: 10, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 12, flexDirection: 'row', gap: 4, alignItems: 'center', backgroundColor: 'rgba(231,245,240,0.94)' },
  guessBadgeText: { color: C.mint, fontSize: 10, fontWeight: '700' },
  hintRow: { width: '100%', height: 44, flexDirection: 'row', gap: 8 },
  hintInput: { flex: 1, paddingHorizontal: 13, borderRadius: 14, borderWidth: 1, borderColor: C.border, backgroundColor: C.surface, color: C.text, fontSize: 12 },
  hintBtn: { width: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: C.primary },
  actionDisabled: { opacity: 0.42 },
  drawingActions: { width: '100%', flexDirection: 'row', gap: 9 },
  softAction: { flex: 1, height: 40, borderRadius: 14, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: C.surface, borderWidth: 1, borderColor: C.border },
  softActionText: { color: C.primary, fontSize: 12, fontWeight: '700' },
  previousSave: { marginTop: -10, marginBottom: 14, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 14, flexDirection: 'row', gap: 6, alignItems: 'center', backgroundColor: C.primarySoft },
  previousSaveText: { color: C.primary, fontSize: 12, fontWeight: '700' },
});
