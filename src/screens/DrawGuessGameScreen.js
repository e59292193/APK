// ═══════════════════════════════════════════════════════
// 你画我猜 (Draw & Guess) —— 情侣实时互动小游戏
//
// 流程：大厅(发邀请) → 等待加入 → 6轮(选词→画画→结束) → 总结算
// 奇数轮 creator 画，偶数轮 invitee 画，每轮 60s
// - 笔画按「一笔」实时同步给对方
// - 每轮结束自动光栅化成 PNG 上传到画廊
// - 弹幕功能（参照五子棋）
// ═══════════════════════════════════════════════════════
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Dimensions,
  AppState,
  Modal,
  FlatList,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Vibration,
  Keyboard,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Rect, Path } from 'react-native-svg';
import { supabase } from '../lib/supabase';
import { fetchWithTimeout } from '../lib/fetchWithTimeout';
import { onSignal, emitSignal } from '../lib/realtimeSignal';
import { pushSignal, pollSignals, clearSignals } from '../lib/drawGuessSignalQueue';
import { CachedImage } from '../lib/imageCache';
import saveImageToGallery from '../lib/imageSaver';
import { strokesToPNG } from '../lib/drawGuessPng';
import { pickRandomWords, isCorrectGuess, getCategoryHint } from '../lib/drawGuessUtils';
import DanmakuLayer from '../components/DanmakuLayer';
import { IconButton } from '../components/ui';
import { colors, radius } from '../theme';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CW = Math.floor(SCREEN_WIDTH * 0.9);
const CH = CW;

const VALID_USERS = { momo: true, '苞米': true };
const TOTAL_ROUNDS = 6;

const COLORS = [
  { key: 'black', rgb: [33, 33, 33] },
  { key: 'red', rgb: [231, 76, 60] },
  { key: 'blue', rgb: [52, 152, 219] },
  { key: 'green', rgb: [46, 204, 113] },
  { key: 'orange', rgb: [230, 126, 34] },
  { key: 'purple', rgb: [155, 89, 182] },
];
const SIZES = [3, 6, 11];
const ERASER_WIDTH = 20;
const DRAW_SECONDS = 60;
const HINT_EXTRA_SECONDS = 15;

function rgbStr(c) { return `rgb(${c[0]},${c[1]},${c[2]})`; }

function pointsToPath(points) {
  if (!points || points.length === 0) return '';
  let d = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  for (let i = 1; i < points.length; i++) {
    d += ` L ${points[i].x.toFixed(1)} ${points[i].y.toFixed(1)}`;
  }
  return d;
}

// ─── 笔画紧凑编码（突破腾讯 IM 自定义消息 12KB 限制）───
// 坐标用「相对画布的比例 0~1」传输（千分位精度），
// 这样模拟器与手机的画布尺寸不同也能正确还原，避免笔画偏差。
function roundPt(n) { return Math.round(n * 10) / 10; }
// 单点编码为相对画布的比例（千分位），用于 stroke_begin 的第一个点
function encPt(n, size) { return Math.round((n / size) * 1000) / 1000; }
function compactPts(points) {
  const arr = new Array(points.length * 2);
  for (let i = 0; i < points.length; i++) {
    arr[i * 2] = Math.round((points[i].x / CW) * 1000) / 1000;
    arr[i * 2 + 1] = Math.round((points[i].y / CH) * 1000) / 1000;
  }
  return arr;
}
function expandPts(arr) {
  const pts = [];
  for (let i = 0; i + 1 < arr.length; i += 2) {
    pts.push({ x: arr[i] * CW, y: arr[i + 1] * CH });
  }
  return pts;
}
// 把一笔拆成多段小批量（每段最多 maxPts 个点），用于流式同步/重放
function chunkPts(flatArr, maxPts) {
  const chunks = [];
  const step = maxPts * 2;
  for (let i = 0; i < flatArr.length; i += step) {
    chunks.push(flatArr.slice(i, i + step));
  }
  return chunks.length ? chunks : [[]];
}

function resultLabel(r) {
  if (r === 'win') return '🎉 猜中';
  if (r === 'timeout') return '⏱ 超时';
  if (r === 'gaveup') return '🏳️ 放弃';
  return '';
}

