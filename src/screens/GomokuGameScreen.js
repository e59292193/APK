// ═══════════════════════════════════════════════════════
// 五子棋对局屏幕
// - 15x15 棋盘，黑(邀请方)先手，棋子落在交叉点
// - Supabase Realtime 同步落子 + 弹幕(broadcast)
// - 自动判胜、计分板、认输、再来一局
// - 历史战绩查看/删除、手动调整胜场(迁移历史记录)
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
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { fetchWithTimeout } from '../lib/fetchWithTimeout';
import { onSignal, emitSignal } from '../lib/realtimeSignal';
import DanmakuLayer from '../components/DanmakuLayer';
import {
  BOARD_SIZE,
  STONE,
  buildBoard,
  checkWin,
  isDraw,
  nextTurn,
  roleToStone,
  getWinLine,
} from '../lib/gomokuUtils';
import { IconButton } from '../components/ui';
import { colors } from '../theme';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const BOARD_PIXEL = Math.floor(SCREEN_WIDTH * 0.92);
const CELL = BOARD_PIXEL / BOARD_SIZE;

// AsyncStorage fallback key（当 gomoku_manual_wins 表不存在时使用）
const MANUAL_WINS_STORAGE_KEY = 'gomoku_manual_wins_cache';

// 读取本地 manual wins 缓存：{ [userId]: { wins, draws } }
async function readLocalManualWins() {
  try {
    const raw = await AsyncStorage.getItem(MANUAL_WINS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

// 写入本地 manual wins 缓存
async function writeLocalManualWins(data) {
  try {
    await AsyncStorage.setItem(MANUAL_WINS_STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    console.warn('[manualWins] 本地缓存写入失败:', e.message);
  }
}

const STONE_SIZE = CELL * 0.85;

const VALID_USERS = { momo: true, '苞米': true };

export default function GomokuGameScreen({ gameId, userId, onBack, onNavigateGame }) {
  const insets = useSafeAreaInsets();
  // activeGameId：当前对局 ID（来自外部 gameId 或大厅邀请后内部生成）
  const [activeGameId, setActiveGameId] = useState(gameId || null);
  const [game, setGame] = useState(null);
  const [stats, setStats] = useState({ momoWins: 0, partnerWins: 0, draws: 0, total: 0 });
  const [loading, setLoading] = useState(!!gameId);
  const [placing, setPlacing] = useState(false);
  const placingRef = useRef(false); // 轮询兜底时跳过落子中的乐观更新窗口
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [inviting, setInviting] = useState(false);

  // 计时器
  const [elapsedSec, setElapsedSec] = useState(0);
  const timerRef = useRef(null);
  const gameStartRef = useRef(0);

  // 再来一局（数据库列 + broadcast 双保险）
  // rematchStatus: 'idle' | 'requested_by_me' | 'requested_by_opponent'
  const [rematchStatus, setRematchStatusState] = useState('idle');
  const rematchStatusRef = useRef('idle');
  const rematchCreatingRef = useRef(false);
  const updateRematchStatus = useCallback((s) => {
    rematchStatusRef.current = s;
    setRematchStatusState(s);
  }, []);

  // refs 用于在 realtime 回调中读取最新值，避免 channel 重建
  const onNavigateGameRef = useRef(onNavigateGame);
  const userIdRef = useRef(userId);
  const gameStatusRef = useRef(null); // 跟踪 game.status 变化，避免重复提示
  useEffect(() => { onNavigateGameRef.current = onNavigateGame; }, [onNavigateGame]);
  useEffect(() => { userIdRef.current = userId; }, [userId]);

  // ─── 核心：从数据库行同步重赛状态到 UI ───
  // 统一逻辑：fetchGame 和 realtime postgres_changes 都调用此函数
  // 规则：
  //   1. rematch_game_id 存在 → 对方已同意，跳转新对局
  //   2. rematch_request_by === userId → 我发起过请求，显示"等待对方同意"
  //   3. rematch_request_by === 对方 → 对方请求重赛，显示"同意/拒绝"
  //   4. 都为 null → idle
  const syncRematchFromDB = useCallback((row) => {
    if (!row) return;
    const cur = rematchStatusRef.current;

    // 1. 已有新对局 → 跳转（无论当前状态，防止重进入时漏跳）
    if (row.rematch_game_id) {
      if (cur !== 'navigated') {
        updateRematchStatus('navigated');
        onNavigateGameRef.current(row.rematch_game_id);
      }
      return;
    }

    // 2. 我发起的请求
    if (row.rematch_request_by === userIdRef.current) {
      if (cur !== 'requested_by_me') {
        updateRematchStatus('requested_by_me');
      }
      return;
    }

    // 3. 对方发起的请求
    if (row.rematch_request_by && row.rematch_request_by !== userIdRef.current) {
      if (cur === 'idle' || cur === 'requested_by_me') {
        Vibration.vibrate([0, 30, 50, 30]);
        updateRematchStatus('requested_by_opponent');
      }
      return;
    }

    // 4. 无请求
    if (cur === 'requested_by_me') {
      // 之前我请求过，现在被清空 → 对方拒绝
      updateRematchStatus('idle');
      Alert.alert('提示', '对方暂时不想再来一局啦');
    } else if (cur === 'requested_by_opponent' || cur === 'navigated') {
      updateRematchStatus('idle');
    }
  }, [updateRematchStatus]);

  // 弹幕
  const [danmakuList, setDanmakuList] = useState([]);
  const [danmakuInput, setDanmakuInput] = useState('');

  // 历史战绩
  const [historyVisible, setHistoryVisible] = useState(false);
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // 手动调整
  const [adjustVisible, setAdjustVisible] = useState(false);
  const [myManualWins, setMyManualWins] = useState('0');
  const [partnerManualWins, setPartnerManualWins] = useState('0');
  const [manualDraws, setManualDraws] = useState('0');
  const [adjustSaving, setAdjustSaving] = useState(false);

  const myRole = useMemo(() => {
    if (!game) return null;
    if (game.creator_id === userId) return 'creator';
    if (game.invitee_id === userId) return 'invitee';
    return null;
  }, [game, userId]);

  const partnerId = useMemo(() => {
    if (!game) {
      // 大厅态：从 VALID_USERS 推断对手
      return Object.keys(VALID_USERS).find((u) => u !== userId) || '';
    }
    return game.creator_id === userId ? game.invitee_id : game.creator_id;
  }, [game, userId]);

  const board = useMemo(() => buildBoard(game?.moves || []), [game?.moves]);
  const moves = game?.moves || [];
  const lastMove = moves.length > 0 ? moves[moves.length - 1] : null;

  const winLine = useMemo(() => {
    if (!game || game.status !== 'finished' || !game.winner || !lastMove) return null;
    if (game.winner === 'draw') return null;
    const winStone = roleToStone(game.winner);
    return getWinLine(board, lastMove.x, lastMove.y, winStone);
  }, [game, board, lastMove]);

  // ─── 加载对局数据 ───
  // silent=true 时静默失败（轮询调用），避免每 3 秒弹错误框
  const fetchGame = useCallback(async (silent = false) => {
    if (!activeGameId) return;
    try {
      const { data, error } = await fetchWithTimeout(() =>
        supabase.from('gomoku_games').select('*').eq('id', activeGameId).single()
      );
      if (error) throw error;
      // 轮询兜底时避免覆盖进行中的乐观更新：只在 DB 状态更新（落子更多/状态变化/重赛变化）时才 setGame
      setGame((prev) => {
        if (!prev) return data;
        const prevMoves = prev.moves || [];
        const dbMoves = data.moves || [];
        // DB 落子数更多 → 对方落子，采纳
        if (dbMoves.length > prevMoves.length) return data;
        // 落子数相同但状态变化 → 加入/认输/重赛等，采纳
        if (dbMoves.length === prevMoves.length && data.status !== prev.status) return data;
        // 重赛状态变化 → 采纳
        if (data.rematch_request_by !== prev.rematch_request_by) return data;
        if (data.rematch_game_id !== prev.rematch_game_id) return data;
        // 落子数更少或全相同 → 保留本地（乐观更新或无变化）
        return prev;
      });
      gameStatusRef.current = data.status;

      // ── 从数据库同步重赛状态（重进入旧对局也能正确恢复 UI）──
      syncRematchFromDB(data);
    } catch (error) {
      console.error('Error fetching game:', error);
      if (!silent) Alert.alert('错误', '加载对局失败');
    } finally {
      setLoading(false);
    }
  }, [activeGameId, syncRematchFromDB]);

  // ─── 加载计分板（数据库统计 + 手动迁移值，带本地容错）───
  const fetchStats = useCallback(async () => {
    try {
      const gameRes = await fetchWithTimeout(() =>
        supabase
          .from('gomoku_games')
          .select('winner, creator_id, invitee_id')
          .eq('status', 'finished')
          .or(`creator_id.eq.${userId},invitee_id.eq.${userId}`)
      );

      const gameData = gameRes.data || [];

      let dbMomoWins = 0, dbPartnerWins = 0, dbDraws = 0;
      for (const row of gameData) {
        const winnerId =
          row.winner === 'creator' ? row.creator_id :
          row.winner === 'invitee' ? row.invitee_id : null;
        if (row.winner === 'draw') dbDraws++;
        else if (winnerId === userId) dbMomoWins++;
        else if (winnerId === partnerId) dbPartnerWins++;
      }

      // 尝试从数据库读取 manual wins；表不存在时回退到 AsyncStorage
      let myManual = 0, partnerManual = 0, myManualDraws = 0;
      let manualData = null;
      try {
        const manualRes = await fetchWithTimeout(() =>
          supabase
            .from('gomoku_manual_wins')
            .select('user_id, wins, draws')
            .in('user_id', [userId, partnerId])
        );
        if (!manualRes.error) manualData = manualRes.data || [];
      } catch (e) {
        console.warn('[fetchStats] gomoku_manual_wins 表读取失败，使用本地缓存:', e.message);
      }

      if (manualData) {
        for (const m of manualData) {
          if (m.user_id === userId) { myManual = m.wins || 0; myManualDraws = m.draws || 0; }
          if (m.user_id === partnerId) { partnerManual = m.wins || 0; }
        }
      } else {
        // 回退到 AsyncStorage 本地缓存
        const local = await readLocalManualWins();
        if (local[userId]) { myManual = local[userId].wins || 0; myManualDraws = local[userId].draws || 0; }
        if (local[partnerId]) { partnerManual = local[partnerId].wins || 0; }
      }

      setStats({
        momoWins: dbMomoWins + myManual,
        partnerWins: dbPartnerWins + partnerManual,
        draws: dbDraws + myManualDraws,
        total: gameData.length + myManual + partnerManual + myManualDraws,
      });
    } catch (error) {
      console.error('Error fetching stats:', error);
    }
  }, [userId, partnerId]);

  // ─── 加载历史战绩 ───
  const fetchHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const { data, error } = await fetchWithTimeout(() =>
        supabase
          .from('gomoku_games')
          .select('id, creator_id, invitee_id, winner, status, created_at, finished_at')
          .eq('status', 'finished')
          .or(`creator_id.eq.${userId},invitee_id.eq.${userId}`)
          .order('finished_at', { ascending: false, nullsFirst: false })
          .limit(100)
      );
      if (error) throw error;
      setHistory(data || []);
    } catch (error) {
      console.error('Error fetching history:', error);
      Alert.alert('错误', '加载历史战绩失败');
    } finally {
      setHistoryLoading(false);
    }
  }, [userId]);

  // ─── 删除历史对局 ───
  const handleDeleteHistory = useCallback((id) => {
    Alert.alert('删除记录', '确定删除这条对战记录吗？', [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          try {
            const { error } = await fetchWithTimeout(() =>
              supabase.from('gomoku_games').delete().eq('id', id)
            );
            if (error) throw error;
            setHistory((prev) => prev.filter((h) => h.id !== id));
            fetchStats();
          } catch (error) {
            console.error('Error deleting:', error);
            Alert.alert('错误', '删除失败');
          }
        },
      },
    ]);
  }, [fetchStats]);

  // ─── 加载校准数据：查询当前总数（数据库统计 + manual，带本地容错）───
  const fetchManualWins = useCallback(async () => {
    try {
      const gameRes = await fetchWithTimeout(() =>
        supabase
          .from('gomoku_games')
          .select('winner, creator_id, invitee_id')
          .eq('status', 'finished')
          .or(`creator_id.eq.${userId},invitee_id.eq.${userId}`)
      );

      let dbMy = 0, dbPartner = 0, dbDraws = 0;
      for (const row of gameRes.data || []) {
        const winnerId =
          row.winner === 'creator' ? row.creator_id :
          row.winner === 'invitee' ? row.invitee_id : null;
        if (row.winner === 'draw') dbDraws++;
        else if (winnerId === userId) dbMy++;
        else if (winnerId === partnerId) dbPartner++;
      }

      // 尝试从数据库读取；表不存在时回退到 AsyncStorage
      let myManual = 0, partnerManual = 0, myManualDraws = 0;
      let manualData = null;
      try {
        const manualRes = await fetchWithTimeout(() =>
          supabase
            .from('gomoku_manual_wins')
            .select('user_id, wins, draws')
            .in('user_id', [userId, partnerId])
        );
        if (!manualRes.error) manualData = manualRes.data || [];
      } catch (e) {
        console.warn('[fetchManualWins] gomoku_manual_wins 表读取失败，使用本地缓存:', e.message);
      }

      if (manualData) {
        for (const m of manualData) {
          if (m.user_id === userId) { myManual = m.wins || 0; myManualDraws = m.draws || 0; }
          if (m.user_id === partnerId) { partnerManual = m.wins || 0; }
        }
      } else {
        const local = await readLocalManualWins();
        if (local[userId]) { myManual = local[userId].wins || 0; myManualDraws = local[userId].draws || 0; }
        if (local[partnerId]) { partnerManual = local[partnerId].wins || 0; }
      }

      // 显示当前总数
      setMyManualWins(String(dbMy + myManual));
      setPartnerManualWins(String(dbPartner + partnerManual));
      setManualDraws(String(dbDraws + myManualDraws));
    } catch (error) {
      console.error('Error fetching adjust data:', error);
    }
  }, [userId, partnerId]);

  // ─── 保存校准：差额 = 用户输入 - 数据库实际统计（带本地容错）───
  const handleSaveAdjust = useCallback(async () => {
    setAdjustSaving(true);
    try {
      const targetMy = parseInt(myManualWins, 10) || 0;
      const targetPartner = parseInt(partnerManualWins, 10) || 0;
      const targetDraws = parseInt(manualDraws, 10) || 0;

      // 先查询数据库实际统计值（不含 manual）
      const { data: gameData, error: gameErr } = await fetchWithTimeout(() =>
        supabase
          .from('gomoku_games')
          .select('winner, creator_id, invitee_id')
          .eq('status', 'finished')
          .or(`creator_id.eq.${userId},invitee_id.eq.${userId}`)
      );
      if (gameErr) throw gameErr;

      let dbMy = 0, dbPartner = 0, dbDraws = 0;
      for (const row of gameData || []) {
        const winnerId =
          row.winner === 'creator' ? row.creator_id :
          row.winner === 'invitee' ? row.invitee_id : null;
        if (row.winner === 'draw') dbDraws++;
        else if (winnerId === userId) dbMy++;
        else if (winnerId === partnerId) dbPartner++;
      }

      // 差额（可为负数）
      const diffMy = targetMy - dbMy;
      const diffPartner = targetPartner - dbPartner;
      const diffDraws = targetDraws - dbDraws;

      // 尝试写入数据库；表不存在时回退到 AsyncStorage
      let dbOk = false;
      try {
        const upserts = [
          { user_id: userId, wins: diffMy, draws: diffDraws, updated_at: new Date().toISOString() },
          { user_id: partnerId, wins: diffPartner, draws: 0, updated_at: new Date().toISOString() },
        ];
        const { error } = await fetchWithTimeout(() =>
          supabase
            .from('gomoku_manual_wins')
            .upsert(upserts, { onConflict: 'user_id' })
        );
        if (!error) dbOk = true;
      } catch (e) {
        console.warn('[handleSaveAdjust] 数据库写入失败，回退到本地缓存:', e.message);
      }

      if (!dbOk) {
        // 回退到 AsyncStorage 本地缓存
        const local = await readLocalManualWins();
        local[userId] = { wins: diffMy, draws: diffDraws };
        local[partnerId] = { wins: diffPartner, draws: 0 };
        await writeLocalManualWins(local);
      }

      Alert.alert('成功', '战绩已校准');
      setAdjustVisible(false);
      fetchStats();
    } catch (error) {
      console.error('Error saving adjust:', error);
      Alert.alert('错误', '保存失败：' + (error.message || '请检查网络'));
    } finally {
      setAdjustSaving(false);
    }
  }, [myManualWins, partnerManualWins, manualDraws, userId, partnerId, fetchStats]);

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
    emitSignal(`gomoku:${activeGameId}:danmaku`, { text, from: userId });
    // 自己也显示
    addDanmaku(text, 'me');
    setDanmakuInput('');
  }, [danmakuInput, activeGameId, userId, addDanmaku]);

  // ─── 大厅：发送对局邀请 ───
  // 创建对局行（邀请方执黑 creator）+ 发送邀请卡片消息 + 进入等待界面
  const handleSendInvite = useCallback(async () => {
    if (inviting) return;
    setInviting(true);
    try {
      const { data: gameData, error: gameError } = await fetchWithTimeout(() =>
        supabase
          .from('gomoku_games')
          .insert([
            {
              creator_id: userId,
              invitee_id: partnerId,
              status: 'waiting',
              current_turn: 'creator',
            },
          ])
          .select()
      );

      if (gameError) throw gameError;
      if (!gameData || gameData.length === 0) throw new Error('No game data');
      const newGame = gameData[0];

      const { data: gomokuMsg, error: msgError } = await fetchWithTimeout(() =>
        supabase.from('messages').insert([
          {
            user_id: userId,
            content: '五子棋对局邀请',
            type: 'gomoku_invite',
            metadata: {
              game_id: newGame.id,
              creator_id: userId,
              creator_name: userId,
              partner_id: partnerId,
              partner_name: partnerId,
            },
          },
        ]).select()
      );

      if (msgError) throw msgError;
      if (gomokuMsg && gomokuMsg[0]) emitSignal('chat:message', gomokuMsg[0]);

      // 进入等待界面
      setActiveGameId(newGame.id);
      setLoading(true);
    } catch (error) {
      console.error('Error sending gomoku invite:', error);
      Alert.alert('错误', '发送邀请失败，请重试');
    } finally {
      setInviting(false);
    }
  }, [inviting, userId, partnerId]);

  // ─── 辅助：格式化秒数为 MM:SS ───
  const formatDuration = useCallback((sec) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }, []);

  // ─── 初始化 ───
  useEffect(() => {
    // 重置所有状态（重进入对局时从干净状态开始，由 fetchGame 从 DB 恢复）
    updateRematchStatus('idle');
    rematchCreatingRef.current = false;
    gameStatusRef.current = null;
    if (activeGameId) {
      fetchGame();
    } else {
      setLoading(false);
      // 大厅态：加载计分板供展示
      fetchStats();
    }
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [activeGameId]);

  // ─── 订阅实时信号（腾讯 IM：对局更新 + 弹幕）───
  // 注意：依赖数组只放 activeGameId，回调内通过 ref 读取最新状态
  useEffect(() => {
    if (!activeGameId) return;

    // 对局行更新（落子/认输/重赛状态变化的权威来源）
    const unsubUpdate = onSignal(`gomoku:${activeGameId}:update`, (updated) => {
      if (!updated) return;
      const prevStatus = gameStatusRef.current;
      setGame(updated);
      gameStatusRef.current = updated.status;

      if (updated.status === 'finished' && prevStatus !== 'finished') {
        fetchStats();
        // ── 认输趣味提示（只在对局刚刚结束时触发一次）──
        if (updated.resigned_by && updated.resigned_by !== userIdRef.current) {
          const funMsgs = [
            '🏳️ 对方举白旗投降啦！',
            '🙌 对方认输了，你太强啦！',
            '😎 碾压局！对方已认输',
            '🏆 不战而胜！对方认输',
          ];
          Vibration.vibrate([0, 40, 60, 40, 60, 40]);
          Alert.alert('胜利！', funMsgs[Math.floor(Math.random() * funMsgs.length)]);
        }
      }

      // ── 重赛状态同步 ──
      syncRematchFromDB(updated);
    });

    // 弹幕
    const unsubDanmaku = onSignal(`gomoku:${activeGameId}:danmaku`, (payload) => {
      if (payload && payload.text) addDanmaku(payload.text, 'other');
    });

    return () => {
      unsubUpdate();
      unsubDanmaku();
    };
  }, [activeGameId]);

  // ─── DB 轮询兜底（3 秒）───
  // IM 信号跨设备（模拟器↔手机）不可靠，定时拉取保证落子/加入/认输/重赛近实时同步
  // 落子中（placingRef）时跳过，避免覆盖乐观更新
  useEffect(() => {
    if (!activeGameId) return;
    const interval = setInterval(() => {
      if (!placingRef.current) fetchGame(true);
    }, 3000);
    return () => clearInterval(interval);
  }, [activeGameId, fetchGame]);

  // ─── 前台恢复 ───
  useEffect(() => {
    const handler = (nextState) => {
      if (nextState === 'active') {
        fetchGame();
      }
    };
    const sub = AppState.addEventListener('change', handler);
    return () => sub.remove();
  }, [fetchGame]);

  // ─── 键盘高度监听（修复输入框被遮挡）───
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

  // ─── 计时器：游戏进行时每秒更新 ───
  useEffect(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (game && game.status === 'playing') {
      // 从已有 moves 推断起始时间（若有落子记录则估算，否则从 now 开始）
      // 使用 created_at 作为起点近似值（误差仅为等待对方加入的时间）
      const startTime = gameStartRef.current || new Date(game.created_at).getTime();
      gameStartRef.current = startTime;
      setElapsedSec(Math.floor((Date.now() - startTime) / 1000));
      timerRef.current = setInterval(() => {
        setElapsedSec(Math.floor((Date.now() - gameStartRef.current) / 1000));
      }, 1000);
    } else if (game && game.status === 'waiting') {
      setElapsedSec(0);
    }
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [game?.status, game?.id]);

  useEffect(() => {
    if (game) fetchStats();
  }, [game?.creator_id, game?.invitee_id]);

  // ─── 落子 ───
  const handlePlaceStone = useCallback(async (x, y) => {
    if (!game || placing) return;
    if (game.status !== 'playing') return;
    if (game.current_turn !== myRole) return;
    if (board[y][x] !== STONE.EMPTY) return;

    // 触感反馈（落子轻震）
    Vibration.vibrate(8);

    const myStone = roleToStone(myRole);
    const newMoves = [...moves, { x, y, p: myStone }];
    const newBoard = buildBoard(newMoves);
    const won = checkWin(newBoard, x, y, myStone);
    const draw = !won && isDraw(newMoves.length);
    const nextRole = nextTurn(myStone);

    // 先本地更新（极速响应），再同步到服务器
    const optimisticUpdate = {
      moves: newMoves,
      current_turn: nextRole,
    };
    if (won) {
      optimisticUpdate.status = 'finished';
      optimisticUpdate.winner = myRole;
      optimisticUpdate.finished_at = new Date().toISOString();
    } else if (draw) {
      optimisticUpdate.status = 'finished';
      optimisticUpdate.winner = 'draw';
      optimisticUpdate.finished_at = new Date().toISOString();
    }
    setGame((prev) => (prev ? { ...prev, ...optimisticUpdate } : prev));

    // 获胜时强震动庆祝
    if (won) Vibration.vibrate([0, 20, 50, 20, 50]);

    setPlacing(true);
    placingRef.current = true;
    try {
      const { data, error } = await fetchWithTimeout(() =>
        supabase.from('gomoku_games').update(optimisticUpdate).eq('id', activeGameId).select()
      );
      if (error) throw error;
      // 通过 IM 信号通知对方对局更新（数据层已写入 Supabase）
      if (data && data[0]) emitSignal(`gomoku:${activeGameId}:update`, data[0]);
    } catch (error) {
      console.error('Error placing stone:', error);
      Alert.alert('错误', '落子失败，请重试');
      // 回滚
      fetchGame();
    } finally {
      setPlacing(false);
      placingRef.current = false;
    }
  }, [game, board, moves, myRole, placing, activeGameId, fetchGame]);

  // ─── 认输 ───
  const handleResign = useCallback(() => {
    if (!game || game.status !== 'playing') return;
    Alert.alert('认输', '确定要认输吗？将判定对方获胜', [
      { text: '取消', style: 'cancel' },
      {
        text: '认输',
        style: 'destructive',
        onPress: async () => {
          const opponentRole = myRole === 'creator' ? 'invitee' : 'creator';
          try {
            const { data, error } = await fetchWithTimeout(() =>
              supabase
                .from('gomoku_games')
                .update({
                  status: 'finished',
                  winner: opponentRole,
                  finished_at: new Date().toISOString(),
                  resigned_by: userId,
                })
                .eq('id', activeGameId)
                .select()
            );
            if (error) throw error;
            // 更新本地状态 + 通过 IM 信号通知对方对局更新
            if (data && data[0]) {
              setGame(data[0]);
              emitSignal(`gomoku:${activeGameId}:update`, data[0]);
            }
          } catch (error) {
            console.error('Error resigning:', error);
            Alert.alert('错误', '操作失败');
          }
        },
      },
    ]);
  }, [game, myRole, activeGameId, userId]);

  // ─── 再来一局：写入数据库 + 发送 broadcast（双保险）───
  const handleRequestRematch = useCallback(async () => {
    updateRematchStatus('requested_by_me');
    // 写入数据库 + 通过 IM 信号通知对方（信号回调内 syncRematchFromDB 会处理状态同步）
    try {
      const { data } = await fetchWithTimeout(() =>
        supabase
          .from('gomoku_games')
          .update({ rematch_request_by: userId })
          .eq('id', activeGameId)
          .select()
      );
      if (data && data[0]) emitSignal(`gomoku:${activeGameId}:update`, data[0]);
    } catch (e) {
      console.warn('[rematch] 写入 rematch_request_by 失败:', e.message);
    }
  }, [userId, activeGameId, updateRematchStatus]);

  // ─── 取消重赛邀请 ───
  const handleCancelRematch = useCallback(async () => {
    updateRematchStatus('idle');
    try {
      const { data } = await fetchWithTimeout(() =>
        supabase
          .from('gomoku_games')
          .update({ rematch_request_by: null })
          .eq('id', activeGameId)
          .select()
      );
      if (data && data[0]) emitSignal(`gomoku:${activeGameId}:update`, data[0]);
    } catch (e) {
      console.warn('[rematch] 清除 rematch_request_by 失败:', e.message);
    }
  }, [activeGameId, updateRematchStatus]);

  // ─── 接受重赛：创建新游戏 + 写入 rematch_game_id + broadcast ───
  const handleAcceptRematch = useCallback(async () => {
    if (rematchCreatingRef.current) return;
    rematchCreatingRef.current = true;
    try {
      // 1. 创建新对局（同意方执黑先手，作为先手奖励）
      const { data, error } = await fetchWithTimeout(() =>
        supabase
          .from('gomoku_games')
          .insert([
            {
              creator_id: userId,
              invitee_id: partnerId,
              status: 'playing',
              current_turn: 'creator',
            },
          ])
          .select()
      );
      if (error) throw error;
      if (!data || data.length === 0) throw new Error('No data');
      const newGameId = data[0].id;

      // 2. 在旧对局写入 rematch_game_id + 清除 rematch_request_by（数据干净）
      //    对方通过 IM 信号收到 UPDATE → syncRematchFromDB → 跳转
      const { data: updatedOld } = await fetchWithTimeout(() =>
        supabase
          .from('gomoku_games')
          .update({ rematch_game_id: newGameId, rematch_request_by: null })
          .eq('id', activeGameId)
          .select()
      );
      if (updatedOld && updatedOld[0]) emitSignal(`gomoku:${activeGameId}:update`, updatedOld[0]);

      // 3. 自己跳转（先标记 navigated，防止信号回环触发重复跳转）
      updateRematchStatus('navigated');
      onNavigateGame(newGameId);
    } catch (error) {
      console.error('Error creating rematch game:', error);
      Alert.alert('错误', '创建新对局失败');
      rematchCreatingRef.current = false;
    }
  }, [userId, partnerId, activeGameId, onNavigateGame, updateRematchStatus]);

  // ─── 拒绝重赛 ───
  const handleDeclineRematch = useCallback(async () => {
    updateRematchStatus('idle');
    try {
      const { data } = await fetchWithTimeout(() =>
        supabase
          .from('gomoku_games')
          .update({ rematch_request_by: null })
          .eq('id', activeGameId)
          .select()
      );
      if (data && data[0]) emitSignal(`gomoku:${activeGameId}:update`, data[0]);
    } catch (e) {
      console.warn('[rematch] 清除 rematch_request_by 失败:', e.message);
    }
  }, [activeGameId, updateRematchStatus]);

  // ─── 打开历史 ───
  const openHistory = useCallback(() => {
    setHistoryVisible(true);
    fetchHistory();
  }, [fetchHistory]);

  // ─── 打开调整 ───
  const openAdjust = useCallback(() => {
    setAdjustVisible(true);
    fetchManualWins();
  }, [fetchManualWins]);

  // ─── 大厅态：无对局时显示邀请入口 ───
  if (!activeGameId) {
    return (
      <View style={styles.container}>
        <View style={[styles.header, { paddingTop: Math.max(insets.top, 12) + 4 }]}>
          <IconButton icon="chevron-back" size={24} color={colors.primary[200]} onPress={onBack} accessibilityLabel="返回" />
          <Text style={styles.headerTitle}>⚫⚪ 五子棋</Text>
          <View style={styles.headerActions}>
            <TouchableOpacity style={styles.iconBtn} onPress={openHistory} activeOpacity={0.7}>
              <Text style={styles.iconBtnText}>📜</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.iconBtn} onPress={openAdjust} activeOpacity={0.7}>
              <Text style={styles.iconBtnText}>✏️</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.lobbyWrap}>
          <Text style={styles.lobbyEmoji}>⚫⚪</Text>
          <Text style={styles.lobbyTitle}>五子棋</Text>
          <Text style={styles.lobbyDesc}>15×15 棋盘，黑棋先手，{"\n"}五子连珠即获胜～</Text>

          {/* 计分板预览 */}
          <View style={styles.lobbyScoreboard}>
            <View style={styles.lobbyScoreItem}>
              <Text style={styles.lobbyScoreLabel} numberOfLines={1}>{userId}</Text>
              <Text style={styles.lobbyScoreValue}>{stats.momoWins}</Text>
              <Text style={styles.lobbyScoreUnit}>胜</Text>
            </View>
            <View style={styles.lobbyScoreDivider}>
              <Text style={styles.lobbyScoreTotal}>共 {stats.total} 局</Text>
              <Text style={styles.lobbyScoreDraws}>平 {stats.draws}</Text>
            </View>
            <View style={styles.lobbyScoreItem}>
              <Text style={styles.lobbyScoreLabel} numberOfLines={1}>{partnerId}</Text>
              <Text style={styles.lobbyScoreValue}>{stats.partnerWins}</Text>
              <Text style={styles.lobbyScoreUnit}>胜</Text>
            </View>
          </View>

          <TouchableOpacity
            style={[styles.inviteBtn, inviting && styles.inviteBtnDisabled]}
            onPress={handleSendInvite}
            disabled={inviting}
            activeOpacity={0.8}
          >
            {inviting ? (
              <ActivityIndicator color={colors.neutral[0]} size="small" />
            ) : (
              <Text style={styles.inviteBtnText}>✉️ 邀请 {partnerId} 来下棋</Text>
            )}
          </TouchableOpacity>
        </View>

        {renderHistoryModal()}
        {renderAdjustModal()}
      </View>
    );
  }

  if (loading || !game) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primaryAction} />
        <Text style={styles.loadingText}>加载对局中...</Text>
      </View>
    );
  }

  const isWaiting = game.status === 'waiting';
  const isPlaying = game.status === 'playing';
  const isFinished = game.status === 'finished';
  const isMyTurn = isPlaying && game.current_turn === myRole;
  const myStoneLabel = myRole === 'creator' ? '⚫ 黑棋' : '⚪ 白棋';

  let resultText = '';
  if (isFinished) {
    if (game.winner === 'draw') {
      resultText = '🤝 平局！';
    } else {
      const winnerId = game.winner === 'creator' ? game.creator_id : game.invitee_id;
      const iWon = winnerId === userId;
      const resigned = !!game.resigned_by;
      if (resigned) {
        // 认输结束
        resultText = iWon ? '🎉 对方认输，你赢了！' : '🏳️ 你已认输';
      } else {
        resultText = iWon ? '🎉 你赢了！' : `${winnerId} 获胜`;
      }
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* 弹幕层 */}
      <DanmakuLayer
        danmakuList={danmakuList}
        screenWidth={SCREEN_WIDTH}
        onDanmakuEnd={handleDanmakuEnd}
      />

      {/* Header */}
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 12) + 4 }]}>
        <IconButton icon="chevron-back" size={24} color={colors.primary[200]} onPress={onBack} accessibilityLabel="返回" />
        <Text style={styles.headerTitle}>⚫⚪ 五子棋</Text>
        <View style={styles.headerActions}>
          <TouchableOpacity style={styles.iconBtn} onPress={openHistory} activeOpacity={0.7}>
            <Text style={styles.iconBtnText}>📜</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.iconBtn} onPress={openAdjust} activeOpacity={0.7}>
            <Text style={styles.iconBtnText}>✏️</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* 计分板 */}
      <View style={styles.scoreboard}>
        <View style={styles.scoreItem}>
          <Text style={styles.scoreLabel} numberOfLines={1}>{userId}</Text>
          <Text style={styles.scoreValue}>{stats.momoWins}</Text>
          <Text style={styles.scoreUnit}>胜</Text>
        </View>
        <View style={styles.scoreDivider}>
          <Text style={styles.scoreTotal}>共 {stats.total} 局</Text>
          <Text style={styles.scoreDraws}>平 {stats.draws}</Text>
        </View>
        <View style={styles.scoreItem}>
          <Text style={styles.scoreLabel} numberOfLines={1}>{partnerId}</Text>
          <Text style={styles.scoreValue}>{stats.partnerWins}</Text>
          <Text style={styles.scoreUnit}>胜</Text>
        </View>
      </View>

      {/* 状态提示 + 计时器 */}
      <View style={styles.statusBar}>
        {isWaiting && (
          <Text style={styles.statusText}>⏳ 等待 {partnerId} 加入对局...</Text>
        )}
        {isPlaying && (
          <View style={styles.statusRow}>
            <Text style={[styles.statusText, isMyTurn && styles.statusTextActive]}>
              {isMyTurn ? `轮到你 ${myStoneLabel}` : `等待对方落子...`}
            </Text>
            <Text style={styles.timerText}>⏱ {formatDuration(elapsedSec)}</Text>
          </View>
        )}
        {isFinished && (
          <View style={styles.statusRow}>
            <Text style={styles.resultText}>{resultText}</Text>
            {game.finished_at && game.created_at && (
              <Text style={styles.timerText}>
                用时 {formatDuration(Math.max(0, Math.floor((new Date(game.finished_at).getTime() - new Date(game.created_at).getTime()) / 1000)))}
              </Text>
            )}
          </View>
        )}
      </View>

      {/* 棋盘 */}
      <View style={styles.boardWrap}>
        <View style={styles.board}>
          {/* 网格线背景：14x14 个格子 */}
          <View style={styles.gridBg}>
            {Array.from({ length: BOARD_SIZE - 1 }).map((_, y) => (
              <View key={y} style={styles.gridRow}>
                {Array.from({ length: BOARD_SIZE - 1 }).map((_, x) => (
                  <View key={x} style={styles.gridCell} />
                ))}
              </View>
            ))}
          </View>

          {/* 交叉点：15x15，棋子落在交叉点上 */}
          {board.map((row, y) =>
            row.map((cell, x) => {
              const isLast = lastMove && lastMove.x === x && lastMove.y === y;
              const isWinCell = winLine && winLine.some((c) => c.x === x && c.y === y);
              const canPlace = isPlaying && isMyTurn && cell === STONE.EMPTY && !placing;
              return (
                <TouchableOpacity
                  key={`${x}-${y}`}
                  style={[
                    styles.intersection,
                    { left: x * CELL, top: y * CELL, width: CELL, height: CELL },
                  ]}
                  activeOpacity={canPlace ? 0.5 : 1}
                  disabled={!canPlace}
                  onPressIn={() => handlePlaceStone(x, y)}
                >
                  {cell === STONE.BLACK && (
                    <View
                      style={[
                        styles.stone,
                        styles.stoneBlack,
                        isLast && styles.stoneLast,
                        isWinCell && styles.stoneWin,
                      ]}
                    />
                  )}
                  {cell === STONE.WHITE && (
                    <View
                      style={[
                        styles.stone,
                        styles.stoneWhite,
                        isLast && styles.stoneLast,
                        isWinCell && styles.stoneWin,
                      ]}
                    />
                  )}
                </TouchableOpacity>
              );
            })
          )}
        </View>
      </View>

      {/* 弹幕输入 + 操作按钮 */}
      <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, keyboardHeight) + 8 }]}>
        {/* 弹幕输入 */}
        <View style={styles.danmakuInputRow}>
          <TextInput
            style={styles.danmakuInput}
            value={danmakuInput}
            onChangeText={setDanmakuInput}
            placeholder="发个弹幕..."
            placeholderTextColor={colors.textMuted}
            maxLength={30}
            returnKeyType="send"
            onSubmitEditing={sendDanmaku}
          />
          <TouchableOpacity style={styles.danmakuSendBtn} onPress={sendDanmaku} activeOpacity={0.7}>
            <Text style={styles.danmakuSendText}>发送</Text>
          </TouchableOpacity>
        </View>

        {/* 操作按钮 — 键盘弹起时隐藏，避免夹在输入框和键盘之间 */}
        {!keyboardHeight && (
        <View style={styles.actionRow}>
          {isPlaying && (
            <TouchableOpacity style={styles.resignBtn} onPress={handleResign} activeOpacity={0.7}>
              <Text style={styles.resignBtnText}>🏳️ 认输</Text>
            </TouchableOpacity>
          )}
          {isFinished && rematchStatus === 'idle' && (
            <TouchableOpacity style={styles.restartBtn} onPress={handleRequestRematch} activeOpacity={0.7}>
              <Text style={styles.restartBtnText}>🔄 再来一局</Text>
            </TouchableOpacity>
          )}
          {isFinished && rematchStatus === 'requested_by_me' && (
            <View style={styles.rematchWaitingBox}>
              <Text style={styles.rematchWaitingText}>⏳ 等待 {partnerId} 同意...</Text>
              <TouchableOpacity style={styles.rematchCancelBtn} onPress={handleCancelRematch} activeOpacity={0.7}>
                <Text style={styles.rematchCancelText}>取消</Text>
              </TouchableOpacity>
            </View>
          )}
          {isFinished && rematchStatus === 'requested_by_opponent' && (
            <View style={styles.rematchAskBox}>
              <Text style={styles.rematchAskText}>🎯 {partnerId} 想再来一局</Text>
              <View style={styles.rematchBtnRow}>
                <TouchableOpacity style={styles.rematchAcceptBtn} onPress={handleAcceptRematch} activeOpacity={0.7}>
                  <Text style={styles.rematchAcceptText}>✓ 同意</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.rematchDeclineBtn} onPress={handleDeclineRematch} activeOpacity={0.7}>
                  <Text style={styles.rematchDeclineText}>✕ 拒绝</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
          {isWaiting && (
            <Text style={styles.waitHint}>邀请已发送，对方加入后即可开始</Text>
          )}
        </View>
        )}
      </View>

      {renderHistoryModal()}
      {renderAdjustModal()}
    </KeyboardAvoidingView>
  );

  // ─── 历史战绩 Modal ───
  function renderHistoryModal() {
    return (
      <Modal visible={historyVisible} animationType="slide" transparent={false}>
        <View style={[styles.modalContainer, { paddingTop: insets.top }]}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>📜 历史战绩</Text>
            <TouchableOpacity onPress={() => setHistoryVisible(false)}>
              <Text style={styles.modalClose}>✕</Text>
            </TouchableOpacity>
          </View>
          {historyLoading ? (
            <ActivityIndicator size="large" color={colors.primaryAction} style={{ marginTop: 40 }} />
          ) : history.length === 0 ? (
            <View style={styles.emptyWrap}>
              <Text style={styles.emptyText}>还没有对战记录</Text>
            </View>
          ) : (
            <FlatList
              data={history}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => {
                const winnerId =
                  item.winner === 'creator' ? item.creator_id :
                  item.winner === 'invitee' ? item.invitee_id : null;
                let resultLabel = '';
                let resultColor = colors.textSecondary;
                if (item.winner === 'draw') {
                  resultLabel = '平局';
                  resultColor = colors.textSecondary;
                } else if (winnerId === userId) {
                  resultLabel = '胜';
                  resultColor = colors.success;
                } else {
                  resultLabel = '负';
                  resultColor = colors.error;
                }
                const date = item.finished_at
                  ? new Date(item.finished_at).toLocaleString('zh-CN', {
                      month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
                    })
                  : '未知';
                const duration = item.finished_at && item.created_at
                  ? Math.max(0, Math.floor((new Date(item.finished_at).getTime() - new Date(item.created_at).getTime()) / 1000))
                  : 0;
                return (
                  <View style={styles.historyItem}>
                    <View style={styles.historyLeft}>
                      <Text style={[styles.historyResult, { color: resultColor }]}>{resultLabel}</Text>
                      <View>
                        <Text style={styles.historyDate}>{date}</Text>
                        {duration > 0 && (
                          <Text style={styles.historyDuration}>⏱ {formatDuration(duration)}</Text>
                        )}
                      </View>
                    </View>
                    <View style={styles.historyRight}>
                      <Text style={styles.historyPlayers} numberOfLines={1}>
                        {item.creator_id} vs {item.invitee_id}
                      </Text>
                      <TouchableOpacity
                        style={styles.historyDeleteBtn}
                        onPress={() => handleDeleteHistory(item.id)}
                      >
                        <Text style={styles.historyDeleteText}>删除</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              }}
              ItemSeparatorComponent={() => <View style={styles.historySep} />}
            />
          )}
        </View>
      </Modal>
    );
  }

  // ─── 手动调整 Modal ───
  function renderAdjustModal() {
    return (
      <Modal visible={adjustVisible} animationType="slide" transparent={false}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={[styles.modalContainer, { paddingTop: insets.top }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>✏️ 调整战绩</Text>
              <TouchableOpacity onPress={() => setAdjustVisible(false)}>
                <Text style={styles.modalClose}>✕</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.adjustBody}>
              <Text style={styles.adjustHint}>
                直接修改为想要的正确数字{'\n'}系统会自动计算并保存校准值
              </Text>

              <View style={styles.adjustRow}>
                <Text style={styles.adjustLabel}>{userId} 胜场：</Text>
                <TextInput
                  style={styles.adjustInput}
                  value={myManualWins}
                  onChangeText={setMyManualWins}
                  keyboardType="numeric"
                  placeholder="0"
                />
              </View>

              <View style={styles.adjustRow}>
                <Text style={styles.adjustLabel}>{partnerId} 胜场：</Text>
                <TextInput
                  style={styles.adjustInput}
                  value={partnerManualWins}
                  onChangeText={setPartnerManualWins}
                  keyboardType="numeric"
                  placeholder="0"
                />
              </View>

              <View style={styles.adjustRow}>
                <Text style={styles.adjustLabel}>平局数：</Text>
                <TextInput
                  style={styles.adjustInput}
                  value={manualDraws}
                  onChangeText={setManualDraws}
                  keyboardType="numeric"
                  placeholder="0"
                />
              </View>

              <TouchableOpacity
                style={[styles.adjustSaveBtn, adjustSaving && { opacity: 0.6 }]}
                onPress={handleSaveAdjust}
                disabled={adjustSaving}
                activeOpacity={0.7}
              >
                <Text style={styles.adjustSaveText}>
                  {adjustSaving ? '保存中...' : '💾 保存'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    );
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
  },
  loadingText: {
    marginTop: 8,
    color: colors.textMuted,
    fontSize: 15,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 8,
    backgroundColor: colors.primary[900],
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20,
  },
  headerTitle: {
    color: colors.primary[200],
    fontSize: 18,
    fontWeight: 'bold',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconBtn: {
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  iconBtnText: {
    fontSize: 18,
  },

  // 大厅
  lobbyWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 30,
  },
  lobbyEmoji: {
    fontSize: 64,
    marginBottom: 12,
  },
  lobbyTitle: {
    fontSize: 26,
    fontWeight: 'bold',
    color: colors.textPrimary,
    marginBottom: 8,
  },
  lobbyDesc: {
    fontSize: 15,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24,
  },
  lobbyScoreboard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    width: '100%',
    paddingVertical: 14,
    paddingHorizontal: 16,
    backgroundColor: colors.surface,
    borderRadius: 16,
    marginBottom: 32,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 2,
  },
  lobbyScoreItem: {
    alignItems: 'center',
    flex: 1,
  },
  lobbyScoreLabel: {
    fontSize: 13,
    color: colors.textSecondary,
    marginBottom: 4,
  },
  lobbyScoreValue: {
    fontSize: 28,
    fontWeight: 'bold',
    color: colors.textPrimary,
  },
  lobbyScoreUnit: {
    fontSize: 12,
    color: colors.textMuted,
  },
  lobbyScoreDivider: {
    alignItems: 'center',
    flex: 1,
  },
  lobbyScoreTotal: {
    fontSize: 13,
    color: colors.primary[700],
    fontWeight: '600',
    marginBottom: 2,
  },
  lobbyScoreDraws: {
    fontSize: 12,
    color: colors.textMuted,
  },
  inviteBtn: {
    backgroundColor: colors.primaryAction,
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 32,
    alignItems: 'center',
    shadowColor: colors.primaryAction,
    shadowOpacity: 0.3,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 8,
    elevation: 4,
  },
  inviteBtnDisabled: {
    opacity: 0.7,
  },
  inviteBtnText: {
    color: colors.neutral[0],
    fontSize: 17,
    fontWeight: '700',
  },

  // 计分板
  scoreboard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: colors.surface,
    marginHorizontal: 12,
    marginTop: 12,
    borderRadius: 16,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 2,
  },
  scoreItem: {
    alignItems: 'center',
    flex: 1,
  },
  scoreLabel: {
    fontSize: 13,
    color: colors.textSecondary,
    fontWeight: '600',
    marginBottom: 4,
    maxWidth: 100,
  },
  scoreValue: {
    fontSize: 32,
    fontWeight: 'bold',
    color: colors.primaryAction,
  },
  scoreUnit: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  scoreDivider: {
    alignItems: 'center',
    paddingHorizontal: 12,
  },
  scoreTotal: {
    fontSize: 13,
    color: colors.textSecondary,
    fontWeight: '600',
    marginBottom: 4,
  },
  scoreDraws: {
    fontSize: 12,
    color: colors.textMuted,
  },

  // 状态
  statusBar: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  statusText: {
    fontSize: 15,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  statusTextActive: {
    color: colors.primaryAction,
    fontSize: 16,
  },
  resultText: {
    fontSize: 20,
    fontWeight: 'bold',
    color: colors.primaryAction,
  },
  timerText: {
    fontSize: 13,
    color: colors.textMuted,
    fontWeight: '500',
    fontVariant: ['tabular-nums'],
  },

  // 棋盘
  boardWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
  },
  board: {
    width: BOARD_PIXEL,
    height: BOARD_PIXEL,
    backgroundColor: '#E8D5B7',
    borderColor: '#8B6F47',
    borderWidth: 1.5,
    position: 'relative',
    overflow: 'hidden',
  },
  // 网格线背景：14x14 个格子，居中放置
  gridBg: {
    position: 'absolute',
    left: CELL / 2,
    top: CELL / 2,
    width: CELL * (BOARD_SIZE - 1),
    height: CELL * (BOARD_SIZE - 1),
  },
  gridRow: {
    flexDirection: 'row',
    height: CELL,
  },
  gridCell: {
    width: CELL,
    height: CELL,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: 'rgba(60, 40, 20, 0.85)',
  },
  // 交叉点：可点击区域，棋子居中
  intersection: {
    position: 'absolute',
    justifyContent: 'center',
    alignItems: 'center',
  },
  stone: {
    width: STONE_SIZE,
    height: STONE_SIZE,
    borderRadius: STONE_SIZE / 2,
  },
  stoneBlack: {
    backgroundColor: '#1A1A1A',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.4,
    shadowRadius: 1.5,
    elevation: 2,
  },
  stoneWhite: {
    backgroundColor: '#FFFFFF',
    borderColor: '#B0B0B0',
    borderWidth: 0.5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.25,
    shadowRadius: 1.5,
    elevation: 2,
  },
  stoneLast: {
    borderColor: '#E74C3C',
    borderWidth: 2,
  },
  stoneWin: {
    borderColor: '#F39C12',
    borderWidth: 2.5,
    shadowColor: '#F39C12',
    shadowOpacity: 0.6,
    shadowRadius: 4,
    elevation: 4,
  },

  // 底部栏（弹幕 + 操作）
  bottomBar: {
    paddingHorizontal: 16,
    paddingTop: 4,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  danmakuInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  danmakuInput: {
    flex: 1,
    backgroundColor: colors.primary[50],
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 8,
    fontSize: 14,
    color: colors.textPrimary,
    marginRight: 8,
  },
  danmakuSendBtn: {
    backgroundColor: colors.primaryAction,
    borderRadius: 18,
    paddingHorizontal: 18,
    paddingVertical: 8,
  },
  danmakuSendText: {
    color: colors.neutral[0],
    fontSize: 14,
    fontWeight: '600',
  },
  actionRow: {
    alignItems: 'center',
    paddingVertical: 4,
  },
  resignBtn: {
    backgroundColor: colors.errorSoft,
    borderColor: colors.coral[400],
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 32,
  },
  resignBtnText: {
    color: colors.error,
    fontSize: 15,
    fontWeight: '700',
  },
  restartBtn: {
    backgroundColor: colors.primaryAction,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 40,
    shadowColor: colors.primaryAction,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 3,
  },
  restartBtnText: {
    color: colors.neutral[0],
    fontSize: 16,
    fontWeight: 'bold',
  },
  waitHint: {
    fontSize: 13,
    color: colors.textMuted,
  },

  // 再来一局状态
  rematchWaitingBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primary[50],
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 20,
    gap: 12,
  },
  rematchWaitingText: {
    fontSize: 14,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  rematchCancelBtn: {
    backgroundColor: colors.neutral[0],
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: colors.primary[300],
  },
  rematchCancelText: {
    color: colors.primaryAction,
    fontSize: 13,
    fontWeight: '600',
  },
  rematchAskBox: {
    alignItems: 'center',
    backgroundColor: colors.primary[50],
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 20,
    gap: 10,
  },
  rematchAskText: {
    fontSize: 14,
    color: colors.primaryAction,
    fontWeight: '600',
  },
  rematchBtnRow: {
    flexDirection: 'row',
    gap: 12,
  },
  rematchAcceptBtn: {
    backgroundColor: colors.success,
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 22,
  },
  rematchAcceptText: {
    color: colors.neutral[0],
    fontSize: 14,
    fontWeight: 'bold',
  },
  rematchDeclineBtn: {
    backgroundColor: colors.neutral[0],
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 22,
    borderWidth: 1,
    borderColor: colors.coral[400],
  },
  rematchDeclineText: {
    color: colors.error,
    fontSize: 14,
    fontWeight: '600',
  },

  // Modal 通用
  modalContainer: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: colors.primary[900],
  },
  modalTitle: {
    color: colors.primary[200],
    fontSize: 18,
    fontWeight: 'bold',
  },
  modalClose: {
    color: colors.primary[300],
    fontSize: 20,
    paddingHorizontal: 8,
  },

  // 历史
  emptyWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 15,
    color: colors.textMuted,
  },
  historyItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: colors.surface,
  },
  historyLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  historyResult: {
    fontSize: 18,
    fontWeight: 'bold',
    marginRight: 12,
    minWidth: 28,
  },
  historyDate: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  historyDuration: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 2,
    fontVariant: ['tabular-nums'],
  },
  historyRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  historyPlayers: {
    fontSize: 12,
    color: colors.textMuted,
    marginRight: 8,
    maxWidth: 120,
  },
  historyDeleteBtn: {
    backgroundColor: colors.errorSoft,
    borderColor: colors.coral[400],
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  historyDeleteText: {
    color: colors.error,
    fontSize: 12,
    fontWeight: '600',
  },
  historySep: {
    height: 1,
    backgroundColor: colors.border,
    marginHorizontal: 16,
  },

  // 调整
  adjustBody: {
    padding: 20,
  },
  adjustHint: {
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 20,
    marginBottom: 24,
    textAlign: 'center',
  },
  adjustRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  adjustLabel: {
    fontSize: 15,
    color: colors.textPrimary,
    fontWeight: '600',
    flex: 1,
  },
  adjustInput: {
    width: 80,
    backgroundColor: colors.primary[50],
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 16,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  adjustSaveBtn: {
    backgroundColor: colors.primaryAction,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 16,
  },
  adjustSaveText: {
    color: colors.neutral[0],
    fontSize: 16,
    fontWeight: 'bold',
  },
});