export default function DrawGuessGameScreen({ gameId, userId, onBack }) {
  const insets = useSafeAreaInsets();
  const [activeGameId, setActiveGameId] = useState(gameId || null);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [game, setGame] = useState(null);
  const [loading, setLoading] = useState(!!gameId);

  const [strokes, setStrokes] = useState([]);
  const [currentStroke, setCurrentStroke] = useState(null);
  // 对方正在画的那一笔（实时流式接收，渲染方式同 currentStroke）
  const [remoteCurrent, setRemoteCurrent] = useState(null);
  // refs 直接同步更新，不依赖 useEffect（避免 gesture responder 中读到旧值）
  const strokesRef = useRef([]);
  const currentStrokeRef = useRef(null);
  const activeGameIdRef = useRef(activeGameId);
  useEffect(() => { activeGameIdRef.current = activeGameId; }, [activeGameId]);

  // ─── 流式笔画发送缓冲 ───
  // addToStroke 把新点累积到 pendingPtsRef，flushPendingPts 每 80ms 把缓冲区作为
  // 一个 stroke_pts 信号发出（每段都很小，远低于 12KB 限制），实现「边画边同步」
  const pendingPtsRef = useRef([]);          // 待发送的扁平点数组
  const flushTimerRef = useRef(null);         // 节流定时器
  const strokeSeqRef = useRef(0);             // 笔画序号，生成唯一 si
  const myStrokeIdRef = useRef(null);         // 当前正在画的笔画的 si

  // ─── DB 信号队列轮询 ───
  // IM 信号跨设备不稳定，用 drawguess_signals 表做可靠消息队列
  // 每 1.5 秒拉取增量信号，处理对方发来的笔画/弹幕/撤销/清空
  const queueLastIdRef = useRef(0);           // 已处理的最大信号 id
  const queueRemoteStrokeRef = useRef(null);  // 对方正在画的笔画（按 si 匹配 begin/pts/end，IM+DB 共享）
  const processedStrokeSiRef = useRef(new Set()); // 已完成的笔画 si（防 IM+DB 双通道重复添加）
  const bottomInputRef = useRef(null);
  const roundSavedByPartnerRef = useRef(false); // 本轮对方是否已保存画作（防重复保存）
  const roundSavedByMeRef = useRef(false);      // 本轮自己是否已保存画作

  const [colorIdx, setColorIdx] = useState(0);
  const [sizeIdx, setSizeIdx] = useState(1);
  const [isEraser, setIsEraser] = useState(false);

  const [wordChoices, setWordChoices] = useState([]);
  const [guessInput, setGuessInput] = useState('');
  const [wrongGuesses, setWrongGuesses] = useState([]);
  // 答题反馈浮层（猜对/猜错提示，1.5 秒后消失）
  const [feedback, setFeedback] = useState(null); // {type:'correct'|'wrong', text}
  const feedbackTimerRef = useRef(null);
  const showFeedback = useCallback((type, text) => {
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
    setFeedback({ type, text });
    feedbackTimerRef.current = setTimeout(() => setFeedback(null), 1500);
  }, []);

  const [remainSec, setRemainSec] = useState(DRAW_SECONDS);
  const timerRef = useRef(null);
  const drawEndRef = useRef(0);

  const [hintInput, setHintInput] = useState('');
  const [hintVisible, setHintVisible] = useState(false);

  const [galleryVisible, setGalleryVisible] = useState(false);
  const [gallery, setGallery] = useState([]);
  const [galleryLoading, setGalleryLoading] = useState(false);
  const [viewerImage, setViewerImage] = useState(null);

  const [customWordsModal, setCustomWordsModal] = useState(false);
  const [customWords, setCustomWords] = useState([]);
  const [newWord, setNewWord] = useState('');

  // 弹幕
  const [danmakuList, setDanmakuList] = useState([]);
  const [danmakuInput, setDanmakuInput] = useState('');
  const [inputMode, setInputMode] = useState('guess'); // 'guess' | 'danmaku'

  // ─── Refs（供实时回调读取最新值，避免闭包陷阱）───
  const userIdRef = useRef(userId);
  useEffect(() => { userIdRef.current = userId; }, [userId]);
  const gameRef = useRef(null);
  useEffect(() => { gameRef.current = game; }, [game]);
  const savedRef = useRef(false);
  const guesserSyncedRef = useRef(false);
  const isDrawerRef = useRef(false);
  const finishTimeoutRef = useRef(null);

  const partnerId = useMemo(
    () => Object.keys(VALID_USERS).find((u) => u !== userId) || '',
    [userId]
  );

  const myRole = useMemo(() => {
    if (!game) return null;
    if (game.creator_id === userId) return 'creator';
    if (game.invitee_id === userId) return 'invitee';
    return null;
  }, [game, userId]);

  // 进入页面时加载自定义词（用于画题人选词时混入自己的词）
  useEffect(() => { if (userId) fetchCustomWords(); }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps

  const isDrawer = useMemo(() => {
    if (!game || !myRole) return false;
    return game.current_drawer === myRole;
  }, [game, myRole]);
  useEffect(() => { isDrawerRef.current = isDrawer; }, [isDrawer]);

  // 当前用户作为画题人时，把自己的自定义词混入选词列表（替换一个预设词，仅自己可见）
  // 注意：useMemo 必须在所有 early return 之前调用，否则 hooks 数量会变化导致渲染崩溃
  const displayWordChoices = useMemo(() => {
    if (!isDrawer || !wordChoices.length) return wordChoices;
    const myWords = (customWords || []).map((w) => w.word).filter(Boolean);
    if (myWords.length === 0) return wordChoices;
    const pick = myWords[Math.floor(Math.random() * myWords.length)];
    if (wordChoices.includes(pick)) return wordChoices;
    return [...wordChoices.slice(0, -1), pick];
  }, [isDrawer, wordChoices, customWords]);

  // ══════════ 核心逻辑 ══════════

  // gameId prop 变化时同步 activeGameId（从大厅进入对局、或从聊天邀请进入）
  useEffect(() => {
    if (gameId && gameId !== activeGameId) {
      setActiveGameId(gameId);
      setLoading(true);
    }
  }, [gameId]);

  const applyGameSideEffects = useCallback((row) => {
    if (!row) return;
    if (row.word_choices) setWordChoices(row.word_choices.map((w) => w.word || w));
    else setWordChoices([]);

    if (row.status === 'drawing') {
      if (savedRef.current) savedRef.current = false;
      roundSavedByPartnerRef.current = false; // 新一轮画作保存状态重置
      roundSavedByMeRef.current = false;
      if (!drawEndRef.current || (row.started_at && new Date(row.started_at).getTime() + DRAW_SECONDS * 1000 !== drawEndRef.current)) {
        const start = row.started_at ? new Date(row.started_at).getTime() : Date.now();
        drawEndRef.current = start + DRAW_SECONDS * 1000;
      }
    }
    if (row.status === 'picking') {
      // 新轮开始：清空画布和状态
      setStrokes([]); setWrongGuesses([]); setCurrentStroke(null); setRemoteCurrent(null);
      strokesRef.current = [];
      queueRemoteStrokeRef.current = null;
      processedStrokeSiRef.current.clear(); // 新一轮清空已完成笔画记录，避免 Set 无限增长
      savedRef.current = false; guesserSyncedRef.current = false;
      roundSavedByPartnerRef.current = false;
      roundSavedByMeRef.current = false;
      drawEndRef.current = 0; setHintVisible(false); setHintInput('');
    }
    if (row.status === 'finished') {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    }
  }, []);

  const fetchGame = useCallback(async () => {
    const gid = activeGameIdRef.current;
    if (!gid) return;
    try {
      const { data, error } = await fetchWithTimeout(() =>
        supabase.from('drawguess_games').select('*').eq('id', gid).single()
      );
      if (error) throw error;
      setGame(data);
      applyGameSideEffects(data);
    } catch (e) {
      console.error('[DG] fetchGame:', e);
      Alert.alert('加载对局失败', e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [applyGameSideEffects]);

  const handleInvite = useCallback(async () => {
    try {
      let myCustom = [];
      try {
        const { data: cw } = await fetchWithTimeout(() =>
          supabase.from('drawguess_custom_words').select('word').eq('user_id', userId)
        );
        myCustom = (cw || []).map((r) => r.word);
      } catch (e) { /* 表可能未建 */ }

      const choices = pickRandomWords(myCustom, 3).map((w) => ({ word: w }));

      const { data: gameData, error: gameErr } = await fetchWithTimeout(() =>
        supabase.from('drawguess_games').insert([
          {
            creator_id: userId, invitee_id: partnerId,
            status: 'waiting', round: 1, current_drawer: 'creator',
            word_choices: choices, round_results: [],
          },
        ]).select()
      );
      if (gameErr) throw gameErr;
      const g = gameData[0];

      const { data: msg, error: msgErr } = await fetchWithTimeout(() =>
        supabase.from('messages').insert([
          {
            user_id: userId, content: '你画我猜邀请', type: 'drawguess_invite',
            metadata: { game_id: g.id, creator_id: userId, creator_name: userId, partner_id: partnerId, partner_name: partnerId },
          },
        ]).select()
      );
      if (msgErr) throw msgErr;
      if (msg && msg[0]) emitSignal('chat:message', msg[0]).catch((e) => console.warn('[DG] emitChatMsg failed:', e.message));

      setStrokes([]); setWrongGuesses([]); savedRef.current = false;
      drawEndRef.current = 0; guesserSyncedRef.current = false;
      strokesRef.current = []; setRemoteCurrent(null);
      setActiveGameId(g.id);
      setGame(g);
      setLoading(false);
      applyGameSideEffects(g);
    } catch (e) {
      console.error('[DG] invite:', e);
      const msg = e?.message || String(e);
      const hint = /relation .* does not exist/i.test(msg)
        ? '数据库表未创建，请先在 Supabase 执行 drawGuess_schema.sql'
        : '发送邀请失败，请重试';
      Alert.alert('错误', `${hint}\n\n${msg}`);
    }
  }, [userId, partnerId, applyGameSideEffects]);

  const handleJoin = useCallback(async () => {
    const gid = activeGameIdRef.current;
    if (!gid) return;
    try {
      const { data, error } = await fetchWithTimeout(() =>
        supabase.from('drawguess_games').update({ status: 'picking' }).eq('id', gid).select().single()
      );
      if (error) throw error;
      setGame(data);
      emitSignal(`drawguess:${gid}:update`, data).catch((e) => console.warn('[DG] emitUpdate(join) failed:', e.message));
      pushSignal(gid, 'update', data, userIdRef.current).catch(() => {});
      applyGameSideEffects(data);
    } catch (e) {
      console.error('[DG] join:', e);
      Alert.alert('加入对局失败', e?.message || String(e));
    }
  }, [applyGameSideEffects]);

  const handlePickWord = useCallback(async (word) => {
    const gid = activeGameIdRef.current;
    if (!gid) return;
    try {
      const now = new Date().toISOString();
      const { data, error } = await fetchWithTimeout(() =>
        supabase.from('drawguess_games').update({
          status: 'drawing', word, started_at: now, winner: null, hint: null,
        }).eq('id', gid).select().single()
      );
      if (error) throw error;
      setGame(data);
      emitSignal(`drawguess:${gid}:update`, data).catch((e) => console.warn('[DG] emitUpdate(pick) failed:', e.message));
      pushSignal(gid, 'update', data, userIdRef.current).catch(() => {});
      applyGameSideEffects(data);
      setStrokes([]); setWrongGuesses([]); savedRef.current = false;
      strokesRef.current = []; setRemoteCurrent(null);
      guesserSyncedRef.current = false;
      drawEndRef.current = new Date(now).getTime() + DRAW_SECONDS * 1000;
      setRemainSec(DRAW_SECONDS);
      setHintVisible(false); setHintInput('');
    } catch (e) {
      console.error('[DG] pickWord:', e);
      Alert.alert('选词失败', e?.message || String(e));
    }
  }, [applyGameSideEffects]);

  // ─── 结束本轮（猜中/超时/放弃）───
  // 由画题人执行 DB 更新 + 画作保存；猜题人猜中时通过信号通知画题人执行
  // 猜题人也有 1.8s 兜底调用（防止画题人离线时卡死），通过状态校验避免竞态
  const finishRound = useCallback(async (winner) => {
    const gid = activeGameIdRef.current;
    if (!gid || !gameRef.current) return;
    // 状态校验：只在 drawing 阶段结束本轮，防止 update 信号到达后 gameRef 已变为
    // picking 时仍触发 finishRound 损坏下一轮状态（word=null 的空轮结果）
    if (gameRef.current.status !== 'drawing') return;
    if (savedRef.current) return;
    savedRef.current = true;
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (finishTimeoutRef.current) { clearTimeout(finishTimeoutRef.current); finishTimeoutRef.current = null; }

    const g = gameRef.current;
    const finishedAt = new Date().toISOString();
    const startMs = g.started_at ? new Date(g.started_at).getTime() : Date.now();
    const duration = Math.max(0, Math.floor((Date.now() - startMs) / 1000));

    const roundResult = {
      round: g.round, drawer: g.current_drawer, word: g.word,
      winner, duration: winner === 'win' ? duration : null,
    };
    const prevResults = Array.isArray(g.round_results) ? g.round_results : [];
    const newResults = [...prevResults, roundResult];

    // 画作保存改为手动保存按钮，finishRound 不再自动保存

    // 推进轮次
    const nextRound = g.round + 1;
    try {
      let updateData;
      if (nextRound > TOTAL_ROUNDS) {
        // 全部结束
        updateData = {
          status: 'finished', winner: null, finished_at: finishedAt,
          round_results: newResults,
        };
      } else {
        // 下一轮：交换画题人
        const nextDrawer = g.current_drawer === 'creator' ? 'invitee' : 'creator';
        const choices = pickRandomWords([], 3).map((w) => ({ word: w }));
        updateData = {
          status: 'picking', round: nextRound, current_drawer: nextDrawer,
          word: null, winner: null, hint: null, started_at: null,
          word_choices: choices, round_results: newResults,
        };
      }
      const { data, error } = await fetchWithTimeout(() =>
        supabase.from('drawguess_games').update(updateData).eq('id', gid).select().single()
      );
      if (error) throw error;
      setGame(data);
      emitSignal(`drawguess:${gid}:update`, data).catch((e) => console.warn('[DG] emitUpdate(finish) failed:', e.message));
      // 同时推入 DB 信号队列，确保对方通过 Realtime/轮询可靠收到状态变更
      pushSignal(gid, 'update', data, userIdRef.current).catch(() => {});
      applyGameSideEffects(data);
    } catch (e) {
      console.error('[DG] finishRound:', e);
      savedRef.current = false; // 允许重试
      Alert.alert('结束本轮失败', e?.message || String(e));
    }
  }, [applyGameSideEffects]);

  const handleGiveUp = useCallback(() => {
    Alert.alert('放弃本轮', '确定放弃吗？将直接公布答案。', [
      { text: '取消', style: 'cancel' },
      { text: '放弃', style: 'destructive', onPress: () => finishRound('gaveup') },
    ]);
  }, [finishRound]);

  // 手动保存当前画作（双方均可点击）。先查 gallery 防重复，再保存并发 save 信号通知对方
  const handleSaveDrawing = useCallback(async () => {
    const gid = activeGameIdRef.current;
    const g = gameRef.current;
    if (!gid || !g) return;
    if (roundSavedByMeRef.current) {
      Alert.alert('已保存', '你已经保存过本幅画了～');
      return;
    }
    if (roundSavedByPartnerRef.current) {
      Alert.alert('对方已保存', '对方已经保存过本幅画了，无需重复保存～');
      return;
    }
    const strokes = strokesRef.current;
    if (!strokes || strokes.length === 0) {
      Alert.alert('画布为空', '还没有画任何内容，画几笔再保存吧～');
      return;
    }
    try {
      // 先查 gallery 是否已存在本局本轮的记录（双保险，防止信号未到达）
      const { data: exist } = await fetchWithTimeout(() =>
        supabase.from('drawguess_gallery').select('id').eq('game_id', gid).eq('round', g.round).limit(1)
      );
      if (exist && exist.length > 0) {
        roundSavedByPartnerRef.current = true;
        Alert.alert('已保存', '本幅画已被保存过，无需重复保存～');
        return;
      }
      const pngBytes = strokesToPNG(strokes, CW, CH);
      const filePath = `drawguess/dg_${gid}_r${g.round}_${Date.now()}.png`;
      const { error: upErr } = await supabase.storage.from('photos').upload(filePath, pngBytes, { contentType: 'image/png' });
      if (upErr) throw upErr;
      const { data: urlData } = supabase.storage.from('photos').getPublicUrl(filePath);
      const winner = g.winner;
      const { error: insErr } = await fetchWithTimeout(() =>
        supabase.from('drawguess_gallery').insert([{
          game_id: gid,
          drawer_id: g.current_drawer === 'creator' ? g.creator_id : g.invitee_id,
          guesser_id: g.current_drawer === 'creator' ? g.invitee_id : g.creator_id,
          word: g.word, image_url: urlData.publicUrl,
          result: winner === 'win' ? 'win' : (winner === 'gaveup' ? 'gaveup' : 'timeout'),
          round: g.round,
        }])
      );
      if (insErr) throw insErr;
      roundSavedByMeRef.current = true;
      // 通知对方本幅画已保存（走 DB 队列 + IM 双路径）
      pushSignal(gid, 'save', { round: g.round }, userIdRef.current).catch(() => {});
      emitSignal(`drawguess:${gid}:update`, g).catch(() => {});
      Alert.alert('保存成功', '画作已保存到画廊🖼️');
    } catch (e) {
      console.warn('[DG] 保存画作失败:', e.message);
      Alert.alert('保存失败', e?.message || '请重试');
    }
  }, []);

  const handlePublishAnswer = useCallback(() => {
    finishRound('timeout');
  }, [finishRound]);

  const handleGiveHint = useCallback(() => {
    const text = hintInput.trim();
    if (!text) { Alert.alert('提示', '请输入提示文字'); return; }
    if (gameRef.current?.word && text.includes(gameRef.current.word)) {
      Alert.alert('提示', '提示不能包含答案本身哦'); return;
    }
    Alert.alert('给提示', `确认发送提示：「${text}」？对方将多 ${HINT_EXTRA_SECONDS} 秒`, [
      { text: '取消', style: 'cancel' },
      {
        text: '发送',
        onPress: async () => {
          try {
            drawEndRef.current = Date.now() + HINT_EXTRA_SECONDS * 1000;
            setRemainSec(HINT_EXTRA_SECONDS);
            setHintVisible(false);
            const gid = activeGameIdRef.current;
            const { data, error } = await fetchWithTimeout(() =>
              supabase.from('drawguess_games').update({ hint: text }).eq('id', gid).select().single()
            );
            if (error) throw error;
            setGame(data);
            emitSignal(`drawguess:${gid}:update`, data).catch((e) => console.warn('[DG] emitUpdate(hint) failed:', e.message));
            pushSignal(gid, 'update', data, userIdRef.current).catch(() => {});
          } catch (e) {
            console.error('[DG] hint:', e);
            Alert.alert('发送提示失败', e?.message || String(e));
          }
        },
      },
    ]);
  }, [hintInput]);

  // 猜题人猜词：猜中→通知画题人执行 finishRound；猜错→显示在弹幕区
  const handleSubmitGuess = useCallback(() => {
    const text = guessInput.trim();
    if (!text || !gameRef.current) return;
    setGuessInput('');
    const correct = isCorrectGuess(text, gameRef.current.word);
    const gid = activeGameIdRef.current;
    if (gid) {
      emitSignal(`drawguess:${gid}:guess`, { text, correct, from: userId }).catch((e) => {
        console.warn('[DG] emitGuess failed:', e.message);
      });
      pushSignal(gid, 'guess', { text, correct, from: userId }, userIdRef.current).catch(() => {});
    }
    if (correct) {
      Vibration.vibrate([0, 30, 60, 30]);
      showFeedback('correct', `🎉 猜对了！答案是「${gameRef.current.word}」`);
      // 猜题人兜底：1.8s 后若画题人未推进轮次则自己调用 finishRound
      // （finishRound 内有 status==='drawing' 校验，不会损坏已推进的状态）
      if (finishTimeoutRef.current) { clearTimeout(finishTimeoutRef.current); }
      finishTimeoutRef.current = setTimeout(() => {
        if (!savedRef.current) finishRound('win');
      }, 1800);
    } else {
      showFeedback('wrong', `❌ 「${text}」不对哦`);
      setWrongGuesses((prev) => [...prev.slice(-4), text]);
    }
  }, [guessInput, userId, finishRound, showFeedback]);

  const handleRematch = useCallback(() => {
    setActiveGameId(null);
    setGame(null);
    setStrokes([]); setWrongGuesses([]); setCurrentStroke(null); setRemoteCurrent(null);
    strokesRef.current = [];
    setHintInput(''); setHintVisible(false);
    savedRef.current = false; drawEndRef.current = 0; guesserSyncedRef.current = false;
    setRemainSec(DRAW_SECONDS);
    if (finishTimeoutRef.current) { clearTimeout(finishTimeoutRef.current); finishTimeoutRef.current = null; }
    handleInvite();
  }, [handleInvite]);

  // ─── 画廊 ───
  const fetchGallery = useCallback(async () => {
    setGalleryLoading(true);
    try {
      const { data, error } = await fetchWithTimeout(() =>
        supabase.from('drawguess_gallery').select('*').order('created_at', { ascending: false }).limit(60)
      );
      if (error) throw error;
      setGallery(data || []);
    } catch (e) {
      console.error('[DG] gallery:', e);
      const msg = e?.message || String(e);
      const hint = /relation .* does not exist/i.test(msg)
        ? '数据库表未创建，请先在 Supabase 执行 drawGuess_schema.sql'
        : '加载画廊失败';
      Alert.alert('错误', `${hint}\n\n${msg}`);
    } finally {
      setGalleryLoading(false);
    }
  }, []);

  const openGallery = useCallback(() => { setGalleryVisible(true); fetchGallery(); }, [fetchGallery]);

  // 删除画廊中的一幅画作（DB 记录 + Storage 文件）
  const handleDeleteGalleryItem = useCallback((item) => {
    Alert.alert('删除画作', `确定删除「${item.word}」这幅画吗？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除', style: 'destructive', onPress: async () => {
          try {
            // 从 image_url 解析 storage 路径
            const url = item.image_url || '';
            const m = url.match(/\/storage\/v1\/object\/public\/photos\/(.+)$/);
            if (m && m[1]) {
              await supabase.storage.from('photos').remove([m[1]]).catch(() => {});
            }
            const { error } = await fetchWithTimeout(() =>
              supabase.from('drawguess_gallery').delete().eq('id', item.id)
            );
            if (error) throw error;
            setGallery((prev) => prev.filter((g) => g.id !== item.id));
            setViewerImage(null);
            Alert.alert('已删除', '画作已从画廊删除');
          } catch (e) {
            console.warn('[DG] delete gallery:', e.message);
            Alert.alert('删除失败', e?.message || '请重试');
          }
        },
      },
    ]);
  }, []);
  const handleDownloadImage = useCallback(async (url) => { await saveImageToGallery(url); }, []);

  // ─── 自定义词 ───
  const fetchCustomWords = useCallback(async () => {
    try {
      const { data, error } = await fetchWithTimeout(() =>
        supabase.from('drawguess_custom_words').select('*').eq('user_id', userId).order('created_at', { ascending: false })
      );
      if (error) throw error;
      setCustomWords(data || []);
    } catch (e) { console.warn('[DG] 自定义词加载失败:', e.message); }
  }, [userId]);

  const handleAddWord = useCallback(async () => {
    const w = newWord.trim();
    if (!w) return;
    try {
      const { data, error } = await fetchWithTimeout(() =>
        supabase.from('drawguess_custom_words').insert([{ user_id: userId, word: w }]).select()
      );
      if (error) throw error;
      setCustomWords((prev) => [data[0], ...prev]);
      setNewWord('');
    } catch (e) {
      Alert.alert('添加失败', e?.message || '请重试');
    }
  }, [newWord, userId]);

  const handleDeleteWord = useCallback((id) => {
    Alert.alert('删除词条', '确定删除这个词吗？', [
      { text: '取消', style: 'cancel' },
      {
        text: '删除', style: 'destructive',
        onPress: async () => {
          try {
            await fetchWithTimeout(() => supabase.from('drawguess_custom_words').delete().eq('id', id));
            setCustomWords((prev) => prev.filter((w) => w.id !== id));
          } catch (e) { Alert.alert('删除失败'); }
        },
      },
    ]);
  }, []);

  // ─── 画笔（流式同步：stroke_begin / stroke_pts / stroke_end）───
  // 协议字段精简以突破腾讯 IM 12KB 限制：
  //   stroke_begin { si, c:[r,g,b], w, e, p:[x,y] }   开始一笔，带第一个点
  //   stroke_pts   { si, p:[x1,y1,x2,y2,...] }         追加若干点（节流发送）
  //   stroke_end   { si }                              结束一笔
  const flushPendingPts = useCallback(() => {
    flushTimerRef.current = null;
    const pts = pendingPtsRef.current;
    if (!pts || pts.length === 0) return;
    pendingPtsRef.current = [];
    const gid = activeGameIdRef.current;
    const si = myStrokeIdRef.current;
    if (gid && si) {
      emitSignal(`drawguess:${gid}:stroke_pts`, { si, p: pts }).catch((e) => {
        console.warn('[DG] emitStrokePts failed:', e.message);
      });
      // DB 队列兜底（跨设备 IM 不稳定时保证对方能看到笔画）
      pushSignal(gid, 'stroke_pts', { si, p: pts }, userIdRef.current).catch(() => {});
    }
  }, []);

  const startStroke = useCallback((x, y) => {
    if (!isDrawerRef.current || !gameRef.current || gameRef.current.status !== 'drawing') return;
    const stroke = {
      points: [{ x, y }],
      color: isEraser ? [255, 255, 255] : COLORS[colorIdx].rgb,
      width: isEraser ? ERASER_WIDTH : SIZES[sizeIdx],
      isEraser,
    };
    currentStrokeRef.current = stroke;
    setCurrentStroke(stroke);
    // 开启新笔画流
    const si = `s${Date.now()}_${++strokeSeqRef.current}`;
    myStrokeIdRef.current = si;
    pendingPtsRef.current = [];
    const gid = activeGameIdRef.current;
    if (gid) {
      emitSignal(`drawguess:${gid}:stroke_begin`, {
        si, c: stroke.color, w: stroke.width, e: stroke.isEraser ? 1 : 0, p: [encPt(x, CW), encPt(y, CH)],
      }).catch((e) => console.warn('[DG] emitStrokeBegin failed:', e.message));
      pushSignal(gid, 'stroke_begin', {
        si, c: stroke.color, w: stroke.width, e: stroke.isEraser ? 1 : 0, p: [encPt(x, CW), encPt(y, CH)],
      }, userIdRef.current).catch(() => {});
    }
  }, [isEraser, colorIdx, sizeIdx]);

  const addToStroke = useCallback((x, y) => {
    const prev = currentStrokeRef.current;
    if (!prev) return;
    const updated = { ...prev, points: [...prev.points, { x, y }] };
    currentStrokeRef.current = updated;
    setCurrentStroke(updated);
    // 累积到发送缓冲区（相对比例），节流 80ms 发送一次
    pendingPtsRef.current.push(encPt(x, CW), encPt(y, CH));
    if (!flushTimerRef.current) {
      flushTimerRef.current = setTimeout(flushPendingPts, 80);
    }
  }, [flushPendingPts]);

  const endStroke = useCallback(() => {
    const s = currentStrokeRef.current;
    // 先把剩余缓冲发出去
    if (flushTimerRef.current) { clearTimeout(flushTimerRef.current); flushTimerRef.current = null; }
    flushPendingPts();
    if (s && s.points.length > 0) {
      const newStrokes = [...strokesRef.current, s];
      strokesRef.current = newStrokes;
      setStrokes(newStrokes);
      const gid = activeGameIdRef.current;
      const si = myStrokeIdRef.current;
      if (gid && si) {
        emitSignal(`drawguess:${gid}:stroke_end`, { si }).catch((e) => {
          console.warn('[DG] emitStrokeEnd failed:', e.message);
        });
        pushSignal(gid, 'stroke_end', { si }, userIdRef.current).catch(() => {});
      }
    }
    currentStrokeRef.current = null;
    setCurrentStroke(null);
    myStrokeIdRef.current = null;
  }, [flushPendingPts]);

  // 把一笔完整重放给对方（用于猜题人中途加入时同步已有画作）
  const emitStrokeStream = useCallback((stroke) => {
    const gid = activeGameIdRef.current;
    if (!gid || !stroke || !stroke.points || stroke.points.length === 0) return;
    const si = `sync_${Date.now()}_${++strokeSeqRef.current}`;
    const flat = compactPts(stroke.points);
    emitSignal(`drawguess:${gid}:stroke_begin`, {
      si, c: stroke.color, w: stroke.width, e: stroke.isEraser ? 1 : 0, p: flat.slice(0, 2),
    }).catch((e) => console.warn('[DG] emitStreamBegin failed:', e.message));
    // 第一笔已经在 begin 里发了，从第 2 个点开始分块
    const rest = flat.slice(2);
    chunkPts(rest, 120).forEach((chunk) => {
      emitSignal(`drawguess:${gid}:stroke_pts`, { si, p: chunk }).catch((e) => console.warn('[DG] emitStreamPts failed:', e.message));
    });
    emitSignal(`drawguess:${gid}:stroke_end`, { si }).catch((e) => console.warn('[DG] emitStreamEnd failed:', e.message));
  }, []);

  const handleUndo = useCallback(() => {
    const newStrokes = strokesRef.current.slice(0, -1);
    strokesRef.current = newStrokes;
    setStrokes(newStrokes);
    const gid = activeGameIdRef.current;
    if (gid) {
      emitSignal(`drawguess:${gid}:undo`, {}).catch((e) => console.warn('[DG] emitUndo failed:', e.message));
      pushSignal(gid, 'undo', {}, userIdRef.current).catch(() => {});
    }
  }, []);

  const handleClear = useCallback(() => {
    Alert.alert('清空画布', '确定清空所有笔画吗？', [
      { text: '取消', style: 'cancel' },
      { text: '清空', style: 'destructive', onPress: () => {
        strokesRef.current = [];
        setStrokes([]);
        const gid = activeGameIdRef.current;
        if (gid) {
          emitSignal(`drawguess:${gid}:clear`, {}).catch((e) => console.warn('[DG] emitClear failed:', e.message));
          pushSignal(gid, 'clear', {}, userIdRef.current).catch(() => {});
        }
      } },
    ]);
  }, []);

  // ─── 弹幕 ───
  const addDanmaku = useCallback((text, from) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const topOffset = 60 + Math.floor(Math.random() * 5) * 32;
    setDanmakuList((prev) => [...prev, { id, text, from, topOffset }]);
  }, []);

  const handleDanmakuEnd = useCallback((id) => {
    setDanmakuList((prev) => prev.filter((d) => d.id !== id));
  }, []);

  const sendDanmaku = useCallback(() => {
    const text = danmakuInput.trim();
    if (!text) return;
    const gid = activeGameIdRef.current;
    if (gid) {
      emitSignal(`drawguess:${gid}:danmaku`, { text, from: userId }).catch((e) => {
        console.warn('[DG] emitDanmaku failed:', e.message);
      });
      pushSignal(gid, 'danmaku', { text, from: userId }, userIdRef.current).catch(() => {});
    }
    addDanmaku(text, 'me');
    setDanmakuInput('');
  }, [danmakuInput, userId, addDanmaku]);

  // ══════════ 实时信号订阅（只依赖 activeGameId，回调内用 ref）══════════
  // 所有回调用 ref 存储，避免 finishRound/applyGameSideEffects 引用变化导致重新订阅
  const applyGameSideEffectsRef = useRef(applyGameSideEffects);
  useEffect(() => { applyGameSideEffectsRef.current = applyGameSideEffects; }, [applyGameSideEffects]);
  const finishRoundRef = useRef(finishRound);
  useEffect(() => { finishRoundRef.current = finishRound; }, [finishRound]);
  const addDanmakuRef = useRef(addDanmaku);
  useEffect(() => { addDanmakuRef.current = addDanmaku; }, [addDanmaku]);
  const showFeedbackRef = useRef(showFeedback);
  useEffect(() => { showFeedbackRef.current = showFeedback; }, [showFeedback]);

  useEffect(() => {
    if (!activeGameId) return;

    const unsubUpdate = onSignal(`drawguess:${activeGameId}:update`, (row) => {
      if (!row) return;
      setGame(row);
      applyGameSideEffectsRef.current(row);
      // 状态离开 drawing 时取消待执行的 finishRound（防止竞态：对方已推进轮次，
      // 本地旧定时器仍触发 finishRound 用新 gameRef 损坏状态）
      if (row.status !== 'drawing' && finishTimeoutRef.current) {
        clearTimeout(finishTimeoutRef.current);
        finishTimeoutRef.current = null;
      }
    });

    // 流式笔画接收缓冲（IM+DB 共享 queueRemoteStrokeRef，按 si 匹配 begin/pts/end）
    // processedStrokeSiRef 记录已完成的 si，防止 IM 和 DB 双通道重复添加同一笔

    const unsubBegin = onSignal(`drawguess:${activeGameId}:stroke_begin`, (m) => {
      if (!m || !m.si) return;
      if (processedStrokeSiRef.current.has(m.si)) return; // 已完成，忽略重复 begin
      const stroke = {
        points: expandPts(m.p || []),
        color: m.c || [0, 0, 0],
        width: m.w || 3,
        isEraser: !!m.e,
      };
      queueRemoteStrokeRef.current = { si: m.si, stroke };
      setRemoteCurrent(stroke);
    });

    const unsubPts = onSignal(`drawguess:${activeGameId}:stroke_pts`, (m) => {
      if (!m || !m.si) return;
      const rs = queueRemoteStrokeRef.current;
      if (!rs || rs.si !== m.si) return;
      const appended = { ...rs.stroke, points: [...rs.stroke.points, ...expandPts(m.p || [])] };
      rs.stroke = appended;
      setRemoteCurrent(appended);
    });

    const unsubEnd = onSignal(`drawguess:${activeGameId}:stroke_end`, (m) => {
      if (!m || !m.si) return;
      if (processedStrokeSiRef.current.has(m.si)) return; // 已添加过，忽略重复 end
      const rs = queueRemoteStrokeRef.current;
      if (!rs || rs.si !== m.si) return;
      const s = rs.stroke;
      queueRemoteStrokeRef.current = null;
      setRemoteCurrent(null);
      processedStrokeSiRef.current.add(m.si); // 标记已完成，防重复
      if (s && s.points.length > 0) {
        setStrokes((prev) => {
          const next = [...prev, s];
          strokesRef.current = next;
          return next;
        });
      }
    });

    const unsubUndo = onSignal(`drawguess:${activeGameId}:undo`, () => {
      setStrokes((prev) => { const next = prev.slice(0, -1); strokesRef.current = next; return next; });
      setRemoteCurrent(null); queueRemoteStrokeRef.current = null;
    });
    const unsubClear = onSignal(`drawguess:${activeGameId}:clear`, () => {
      setStrokes([]); strokesRef.current = [];
      setRemoteCurrent(null); queueRemoteStrokeRef.current = null;
    });

    const unsubGuess = onSignal(`drawguess:${activeGameId}:guess`, (payload) => {
      if (!payload) return;
      // 画题人收到猜题人的猜测
      if (isDrawerRef.current && payload.from !== userIdRef.current) {
        if (payload.correct) {
          Vibration.vibrate([0, 30, 60, 30]);
          showFeedbackRef.current('correct', `🎉 对方猜对了！`);
          // 清除可能已存在的定时器（IM+DB 双通道去重），避免 finishRound 被重复调用
          if (finishTimeoutRef.current) { clearTimeout(finishTimeoutRef.current); }
          finishTimeoutRef.current = setTimeout(() => {
            finishRoundRef.current('win');
          }, 1800);
        } else {
          showFeedbackRef.current('wrong', `❌ 对方猜「${payload.text}」`);
          setWrongGuesses((prev) => [...prev.slice(-4), payload.text]);
        }
      }
    });

    // 猜题人加入时请求同步 → 画题人把已有笔画逐笔流式重放（避免单条消息超 12KB）
    const unsubSyncReq = onSignal(`drawguess:${activeGameId}:sync_request`, () => {
      if (isDrawerRef.current && strokesRef.current.length > 0) {
        strokesRef.current.forEach((s) => emitStrokeStream(s));
      }
    });

    const unsubDanmaku = onSignal(`drawguess:${activeGameId}:danmaku`, (payload) => {
      // 参照五子棋：不过滤 from（腾讯 IM C2C 不回传自己发的消息）
      if (payload && payload.text) addDanmakuRef.current(payload.text, 'other');
    });

    return () => {
      unsubUpdate(); unsubBegin(); unsubPts(); unsubEnd(); unsubUndo(); unsubClear();
      unsubGuess(); unsubSyncReq(); unsubDanmaku();
    };
  }, [activeGameId]);

  // ─── DB 信号队列：处理一条对方信号（Realtime 推送 + 轮询共用）───
  const dispatchQueueSignal = useCallback((sig) => {
    if (!sig) return;
    const me = userIdRef.current;
    if (sig.sender_id === me) return; // 过滤自己发的（DB 会回显）
    const d = sig.data || {};
    try {
      switch (sig.type) {
        case 'stroke_begin': {
          if (!d.si) break;
          if (processedStrokeSiRef.current.has(d.si)) break; // 已完成，忽略重复 begin（IM 已处理）
          const stroke = {
            points: expandPts(d.p || []),
            color: d.c || [0, 0, 0],
            width: d.w || 3,
            isEraser: !!d.e,
          };
          queueRemoteStrokeRef.current = { si: d.si, stroke };
          setRemoteCurrent(stroke);
          break;
        }
        case 'stroke_pts': {
          const rs = queueRemoteStrokeRef.current;
          if (!d.si || !rs || rs.si !== d.si) break;
          const appended = { ...rs.stroke, points: [...rs.stroke.points, ...expandPts(d.p || [])] };
          rs.stroke = appended;
          setRemoteCurrent(appended);
          break;
        }
        case 'stroke_end': {
          if (!d.si) break;
          if (processedStrokeSiRef.current.has(d.si)) break; // 已添加过，忽略重复 end
          const rs = queueRemoteStrokeRef.current;
          if (!rs || rs.si !== d.si) break;
          const s = rs.stroke;
          queueRemoteStrokeRef.current = null;
          setRemoteCurrent(null);
          processedStrokeSiRef.current.add(d.si); // 标记已完成，防重复
          if (s && s.points.length > 0) {
            setStrokes((prev) => {
              const next = [...prev, s];
              strokesRef.current = next;
              return next;
            });
          }
          break;
        }
        case 'undo': {
          setStrokes((prev) => { const next = prev.slice(0, -1); strokesRef.current = next; return next; });
          setRemoteCurrent(null); queueRemoteStrokeRef.current = null;
          break;
        }
        case 'clear': {
          setStrokes([]); strokesRef.current = [];
          setRemoteCurrent(null); queueRemoteStrokeRef.current = null;
          break;
        }
        case 'danmaku': {
          if (d.text) addDanmakuRef.current(d.text, 'other');
          break;
        }
        case 'guess': {
          // 画题人收到猜题人的猜测（DB 队列兜底通道）
          if (isDrawerRef.current && d.from !== me) {
            if (d.correct) {
              Vibration.vibrate([0, 30, 60, 30]);
              showFeedbackRef.current('correct', `🎉 对方猜对了！`);
              // 清除可能已存在的定时器（IM+DB 双通道去重）
              if (finishTimeoutRef.current) { clearTimeout(finishTimeoutRef.current); }
              finishTimeoutRef.current = setTimeout(() => {
                finishRoundRef.current('win');
              }, 1800);
            } else {
              showFeedbackRef.current('wrong', `❌ 对方猜「${d.text}」`);
              setWrongGuesses((prev) => [...prev.slice(-4), d.text]);
            }
          }
          break;
        }
        case 'save': {
          // 对方已保存本幅画，标记防止重复保存
          roundSavedByPartnerRef.current = true;
          break;
        }
        case 'update': {
          // 对方触发了状态变更（选词/结束本轮/提示等），同步到本地
          if (d && d.id) {
            setGame(d);
            applyGameSideEffectsRef.current(d);
            // 状态离开 drawing 时取消待执行的 finishRound（与 IM update 处理一致）
            if (d.status !== 'drawing' && finishTimeoutRef.current) {
              clearTimeout(finishTimeoutRef.current);
              finishTimeoutRef.current = null;
            }
          }
          break;
        }
        default: break;
      }
    } catch (e) {
      console.warn('[DG] queue dispatch error:', sig.type, e.message);
    }
  }, []);

  // ─── Realtime 订阅 + 轮询兜底 ───
  // 主通道：Supabase Realtime（WebSocket 推送，延迟 ~200ms，笔画丝滑）
  // 兜底：每 1.2 秒轮询 drawguess_signals（Realtime 未启用或丢包时补漏）
  useEffect(() => {
    if (!activeGameId) return;
    queueLastIdRef.current = 0;
    queueRemoteStrokeRef.current = null;
    processedStrokeSiRef.current.clear(); // 新一局清空已完成笔画记录
    roundSavedByPartnerRef.current = false;

    let mounted = true;
    let polling = false;

    const tick = async () => {
      if (!mounted || polling) return;
      polling = true;
      try {
        const gid = activeGameIdRef.current;
        if (!gid) { polling = false; return; }
        const { signals, maxId } = await pollSignals(gid, queueLastIdRef.current);
        if (!mounted || !signals || signals.length === 0) { polling = false; return; }
        queueLastIdRef.current = maxId;
        for (const sig of signals) dispatchQueueSignal(sig);
      } catch (e) { /* 静默 */ }
      polling = false;
    };

    // Realtime 订阅：收到 INSERT 即时处理
    const channel = supabase
      .channel(`dg_signals_${activeGameId}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'drawguess_signals', filter: `game_id=eq.${activeGameId}` },
        (payload) => {
          const row = payload.new;
          if (!row || !mounted) return;
          if (row.id <= queueLastIdRef.current) return; // 已处理（轮询先到）
          queueLastIdRef.current = row.id;
          dispatchQueueSignal(row);
        }
      )
      .subscribe();

    tick();
    const interval = setInterval(tick, 1200);
    return () => {
      mounted = false;
      clearInterval(interval);
      supabase.removeChannel(channel);
    };
  }, [activeGameId, dispatchQueueSignal]);

  // ─── 定时 DB 轮询兜底（每 2 秒 fetchGame，防止信号丢失导致状态不同步）───
  useEffect(() => {
    if (!activeGameId) return;
    const interval = setInterval(() => {
      fetchGame();
    }, 2000);
    return () => clearInterval(interval);
  }, [activeGameId, fetchGame]);

  // 加载对局
  useEffect(() => {
    if (activeGameId) {
      savedRef.current = false; guesserSyncedRef.current = false; drawEndRef.current = 0;
      setStrokes([]); setWrongGuesses([]); setRemoteCurrent(null);
      strokesRef.current = [];
      fetchGame();
    }
    return () => {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      if (finishTimeoutRef.current) { clearTimeout(finishTimeoutRef.current); finishTimeoutRef.current = null; }
    };
  }, [activeGameId, fetchGame]);

  // 受邀方自动加入
  useEffect(() => {
    if (game && game.status === 'waiting' && myRole === 'invitee') handleJoin();
  }, [game?.status, myRole]);

  // 猜题人请求同步笔画
  useEffect(() => {
    if (game && game.status === 'drawing' && !isDrawer && !guesserSyncedRef.current) {
      guesserSyncedRef.current = true;
      const gid = activeGameIdRef.current;
      if (gid) {
        emitSignal(`drawguess:${gid}:sync_request`, {}).catch((e) => console.warn('[DG] emitSyncReq failed:', e.message));
        setTimeout(() => {
          if (strokesRef.current.length === 0 && gid) {
            emitSignal(`drawguess:${gid}:sync_request`, {}).catch((e) => console.warn('[DG] emitSyncReq(retry) failed:', e.message));
          }
        }, 1200);
      }
    }
  }, [game?.status, game?.round, isDrawer]);

  // 倒计时
  useEffect(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (!game || game.status !== 'drawing') return;
    setRemainSec(Math.max(0, Math.ceil((drawEndRef.current - Date.now()) / 1000)));
    timerRef.current = setInterval(() => {
      const left = Math.max(0, Math.ceil((drawEndRef.current - Date.now()) / 1000));
      setRemainSec(left);
      if (left <= 0) {
        clearInterval(timerRef.current); timerRef.current = null;
        if (isDrawer) setHintVisible(true);
      }
    }, 500);
    return () => { if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; } };
  }, [game?.status, game?.round, isDrawer]);

  // 前台恢复
  useEffect(() => {
    const handler = (next) => { if (next === 'active' && activeGameIdRef.current) fetchGame(); };
    const sub = AppState.addEventListener('change', handler);
    return () => sub.remove();
  }, [fetchGame]);

  // 键盘高度监听（修复输入框被遮挡）
  useEffect(() => {
    const showSub = Keyboard.addListener('keyboardDidShow', (e) => {
      setKeyboardHeight(e.endCoordinates.height);
    });
    const hideSub = Keyboard.addListener('keyboardDidHide', () => {
      setKeyboardHeight(0);
    });
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  // ══════════ 渲染 ══════════

  const status = game?.status;
  const roundResults = Array.isArray(game?.round_results) ? game.round_results : [];
  const myWins = roundResults.filter((r) => r.winner === 'win' && r.drawer !== myRole).length;
  const partnerWins = roundResults.filter((r) => r.winner === 'win' && r.drawer === myRole).length;

  // ─── 大厅（无对局）───
  if (!activeGameId) {
    return (
      <View style={styles.container}>
        <View style={[styles.header, { paddingTop: Math.max(insets.top, 12) + 4 }]}>
          <IconButton icon="chevron-back" size={24} color={colors.primaryAction} onPress={onBack} accessibilityLabel="返回" />
          <Text style={styles.headerTitle}>🎨 你画我猜</Text>
          <View style={styles.headerActions}>
            <TouchableOpacity style={styles.iconBtn} onPress={() => { setCustomWordsModal(true); fetchCustomWords(); }} activeOpacity={0.7}>
              <Text style={styles.iconBtnText}>📖</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.iconBtn} onPress={openGallery} activeOpacity={0.7}>
              <Text style={styles.iconBtnText}>🖼️</Text>
            </TouchableOpacity>
          </View>
        </View>
        <View style={styles.lobbyWrap}>
          <Text style={styles.lobbyEmoji}>🎨</Text>
          <Text style={styles.lobbyTitle}>你画我猜</Text>
          <Text style={styles.lobbyDesc}>一人画一人猜，6 轮交替</Text>
          <TouchableOpacity style={styles.inviteBtn} onPress={handleInvite} activeOpacity={0.8}>
            <Text style={styles.inviteBtnText}>✉️ 邀请 {partnerId} 来玩</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.galleryBtn} onPress={openGallery} activeOpacity={0.7}>
            <Text style={styles.galleryBtnText}>🖼️ 查看画作画廊</Text>
          </TouchableOpacity>
        </View>
        {renderCustomWordsModal()}
        {renderGalleryModal()}
        {renderViewer()}
      </View>
    );
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primaryAction} />
        <Text style={styles.loadingText}>加载中...</Text>
      </View>
    );
  }

  const isWaiting = status === 'waiting';
  const isPicking = status === 'picking';
  const isDrawing = status === 'drawing';
  const isFinished = status === 'finished';

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 12) + 4 }]}>
        <IconButton icon="chevron-back" size={24} color={colors.primaryAction} onPress={onBack} accessibilityLabel="返回" />
        <Text style={styles.headerTitle}>🎨 你画我猜</Text>
        <View style={styles.headerActions}>
          <TouchableOpacity style={styles.iconBtn} onPress={openGallery} activeOpacity={0.7}>
            <Text style={styles.iconBtnText}>🖼️</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* 轮次 & 比分 */}
      <View style={styles.infoBar}>
        <Text style={styles.infoRole}>
          {isDrawer ? '✏️ 你来画' : '🤔 你来猜'} · 第 {game?.round || 1}/{TOTAL_ROUNDS} 轮
        </Text>
        <Text style={styles.infoScore}>我 {myWins} : {partnerWins} {partnerId}</Text>
        {(isDrawing || (isFinished && game?.winner === 'win')) && (
          <Text style={[styles.infoTimer, remainSec <= 10 && isDrawing && styles.infoTimerWarn]}>
            {isDrawing ? `⏱ ${remainSec}s` : ''}
          </Text>
        )}
      </View>

      {/* 上轮结果提示 */}
      {isPicking && roundResults.length > 0 && (() => {
        const last = roundResults[roundResults.length - 1];
        return (
          <View style={styles.lastRoundBar}>
            <Text style={styles.lastRoundText}>
              上轮：{last.drawer === myRole ? '你' : partnerId} 画「{last.word}」→ {resultLabel(last.winner)}
              {last.duration != null ? ` (${last.duration}s)` : ''}
            </Text>
          </View>
        );
      })()}

      {isWaiting && (
        <View style={styles.center}>
          <Text style={styles.waitEmoji}>⏳</Text>
          <Text style={styles.waitText}>邀请已发送，等待 {partnerId} 加入...</Text>
        </View>
      )}

      {isPicking && (
        <View style={styles.center}>
          {isDrawer ? (
            <>
              <Text style={styles.pickTitle}>三选一，选一个你来画 🎨</Text>
              <View style={styles.pickRow}>
                {displayWordChoices.map((w, i) => (
                  <TouchableOpacity key={i} style={styles.pickCard} onPress={() => handlePickWord(w)} activeOpacity={0.7}>
                    <Text style={styles.pickCardText}>{w}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          ) : (
            <>
              <Text style={styles.waitEmoji}>🤔</Text>
              <Text style={styles.waitText}>对方正在选词...</Text>
            </>
          )}
        </View>
      )}

      {(isDrawing || isFinished) && !isFinished && (
        <>
        <View style={styles.canvasWrap}>
          {/* 弹幕层 */}
          <DanmakuLayer danmakuList={danmakuList} screenWidth={SCREEN_WIDTH} onDanmakuEnd={handleDanmakuEnd} />

          {/* 答题反馈浮层（猜对/猜错）*/}
          {feedback && (
            <View style={[styles.feedbackToast, feedback.type === 'correct' ? styles.feedbackCorrect : styles.feedbackWrong]} pointerEvents="none">
              <Text style={styles.feedbackText}>{feedback.text}</Text>
            </View>
          )}

          {isDrawer && game?.word && (
            <View style={styles.wordChip}><Text style={styles.wordChipText}>本局词：{game.word}</Text></View>
          )}
          {!isDrawer && isDrawing && (
            <View style={styles.hintChip}>
              <Text style={styles.hintChipText}>💡 提示：{getCategoryHint(game?.word)}{game?.hint ? ` · ${game.hint}` : ''}</Text>
            </View>
          )}

          <View
            style={styles.canvas}
            onStartShouldSetResponder={() => isDrawer && isDrawing}
            onMoveShouldSetResponder={() => isDrawer && isDrawing}
            onResponderGrant={(e) => startStroke(e.nativeEvent.locationX, e.nativeEvent.locationY)}
            onResponderMove={(e) => addToStroke(e.nativeEvent.locationX, e.nativeEvent.locationY)}
            onResponderRelease={endStroke}
            onResponderTerminate={endStroke}
          >
            <Svg width={CW} height={CH} style={styles.svg} pointerEvents="none">
              <Rect x={0} y={0} width={CW} height={CH} fill="#FFFFFF" />
              {strokes.map((s, i) => (
                <Path key={i} d={pointsToPath(s.points)} stroke={rgbStr(s.color)} strokeWidth={s.width} fill="none" strokeLinecap="round" strokeLinejoin="round" />
              ))}
              {currentStroke && (
                <Path d={pointsToPath(currentStroke.points)} stroke={rgbStr(currentStroke.color)} strokeWidth={currentStroke.width} fill="none" strokeLinecap="round" strokeLinejoin="round" />
              )}
              {remoteCurrent && (
                <Path d={pointsToPath(remoteCurrent.points)} stroke={rgbStr(remoteCurrent.color)} strokeWidth={remoteCurrent.width} fill="none" strokeLinecap="round" strokeLinejoin="round" />
              )}
            </Svg>
          </View>

          {isDrawer && wrongGuesses.length > 0 && (
            <View style={styles.wrongGuessRow}>
              <Text style={styles.wrongGuessLabel}>对方猜：</Text>
              {wrongGuesses.slice(-3).map((g, i) => (
                <Text key={i} style={styles.wrongGuessChip}>{g}</Text>
              ))}
            </View>
          )}

          {isDrawer && isDrawing && !hintVisible && (
            <View style={styles.toolbar}>
              <View style={styles.colorRow}>
                {COLORS.map((c, i) => (
                  <TouchableOpacity
                    key={c.key}
                    style={[styles.colorDot, { backgroundColor: rgbStr(c.rgb) }, !isEraser && colorIdx === i && styles.colorDotActive]}
                    onPress={() => { setColorIdx(i); setIsEraser(false); }}
                  />
                ))}
                <TouchableOpacity
                  style={[styles.colorDot, styles.eraserDot, isEraser && styles.colorDotActive]}
                  onPress={() => setIsEraser(true)}
                >
                  <Text style={styles.eraserText}>⌫</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.toolRow}>
                {SIZES.map((s, i) => (
                  <TouchableOpacity
                    key={i}
                    style={[styles.sizeBtn, !isEraser && sizeIdx === i && styles.sizeBtnActive]}
                    onPress={() => { setSizeIdx(i); setIsEraser(false); }}
                  >
                    <View style={[styles.sizeDot, { width: s, height: s, borderRadius: s / 2 }]} />
                  </TouchableOpacity>
                ))}
                <TouchableOpacity style={styles.toolBtn} onPress={handleUndo} activeOpacity={0.7}>
                  <Text style={styles.toolBtnText}>↩️</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.toolBtn} onPress={handleClear} activeOpacity={0.7}>
                  <Text style={styles.toolBtnText}>🗑️</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {isDrawer && isDrawing && !hintVisible && (
            <TouchableOpacity style={styles.giveUpBtn} onPress={handleGiveUp} activeOpacity={0.7}>
              <Text style={styles.giveUpBtnText}>🏳️ 算了太难了</Text>
            </TouchableOpacity>
          )}

          {isDrawing && !hintVisible && (
            <TouchableOpacity style={styles.saveDrawingBtn} onPress={handleSaveDrawing} activeOpacity={0.7}>
              <Text style={styles.saveDrawingBtnText}>💾 保存画作</Text>
            </TouchableOpacity>
          )}

          {isDrawer && hintVisible && (
            <View style={styles.hintPanel}>
              <Text style={styles.hintPanelTitle}>时间到啦～</Text>
              <Text style={styles.hintPanelWord}>答案：{game?.word}</Text>
              <TextInput
                style={styles.hintInput}
                value={hintInput}
                onChangeText={setHintInput}
                placeholder="给个提示（不能含答案）"
                placeholderTextColor={colors.textMuted}
                maxLength={30}
              />
              <View style={styles.hintBtnRow}>
                <TouchableOpacity style={styles.hintSendBtn} onPress={handleGiveHint} activeOpacity={0.7}>
                  <Text style={styles.hintSendBtnText}>给提示 +{HINT_EXTRA_SECONDS}s</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.hintPublishBtn} onPress={handlePublishAnswer} activeOpacity={0.7}>
                  <Text style={styles.hintPublishBtnText}>公布答案</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {!isDrawer && isDrawing && remainSec <= 0 && (
            <View style={styles.hintPanel}>
              <Text style={styles.hintPanelTitle}>时间到～</Text>
              <Text style={styles.waitText}>等待对方决定...</Text>
            </View>
          )}
        </View>

        {/* 底部输入栏：移出 canvasWrap 作为 KeyboardAvoidingView 直接子节点，
            键盘弹出时 paddingBottom 把输入框顶到键盘上方，不被 flex 容器裁切 */}
        {isDrawing && (
          <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, keyboardHeight) + 8 }]}>
            {!isDrawer && (
              <View style={styles.modeToggle}>
                <TouchableOpacity
                  style={[styles.modeBtn, inputMode === 'guess' && styles.modeBtnActive]}
                  onPress={() => setInputMode('guess')}
                >
                  <Text style={[styles.modeBtnText, inputMode === 'guess' && styles.modeBtnTextActive]}>猜词</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modeBtn, inputMode === 'danmaku' && styles.modeBtnActive]}
                  onPress={() => setInputMode('danmaku')}
                >
                  <Text style={[styles.modeBtnText, inputMode === 'danmaku' && styles.modeBtnTextActive]}>弹幕</Text>
                </TouchableOpacity>
              </View>
            )}
            {isDrawer && (
              <View style={styles.modeToggle}>
                <View style={[styles.modeBtn, styles.modeBtnActive]}>
                  <Text style={[styles.modeBtnText, styles.modeBtnTextActive]}>弹幕</Text>
                </View>
              </View>
            )}
            <View style={styles.inputRow}>
              <TextInput
                ref={bottomInputRef}
                style={styles.bottomInput}
                value={isDrawer ? danmakuInput : (inputMode === 'guess' ? guessInput : danmakuInput)}
                onChangeText={(t) => {
                  if (isDrawer) setDanmakuInput(t);
                  else if (inputMode === 'guess') setGuessInput(t);
                  else setDanmakuInput(t);
                }}
                placeholder={isDrawer || inputMode === 'danmaku' ? '发个弹幕...' : '打字猜猜看...'}
                placeholderTextColor={colors.textMuted}
                maxLength={isDrawer || inputMode === 'danmaku' ? 30 : 20}
                blurOnSubmit={false}
                autoCorrect={false}
                onSubmitEditing={() => {
                  if (isDrawer || inputMode === 'danmaku') sendDanmaku();
                  else handleSubmitGuess();
                }}
                returnKeyType="send"
              />
              <TouchableOpacity
                style={styles.bottomSendBtn}
                onPress={() => {
                  if (isDrawer || inputMode === 'danmaku') sendDanmaku();
                  else handleSubmitGuess();
                }}
                activeOpacity={0.7}
              >
                <Text style={styles.bottomSendBtnText}>发送</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
        </>
      )}

      {isFinished && (
        <View style={styles.finishWrap}>
          <Text style={styles.finishEmoji}>🎮</Text>
          <Text style={styles.finishTitle}>六轮结束！</Text>
          <Text style={styles.finishScore}>我猜对 {myWins} · {partnerId} 猜对 {partnerWins}</Text>
          <View style={styles.roundResultsList}>
            {roundResults.map((r, i) => (
              <Text key={i} style={styles.roundResultItem}>
                第{r.round}轮 · {r.drawer === myRole ? '我' : partnerId}画「{r.word}」→ {resultLabel(r.winner)}
                {r.duration != null ? ` ${r.duration}s` : ''}
              </Text>
            ))}
          </View>
          <View style={styles.finishBtnRow}>
            <TouchableOpacity style={styles.rematchBtn} onPress={handleRematch} activeOpacity={0.7}>
              <Text style={styles.rematchBtnText}>🔄 再来一局</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.finishGalleryBtn} onPress={openGallery} activeOpacity={0.7}>
              <Text style={styles.finishGalleryBtnText}>🖼️ 看画廊</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {renderGalleryModal()}
      {renderViewer()}
      {renderCustomWordsModal()}
    </KeyboardAvoidingView>
  );

  // ══════════ 弹窗渲染 ══════════

  function renderGalleryModal() {
    return (
      <Modal visible={galleryVisible} animationType="slide" transparent={false}>
        <View style={[styles.modalContainer, { paddingTop: insets.top }]}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>🖼️ 画作画廊（{gallery.length}）</Text>
            <TouchableOpacity onPress={() => setGalleryVisible(false)}>
              <Text style={styles.modalClose}>✕</Text>
            </TouchableOpacity>
          </View>
          {galleryLoading ? (
            <ActivityIndicator size="large" color={colors.primaryAction} style={{ marginTop: 40 }} />
          ) : gallery.length === 0 ? (
            <View style={styles.emptyWrap}>
              <Text style={styles.emptyText}>还没有画作～{"\n"}画完后点「💾 保存画作」就会出现在这里</Text>
            </View>
          ) : (
            <FlatList
              data={gallery}
              keyExtractor={(item) => item.id}
              numColumns={2}
              contentContainerStyle={{ paddingBottom: 20 }}
              renderItem={({ item }) => (
                <View style={styles.galleryCard}>
                  <TouchableOpacity style={styles.galleryCardTouch} onPress={() => setViewerImage(item)} activeOpacity={0.8}>
                    <CachedImage source={{ uri: item.image_url }} style={styles.galleryImg} resizeMode="contain" />
                    <Text style={styles.galleryWord} numberOfLines={1}>{item.word}</Text>
                    <Text style={styles.galleryMeta}>
                      {resultLabel(item.result)}{item.duration_sec != null ? ` · ${item.duration_sec}s` : ''}
                    </Text>
                    <Text style={styles.galleryDate}>
                      {new Date(item.created_at).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.galleryDeleteBtn} onPress={() => handleDeleteGalleryItem(item)} activeOpacity={0.7}>
                    <Text style={styles.galleryDeleteBtnText}>🗑️</Text>
                  </TouchableOpacity>
                </View>
              )}
            />
          )}
        </View>
      </Modal>
    );
  }

  function renderViewer() {
    if (!viewerImage) return null;
    return (
      <Modal visible={!!viewerImage} animationType="fade" transparent={true} onRequestClose={() => setViewerImage(null)}>
        <View style={styles.viewerWrap}>
          <TouchableOpacity style={[styles.viewerClose, { top: insets.top + 10 }]} onPress={() => setViewerImage(null)}>
            <Text style={styles.viewerCloseText}>✕</Text>
          </TouchableOpacity>
          <CachedImage source={{ uri: viewerImage.image_url }} style={styles.viewerImg} resizeMode="contain" />
          <View style={styles.viewerInfo}>
            <Text style={styles.viewerWord}>{viewerImage.word}</Text>
            <Text style={styles.viewerMeta}>
              {resultLabel(viewerImage.result)} · 画：{viewerImage.drawer_id} · 猜：{viewerImage.guesser_id}
            </Text>
            <TouchableOpacity style={styles.viewerDownloadBtn} onPress={() => handleDownloadImage(viewerImage.image_url)}>
              <Text style={styles.viewerDownloadBtnText}>💾 保存到相册</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.viewerDeleteBtn} onPress={() => handleDeleteGalleryItem(viewerImage)}>
              <Text style={styles.viewerDeleteBtnText}>🗑️ 从画廊删除</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    );
  }

  function renderCustomWordsModal() {
    return (
      <Modal visible={customWordsModal} animationType="slide" transparent={false}>
        <View style={[styles.modalContainer, { paddingTop: insets.top }]}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>📖 自定义词库</Text>
            <TouchableOpacity onPress={() => setCustomWordsModal(false)}>
              <Text style={styles.modalClose}>✕</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.addWordRow}>
            <TextInput
              style={styles.addWordInput}
              value={newWord}
              onChangeText={setNewWord}
              placeholder="输入自定义词"
              placeholderTextColor={colors.textMuted}
              maxLength={20}
              onSubmitEditing={handleAddWord}
            />
            <TouchableOpacity style={styles.addWordBtn} onPress={handleAddWord} activeOpacity={0.7}>
              <Text style={styles.addWordBtnText}>添加</Text>
            </TouchableOpacity>
          </View>
          <FlatList
            data={customWords}
            keyExtractor={(item) => item.id}
            contentContainerStyle={{ paddingBottom: 20 }}
            renderItem={({ item }) => (
              <View style={styles.wordItem}>
                <Text style={styles.wordItemText}>{item.word}</Text>
                <TouchableOpacity onPress={() => handleDeleteWord(item.id)}>
                  <Text style={styles.wordItemDelete}>✕</Text>
                </TouchableOpacity>
              </View>
            )}
          />
        </View>
      </Modal>
    );
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingBottom: 10, backgroundColor: colors.surface, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  headerTitle: { fontSize: 18, fontWeight: 'bold', color: colors.textPrimary, flex: 1, textAlign: 'center' },
  headerActions: { flexDirection: 'row' },
  iconBtn: { paddingHorizontal: 8, paddingVertical: 6 },
  iconBtnText: { fontSize: 22 },
  infoBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 8, backgroundColor: colors.surface, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  infoRole: { fontSize: 14, color: colors.primaryAction, fontWeight: '600' },
  infoScore: { fontSize: 13, color: colors.textSecondary },
  infoTimer: { fontSize: 16, fontWeight: 'bold', color: colors.textPrimary },
  infoTimerWarn: { color: colors.error },
  lastRoundBar: { backgroundColor: colors.primary[100], paddingHorizontal: 16, paddingVertical: 6 },
  lastRoundText: { fontSize: 13, color: colors.primary[700], textAlign: 'center' },
  lobbyWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 30 },
  lobbyEmoji: { fontSize: 72, marginBottom: 16 },
  lobbyTitle: { fontSize: 28, fontWeight: 'bold', color: colors.primaryAction, marginBottom: 10 },
  lobbyDesc: { fontSize: 15, color: colors.textMuted, textAlign: 'center', lineHeight: 22, marginBottom: 40 },
  inviteBtn: { backgroundColor: colors.primaryAction, paddingVertical: 14, paddingHorizontal: 32, borderRadius: 30, marginBottom: 16 },
  inviteBtnText: { color: colors.neutral[0], fontSize: 17, fontWeight: '600' },
  galleryBtn: { paddingVertical: 12, paddingHorizontal: 24, borderRadius: 20, borderWidth: 1.5, borderColor: colors.primaryAction },
  galleryBtnText: { color: colors.primaryAction, fontSize: 15 },
  loadingText: { marginTop: 12, color: colors.textMuted },
  waitEmoji: { fontSize: 56, marginBottom: 16 },
  waitText: { fontSize: 16, color: colors.textMuted, textAlign: 'center' },
  pickTitle: { fontSize: 18, fontWeight: '600', color: colors.textPrimary, marginBottom: 24 },
  pickRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 12 },
  pickCard: { backgroundColor: colors.surface, paddingVertical: 18, paddingHorizontal: 24, borderRadius: 16, borderWidth: 2, borderColor: colors.primary[200], margin: 6 },
  pickCardText: { fontSize: 20, fontWeight: '600', color: colors.primaryAction },
  canvasWrap: { flex: 1, alignItems: 'center', paddingTop: 8 },
  wordChip: { backgroundColor: colors.primaryAction, paddingHorizontal: 14, paddingVertical: 5, borderRadius: 16, marginBottom: 6 },
  wordChipText: { color: colors.neutral[0], fontSize: 14, fontWeight: '600' },
  hintChip: { backgroundColor: colors.amber[100], paddingHorizontal: 14, paddingVertical: 5, borderRadius: 16, marginBottom: 6 },
  hintChipText: { color: colors.amber[500], fontSize: 14 },
  canvas: { width: CW, height: CH, backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  svg: { backgroundColor: colors.surface },
  wrongGuessRow: { flexDirection: 'row', alignItems: 'center', marginTop: 6, flexWrap: 'wrap', paddingHorizontal: 16 },
  wrongGuessLabel: { fontSize: 13, color: colors.textMuted },
  wrongGuessChip: { fontSize: 13, color: colors.error, backgroundColor: colors.errorSoft, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, marginHorizontal: 3, marginVertical: 2 },
  toolbar: { width: CW, marginTop: 8, paddingHorizontal: 8, paddingVertical: 6, backgroundColor: colors.surface, borderRadius: 12 },
  colorRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 6 },
  colorDot: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: 'transparent' },
  colorDotActive: { borderColor: colors.primaryAction, transform: [{ scale: 1.15 }] },
  eraserDot: { backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.textDisabled, justifyContent: 'center', alignItems: 'center' },
  eraserText: { fontSize: 14 },
  toolRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  sizeBtn: { paddingHorizontal: 8, paddingVertical: 6, borderRadius: 8, borderWidth: 1.5, borderColor: 'transparent' },
  sizeBtnActive: { borderColor: colors.primaryAction },
  sizeDot: { backgroundColor: colors.textPrimary },
  toolBtn: { paddingHorizontal: 8, paddingVertical: 4 },
  toolBtnText: { fontSize: 22 },
  giveUpBtn: { marginTop: 8, paddingVertical: 8, paddingHorizontal: 16, borderRadius: 16, borderWidth: 1.5, borderColor: colors.error },
  giveUpBtnText: { color: colors.error, fontSize: 14 },
  saveDrawingBtn: { marginTop: 8, paddingVertical: 8, paddingHorizontal: 16, borderRadius: 16, borderWidth: 1.5, borderColor: colors.primaryAction, backgroundColor: colors.primary[50] },
  saveDrawingBtnText: { color: colors.primaryAction, fontSize: 14, fontWeight: '600' },
  feedbackToast: { position: 'absolute', top: '40%', left: CW * 0.1, right: CW * 0.1, paddingVertical: 16, paddingHorizontal: 20, borderRadius: 16, alignItems: 'center', zIndex: 50, elevation: 8 },
  feedbackCorrect: { backgroundColor: 'rgba(46, 204, 113, 0.95)' },
  feedbackWrong: { backgroundColor: 'rgba(231, 76, 60, 0.95)' },
  feedbackText: { color: colors.neutral[0], fontSize: 18, fontWeight: 'bold', textAlign: 'center' },
  hintPanel: { backgroundColor: colors.surface, borderRadius: radius.xl, padding: 20, alignItems: 'center', margin: 16, borderWidth: 1.5, borderColor: colors.primary[200] },
  hintPanelTitle: { fontSize: 18, fontWeight: 'bold', color: colors.primaryAction, marginBottom: 8 },
  hintPanelWord: { fontSize: 22, fontWeight: 'bold', color: colors.error, marginBottom: 16 },
  hintInput: { borderWidth: 1, borderColor: colors.primary[200], borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15, width: CW - 60, marginBottom: 12, color: colors.textPrimary },
  hintBtnRow: { flexDirection: 'row', gap: 10 },
  hintSendBtn: { backgroundColor: colors.primaryAction, paddingVertical: 10, paddingHorizontal: 16, borderRadius: 20 },
  hintSendBtnText: { color: colors.neutral[0], fontSize: 14, fontWeight: '600' },
  hintPublishBtn: { backgroundColor: colors.error, paddingVertical: 10, paddingHorizontal: 16, borderRadius: 20 },
  hintPublishBtnText: { color: colors.neutral[0], fontSize: 14, fontWeight: '600' },
  bottomBar: { width: SCREEN_WIDTH, backgroundColor: colors.surface, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingHorizontal: 12, paddingVertical: 6 },
  modeToggle: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginBottom: 4 },
  modeBtn: { paddingHorizontal: 16, paddingVertical: 4, borderRadius: 14, backgroundColor: colors.primary[100] },
  modeBtnActive: { backgroundColor: colors.primaryAction },
  modeBtnText: { fontSize: 13, color: colors.primaryAction },
  modeBtnTextActive: { color: colors.neutral[0], fontWeight: '600' },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  bottomInput: { flex: 1, borderWidth: 1, borderColor: colors.primary[200], borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8, fontSize: 15, color: colors.textPrimary },
  bottomSendBtn: { backgroundColor: colors.primaryAction, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20 },
  bottomSendBtnText: { color: colors.neutral[0], fontSize: 14, fontWeight: '600' },
  finishWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24 },
  finishEmoji: { fontSize: 64, marginBottom: 12 },
  finishTitle: { fontSize: 26, fontWeight: 'bold', color: colors.primaryAction, marginBottom: 8 },
  finishScore: { fontSize: 18, color: colors.textPrimary, marginBottom: 20 },
  roundResultsList: { width: '100%', backgroundColor: colors.surface, borderRadius: 16, padding: 16, marginBottom: 20 },
  roundResultItem: { fontSize: 14, color: colors.textSecondary, paddingVertical: 4 },
  finishBtnRow: { flexDirection: 'row', gap: 12 },
  rematchBtn: { backgroundColor: colors.primaryAction, paddingVertical: 14, paddingHorizontal: 28, borderRadius: 28 },
  rematchBtnText: { color: colors.neutral[0], fontSize: 16, fontWeight: '600' },
  finishGalleryBtn: { backgroundColor: colors.surface, paddingVertical: 14, paddingHorizontal: 28, borderRadius: 28, borderWidth: 1.5, borderColor: colors.primaryAction },
  finishGalleryBtnText: { color: colors.primaryAction, fontSize: 16 },
  modalContainer: { flex: 1, backgroundColor: colors.surface },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, backgroundColor: colors.surface },
  modalTitle: { fontSize: 17, fontWeight: 'bold', color: colors.primaryAction },
  modalClose: { fontSize: 20, color: colors.textMuted, paddingHorizontal: 8 },
  emptyWrap: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyText: { fontSize: 15, color: colors.textMuted, textAlign: 'center', lineHeight: 22 },
  galleryCard: { flex: 1, margin: 6, borderRadius: 12, backgroundColor: colors.surface, overflow: 'hidden', borderWidth: 1, borderColor: colors.border, position: 'relative' },
  galleryCardTouch: { flex: 1 },
  galleryDeleteBtn: { position: 'absolute', top: 6, right: 6, width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(231,76,60,0.92)', alignItems: 'center', justifyContent: 'center', zIndex: 5, elevation: 3 },
  galleryDeleteBtnText: { fontSize: 14 },
  galleryImg: { width: '100%', height: 160, backgroundColor: colors.primary[50] },
  galleryWord: { fontSize: 14, fontWeight: '600', color: colors.textPrimary, padding: 8, paddingBottom: 2 },
  galleryMeta: { fontSize: 12, color: colors.textMuted, paddingHorizontal: 8, paddingBottom: 2 },
  galleryDate: { fontSize: 11, color: colors.textDisabled, paddingHorizontal: 8, paddingBottom: 8 },
  viewerWrap: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', justifyContent: 'center', alignItems: 'center' },
  viewerClose: { position: 'absolute', right: 20, zIndex: 10, backgroundColor: 'rgba(255,255,255,0.2)', width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center' },
  viewerCloseText: { color: colors.neutral[0], fontSize: 18 },
  viewerImg: { width: SCREEN_WIDTH * 0.9, height: SCREEN_WIDTH * 0.9 },
  viewerInfo: { marginTop: 20, alignItems: 'center' },
  viewerWord: { fontSize: 22, fontWeight: 'bold', color: colors.neutral[0], marginBottom: 6 },
  viewerMeta: { fontSize: 14, color: colors.textDisabled, marginBottom: 12 },
  viewerDownloadBtn: { backgroundColor: colors.primaryAction, paddingVertical: 10, paddingHorizontal: 24, borderRadius: 22 },
  viewerDeleteBtn: { marginTop: 10, borderWidth: 1.5, borderColor: colors.error, paddingVertical: 10, paddingHorizontal: 24, borderRadius: 22 },
  viewerDeleteBtnText: { color: colors.error, fontSize: 14, fontWeight: '600' },
  viewerDownloadBtnText: { color: colors.neutral[0], fontSize: 15, fontWeight: '600' },
  addWordRow: { flexDirection: 'row', padding: 12, gap: 8 },
  addWordInput: { flex: 1, borderWidth: 1, borderColor: colors.primary[200], borderRadius: 12, paddingHorizontal: 14, paddingVertical: 8, fontSize: 15, color: colors.textPrimary, backgroundColor: colors.surface },
  addWordBtn: { backgroundColor: colors.primaryAction, paddingHorizontal: 18, paddingVertical: 8, borderRadius: 12, justifyContent: 'center' },
  addWordBtnText: { color: colors.neutral[0], fontSize: 15, fontWeight: '600' },
  wordItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: colors.surface, marginHorizontal: 12, marginVertical: 3, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: colors.border },
  wordItemText: { fontSize: 15, color: colors.textPrimary },
  wordItemDelete: { fontSize: 16, color: colors.error, paddingHorizontal: 8 },
});