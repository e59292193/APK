// ══════════════════════════════════════════════════════════
// useDrawGuessSession —— 你画我猜 对局核心逻辑
//
// 把原来堆在 DrawGuessGameScreen 里的 1700 行状态机搬到这里，并修掉：
//
// 【同步类】
//  1. IM + DB 双通道重复投递 → 所有信号带 uid 全局去重（撤销/清空不再双执行）
//  2. stroke_pts 早于 stroke_begin 到达被丢弃 → 乱序缓冲后按序重组
//  3. stroke_end 丢包导致整笔消失 → 下一笔 begin 时自动给上一笔收尾
//  4. 绝对像素坐标在不同机型偏移 → 统一相对坐标（0~1）传输
//  5. 中途进入看不到已画内容 → sync_request / snapshot 整幅补齐
//  6. 自己的信号被自己处理 → sender_id + from 双重过滤
//  7. 首次进入会重放整局历史笔画 → 首轮拉取只对齐游标（prime）
//
// 【逻辑类】
//  8. 双方同时结算导致轮次跳 2 轮、round_results 重复 → 全部走条件更新
//  9. 倒计时双端不一致、提示加时对方看不到 → 统一以 DB deadline_at 为准
// 10. 画题人掉线本轮永远卡住 → 猜题人在宽限期后接手结算
// 11. 轮询旧数据覆盖新状态 → applyRow 带状态戳，旧状态直接丢弃
// 12. 轮次切换后画布残留上一轮笔画 → applyRow 统一 resetBoard
//
// 【性能类】
// 13. 每个点一次 DB insert → 出站信号 220ms 批量合并，抬手立即 flush
// 14. 固定 1.2s / 2s 轮询 → 按状态自适应，切到后台完全停轮询
// 15. 手指每动一下都 setState 全量重绘 → 点抽稀 + 实时笔独立图层
// ══════════════════════════════════════════════════════════
import { useEffect, useMemo, useRef, useState } from 'react';
import { AppState, PanResponder } from 'react-native';
import { emitSignal, onSignal } from '../lib/realtimeSignal';
import { pollSignals, pushSignal, pushSignals } from '../lib/drawGuessSignalQueue';
import { isCorrectGuess } from '../lib/drawGuessUtils';
import { saveDrawingToGallery } from '../lib/drawGuessAssets';
import * as sync from '../lib/drawGuessSync';
import * as room from '../lib/drawGuessRoom';

export const COLORS = [
  [33, 33, 33],
  [231, 76, 60],
  [52, 152, 219],
  [46, 204, 113],
  [230, 126, 34],
  [155, 89, 182],
];
export const SIZES = [3, 6, 11];
export const ERASER_WIDTH = 20;

const STATUS_RANK = { waiting: 0, picking: 1, drawing: 2, finished: 3 };
const GAME_POLL_ACTIVE = 2500;
const GAME_POLL_IDLE = 6000;
const SIGNAL_POLL_DRAWING = 900;
const SIGNAL_POLL_IDLE = 2400;
const OUTBOX_FLUSH_MS = 220;
const PTS_FLUSH_MS = 80;
const MAX_STROKE_POINTS = 900;
const FEED_TTL = 4200;
const PRIME_PAGE = 200;

function roleOf(row, userId) {
  return row && row.creator_id === userId ? 'creator' : 'invitee';
}

export function isDrawerOf(row, userId) {
  return !!row && row.current_drawer === roleOf(row, userId);
}

function stateStamp(row) {
  if (!row) return -1;
  const rank = STATUS_RANK[row.status] != null ? STATUS_RANK[row.status] : 0;
  return (row.round || 0) * 10 + rank;
}

function clamp(v, min, max) {
  if (v < min) return min;
  if (v > max) return max;
  return v;
}

function wordsOf(list) {
  return (list || []).map((w) => (typeof w === 'string' ? w : w && w.word)).filter(Boolean);
}

export function useDrawGuessSession({ gameId, userId, partnerId, size }) {
  const [activeId, setActiveId] = useState(gameId || null);
  const [game, setGame] = useState(null);
  const [loading, setLoading] = useState(!!gameId);
  const [errorText, setErrorText] = useState('');
  const [strokes, setStrokes] = useState([]);
  const [liveStroke, setLiveStroke] = useState(null);
  const [remoteStroke, setRemoteStroke] = useState(null);
  const [remainSec, setRemainSec] = useState(room.DRAW_SECONDS);
  const [feed, setFeed] = useState([]);
  const [toast, setToast] = useState(null);
  const [tool, setTool] = useState({ color: COLORS[0], width: SIZES[1], isEraser: false });
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [customWords, setCustomWords] = useState([]);
  const [choiceOverride, setChoiceOverride] = useState(null);
  const [pendingRematchId, setPendingRematchId] = useState(null);
  const [partnerSavedRound, setPartnerSavedRound] = useState(null);

  const mountedRef = useRef(true);
  const gameRef = useRef(null);
  const activeIdRef = useRef(gameId || null);
  const strokesRef = useRef([]);
  const liveRef = useRef(null);
  const toolRef = useRef(tool);
  const customWordsRef = useRef([]);
  const canDrawRef = useRef(false);
  const dedupeRef = useRef(null);
  const assemblerRef = useRef(null);
  const lastSignalIdRef = useRef(0);
  const primeRef = useRef(true);
  const outboxRef = useRef([]);
  const outboxTimerRef = useRef(null);
  const ptsRef = useRef({ si: null, flat: [] });
  const ptsTimerRef = useRef(null);
  const strokeIdRef = useRef(null);
  const lastPointRef = useRef(null);
  const finishingRef = useRef(false);
  const syncRoundRef = useRef(0);
  const snapshotRef = useRef(null);
  const feedIdRef = useRef(0);
  const appActiveRef = useRef(true);
  const toastTimerRef = useRef(null);
  const apiRef = useRef({});

  toolRef.current = tool;
  customWordsRef.current = customWords;

  if (!dedupeRef.current) dedupeRef.current = sync.createDedupe(1500);

  if (!assemblerRef.current) {
    assemblerRef.current = sync.createStrokeAssembler({
      width: size,
      height: size,
      onLive: (s) => {
        if (mountedRef.current) setRemoteStroke(s);
      },
      onComplete: (s) => {
        if (!mountedRef.current) return;
        const next = strokesRef.current.concat([s]);
        strokesRef.current = next;
        setStrokes(next);
      },
    });
  }

  // ─────────────── 小工具 ───────────────
  function showToast(text, kind) {
    if (!mountedRef.current) return;
    setToast({ text, kind: kind || 'info' });
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => {
      if (mountedRef.current) setToast(null);
    }, 2600);
  }

  function pushFeed(item) {
    if (!mountedRef.current) return;
    feedIdRef.current += 1;
    const entry = Object.assign({ id: feedIdRef.current }, item);
    setFeed((prev) => prev.slice(-5).concat([entry]));
    setTimeout(() => {
      if (mountedRef.current) setFeed((prev) => prev.filter((f) => f.id !== entry.id));
    }, FEED_TTL);
  }

  function setStrokeList(next) {
    strokesRef.current = next;
    if (mountedRef.current) setStrokes(next);
  }

  function resetBoard() {
    setStrokeList([]);
    liveRef.current = null;
    strokeIdRef.current = null;
    lastPointRef.current = null;
    ptsRef.current = { si: null, flat: [] };
    if (mountedRef.current) setLiveStroke(null);
    if (assemblerRef.current) assemblerRef.current.reset();
  }

  // ─────────────── 状态应用（唯一入口） ───────────────
  function applyRow(row, opts) {
    if (!row || !mountedRef.current) return;
    const prev = gameRef.current;
    const force = !!(opts && opts.force);

    // 过期数据保护：轮询/信号乱序时，旧状态不许覆盖新状态
    if (prev && prev.id === row.id && !force && stateStamp(row) < stateStamp(prev)) return;

    const roundChanged = !prev || prev.id !== row.id || prev.round !== row.round;
    const leftDrawing = !!prev && prev.status === 'drawing' && row.status !== 'drawing';

    // 轮结束时先把画留个快照，方便结算后再补存到画廊
    if (prev && (roundChanged || leftDrawing) && strokesRef.current.length > 0) {
      snapshotRef.current = {
        gameId: prev.id,
        round: prev.round,
        word: prev.word,
        strokes: strokesRef.current,
        drawerId: prev.current_drawer === 'creator' ? prev.creator_id : prev.invitee_id,
        guesserId: prev.current_drawer === 'creator' ? prev.invitee_id : prev.creator_id,
      };
    }

    if (roundChanged || (prev && prev.status !== 'drawing' && row.status === 'drawing')) {
      resetBoard();
      setPartnerSavedRound(null);
      setChoiceOverride(null);
    }

    // 本轮结果提示
    if (prev && prev.status === 'drawing' && row.status !== 'drawing') {
      const results = Array.isArray(row.round_results) ? row.round_results : [];
      const hit = results.find((r) => r && r.round === prev.round);
      const word = (hit && hit.word) || prev.word || '';
      if (hit && hit.winner === 'win') showToast('猜中了！答案是「' + word + '」', 'win');
      else if (hit && hit.winner === 'gaveup') showToast('本轮答案是「' + word + '」', 'info');
      else if (hit) showToast('时间到，答案是「' + word + '」', 'warn');
    }

    gameRef.current = row;
    setGame(row);
    canDrawRef.current = row.status === 'drawing' && isDrawerOf(row, userId);

    if (row.rematch_game_id && row.rematch_request_by && row.rematch_request_by !== userId) {
      setPendingRematchId(row.rematch_game_id);
    }
  }

  // ─────────────── 信号收发 ───────────────
  function sendSignal(type, data, opts) {
    const gid = activeIdRef.current;
    if (!gid) return null;
    const o = opts || {};
    const payload = Object.assign({ type, uid: sync.makeUid(userId), from: userId }, data || {});
    if (!o.dbOnly) emitSignal('dg:' + gid, payload);
    if (o.batch) {
      outboxRef.current.push({ type, data: payload });
      if (!outboxTimerRef.current) {
        outboxTimerRef.current = setTimeout(() => apiRef.current.flushOutbox(), OUTBOX_FLUSH_MS);
      }
    } else {
      pushSignal(gid, type, payload, userId);
    }
    return payload.uid;
  }

  function flushOutbox() {
    if (outboxTimerRef.current) {
      clearTimeout(outboxTimerRef.current);
      outboxTimerRef.current = null;
    }
    const gid = activeIdRef.current;
    const items = outboxRef.current;
    if (!gid || items.length === 0) return;
    outboxRef.current = [];
    pushSignals(gid, items, userId);
  }

  function broadcastRow(row) {
    if (row) sendSignal('update', { row });
  }

  function replySnapshot(round) {
    const g = gameRef.current;
    if (!g || g.status !== 'drawing') return;
    if (!isDrawerOf(g, userId)) return;
    if (round && round !== g.round) return;
    sendSignal(
      'snapshot',
      { round: g.round, s: sync.encodeStrokes(strokesRef.current, size, size) },
      { dbOnly: true }
    );
  }

  function handleSignal(sig) {
    if (!sig || !sig.type) return;
    if (sig.from && sig.from === userId) return;
    if (!dedupeRef.current.accept(sig.uid)) return;
    const asm = assemblerRef.current;

    switch (sig.type) {
      case 'stroke_begin':
        asm.begin(sig.si, { c: sig.c, w: sig.w, e: sig.e, p: sig.p });
        break;
      case 'stroke_pts':
        asm.points(sig.si, sig.p);
        break;
      case 'stroke_end':
        asm.end(sig.si);
        break;
      case 'undo':
        setStrokeList(strokesRef.current.slice(0, -1));
        break;
      case 'clear':
        resetBoard();
        break;
      case 'danmaku':
        pushFeed({ text: sig.text, from: sig.from, kind: 'chat' });
        break;
      case 'guess':
        pushFeed({ text: sig.text, from: sig.from, kind: sig.correct ? 'win' : 'guess' });
        break;
      case 'update':
        if (sig.row) applyRow(sig.row);
        break;
      case 'sync_request':
        replySnapshot(sig.round);
        break;
      case 'snapshot': {
        const g = gameRef.current;
        if (!g || isDrawerOf(g, userId)) break;
        if (sig.round && sig.round !== g.round) break;
        const decoded = sync.decodeStrokes(sig.s, size, size);
        if (decoded.length >= strokesRef.current.length) setStrokeList(decoded);
        break;
      }
      case 'save':
        setPartnerSavedRound(sig.round || null);
        showToast('对方把这幅画存进画廊了', 'info');
        break;
      case 'rematch':
        if (sig.game_id) {
          setPendingRematchId(sig.game_id);
          showToast('对方想再来一局', 'info');
        }
        break;
      default:
        break;
    }
  }

  // ─────────────── 画笔 ───────────────
  function beginStroke(ne) {
    if (!canDrawRef.current) return;
    const t = toolRef.current;
    const x = clamp(ne.locationX, 0, size);
    const y = clamp(ne.locationY, 0, size);
    const sid = sync.makeStrokeId(userId);
    const stroke = {
      points: [{ x, y }],
      color: t.color,
      width: t.isEraser ? ERASER_WIDTH : t.width,
      isEraser: t.isEraser,
    };
    strokeIdRef.current = sid;
    lastPointRef.current = { x, y };
    liveRef.current = stroke;
    setLiveStroke(stroke);
    ptsRef.current = { si: sid, flat: [] };
    sendSignal(
      'stroke_begin',
      {
        si: sid,
        c: stroke.color,
        w: stroke.width,
        e: stroke.isEraser ? 1 : 0,
        p: sync.encodePoints(stroke.points, size, size),
      },
      { batch: true }
    );
  }

  function moveStroke(ne) {
    const stroke = liveRef.current;
    if (!stroke || !canDrawRef.current) return;
    const x = clamp(ne.locationX, 0, size);
    const y = clamp(ne.locationY, 0, size);
    if (!sync.shouldAppendPoint(lastPointRef.current, x, y, 2)) return;
    if (stroke.points.length >= MAX_STROKE_POINTS) return;
    lastPointRef.current = { x, y };
    const next = Object.assign({}, stroke, { points: stroke.points.concat([{ x, y }]) });
    liveRef.current = next;
    setLiveStroke(next);
    ptsRef.current.flat.push(sync.toRel(x, size), sync.toRel(y, size));
    if (!ptsTimerRef.current) {
      ptsTimerRef.current = setTimeout(() => apiRef.current.flushPts(), PTS_FLUSH_MS);
    }
  }

  function flushPts() {
    if (ptsTimerRef.current) {
      clearTimeout(ptsTimerRef.current);
      ptsTimerRef.current = null;
    }
    const buf = ptsRef.current;
    if (!buf || !buf.si || buf.flat.length === 0) return;
    const flat = buf.flat;
    buf.flat = [];
    const chunks = sync.chunkFlatPoints(flat, 120);
    for (let i = 0; i < chunks.length; i++) {
      sendSignal('stroke_pts', { si: buf.si, p: chunks[i] }, { batch: true });
    }
  }

  function endStroke() {
    const stroke = liveRef.current;
    const sid = strokeIdRef.current;
    flushPts();
    liveRef.current = null;
    strokeIdRef.current = null;
    lastPointRef.current = null;
    setLiveStroke(null);
    if (stroke && stroke.points.length > 0) {
      setStrokeList(strokesRef.current.concat([sync.withPath(stroke)]));
    }
    if (sid) sendSignal('stroke_end', { si: sid }, { batch: true });
    flushOutbox();
  }

  function undo() {
    const g = gameRef.current;
    if (!g || !canDrawRef.current || strokesRef.current.length === 0) return;
    setStrokeList(strokesRef.current.slice(0, -1));
    sendSignal('undo', {});
  }

  function clearBoard() {
    const g = gameRef.current;
    if (!g || !canDrawRef.current) return;
    resetBoard();
    sendSignal('clear', {});
  }

  // ─────────────── 对局动作 ───────────────
  function enterGame(id, row) {
    if (!id) return;
    setPendingRematchId(null);
    lastSignalIdRef.current = 0;
    primeRef.current = true;
    dedupeRef.current.clear();
    snapshotRef.current = null;
    syncRoundRef.current = 0;
    activeIdRef.current = id;
    gameRef.current = null;
    resetBoard();
    setActiveId(id);
    if (row) applyRow(row, { force: true });
    else {
      setGame(null);
      setLoading(true);
    }
  }

  async function createInvite() {
    setBusy(true);
    try {
      const row = await room.createGame(userId, partnerId, wordsOf(customWordsRef.current));
      enterGame(row.id, row);
      broadcastRow(row);
      setErrorText('');
    } catch (e) {
      setErrorText(e.message || '创建对局失败，请检查网络');
    } finally {
      setBusy(false);
    }
  }

  async function cancelInvite() {
    const g = gameRef.current;
    if (!g || g.status !== 'waiting' || g.creator_id !== userId) return;
    setBusy(true);
    try {
      await room.cancelInvite(g.id);
      gameRef.current = null;
      activeIdRef.current = null;
      setActiveId(null);
      setGame(null);
    } catch (e) {
      showToast('取消失败，请重试', 'warn');
    } finally {
      setBusy(false);
    }
  }

  async function ensureJoined(row) {
    if (!row || row.status !== 'waiting') return;
    if (row.creator_id === userId) return;
    try {
      const res = await room.joinGame(row.id);
      if (res.changed && res.row) {
        applyRow(res.row);
        broadcastRow(res.row);
      }
    } catch (e) {
      /* 下一次轮询会重试 */
    }
  }

  async function pick(word) {
    const g = gameRef.current;
    if (!g || g.status !== 'picking' || !isDrawerOf(g, userId) || !word) return;
    setBusy(true);
    try {
      const res = await room.pickWord(g.id, g.round, word);
      if (res.changed && res.row) {
        applyRow(res.row);
        broadcastRow(res.row);
      } else {
        applyRow(await room.fetchGameRow(g.id));
      }
    } catch (e) {
      showToast('选词失败，请重试', 'warn');
    } finally {
      setBusy(false);
    }
  }

  function reshuffleChoices() {
    const g = gameRef.current;
    if (!g || g.status !== 'picking' || !isDrawerOf(g, userId)) return;
    setChoiceOverride(wordsOf(room.makeWordChoices(wordsOf(customWordsRef.current), 3)));
  }

  async function sendHintText(text) {
    const g = gameRef.current;
    const value = String(text || '').trim();
    if (!g || g.status !== 'drawing' || !isDrawerOf(g, userId) || !value) return;
    setBusy(true);
    try {
      const res = await room.sendHint(g.id, g.round, value);
      if (res.changed && res.row) {
        applyRow(res.row);
        broadcastRow(res.row);
        showToast('提示已发送，本轮加时 ' + room.HINT_EXTRA_SECONDS + ' 秒', 'info');
      }
    } catch (e) {
      showToast('提示发送失败', 'warn');
    } finally {
      setBusy(false);
    }
  }

  async function settleRound(winner) {
    const g = gameRef.current;
    if (!g || g.status !== 'drawing' || finishingRef.current) return;
    finishingRef.current = true;
    try {
      const res = await room.finishRound(g, winner, wordsOf(customWordsRef.current));
      if (res.changed && res.row) {
        applyRow(res.row);
        broadcastRow(res.row);
      } else {
        applyRow(await room.fetchGameRow(g.id));
      }
    } catch (e) {
      showToast('结算失败，正在重试', 'warn');
    } finally {
      finishingRef.current = false;
    }
  }

  async function giveUp() {
    const g = gameRef.current;
    if (!g || !isDrawerOf(g, userId)) return;
    await settleRound('gaveup');
  }

  async function submitGuess(text) {
    const g = gameRef.current;
    const value = String(text || '').trim();
    if (!g || g.status !== 'drawing' || isDrawerOf(g, userId) || !value) return;
    const correct = isCorrectGuess(value, g.word);
    sendSignal('guess', { text: value, correct: correct });
    pushFeed({ text: value, from: userId, kind: correct ? 'win' : 'guess' });
    if (correct) await settleRound('win');
  }

  function sendQuickChat(text) {
    const value = String(text || '').trim();
    if (!value) return;
    sendSignal('danmaku', { text: value });
    pushFeed({ text: value, from: userId, kind: 'chat' });
  }

  async function saveDrawing() {
    const g = gameRef.current;
    let snap = snapshotRef.current;
    if (g && g.status === 'drawing' && strokesRef.current.length > 0) {
      snap = {
        gameId: g.id,
        round: g.round,
        word: g.word,
        strokes: strokesRef.current,
        drawerId: g.current_drawer === 'creator' ? g.creator_id : g.invitee_id,
        guesserId: g.current_drawer === 'creator' ? g.invitee_id : g.creator_id,
      };
    }
    if (!snap || !snap.strokes || snap.strokes.length === 0) {
      showToast('画布还是空的', 'warn');
      return;
    }
    setSaving(true);
    try {
      const results = g && Array.isArray(g.round_results) ? g.round_results : [];
      const hit = results.find((r) => r && r.round === snap.round);
      const res = await saveDrawingToGallery({
        gameId: snap.gameId,
        round: snap.round,
        word: snap.word,
        strokes: snap.strokes,
        canvasSize: size,
        drawerId: snap.drawerId,
        guesserId: snap.guesserId,
        result: hit && hit.winner ? hit.winner : 'timeout',
        durationSec: hit ? hit.duration : null,
      });
      if (res.saved) {
        showToast('已保存到画廊', 'win');
        sendSignal('save', { round: snap.round });
      } else {
        showToast(res.reason || '未保存', 'info');
      }
    } catch (e) {
      showToast('保存失败：' + (e.message || '请稍后再试'), 'warn');
    } finally {
      setSaving(false);
    }
  }

  async function rematch() {
    if (pendingRematchId) {
      enterGame(pendingRematchId);
      return;
    }
    const g = gameRef.current;
    if (!g) return;
    setBusy(true);
    try {
      const created = await room.createGame(userId, partnerId, wordsOf(customWordsRef.current));
      await room.markRematch(g.id, created.id, userId);
      sendSignal('rematch', { game_id: created.id });
      enterGame(created.id, created);
    } catch (e) {
      showToast('创建新对局失败', 'warn');
    } finally {
      setBusy(false);
    }
  }

  async function refreshCustomWords() {
    try {
      const rows = await room.fetchCustomWords(userId);
      if (mountedRef.current) setCustomWords(rows);
    } catch (e) {
      /* 静默 */
    }
  }

  // 供 PanResponder / 定时器 调用最新实现，避免闭包过期
  apiRef.current.flushOutbox = flushOutbox;
  apiRef.current.flushPts = flushPts;
  apiRef.current.handleSignal = handleSignal;
  apiRef.current.beginStroke = beginStroke;
  apiRef.current.moveStroke = moveStroke;
  apiRef.current.endStroke = endStroke;
  apiRef.current.ensureJoined = ensureJoined;
  apiRef.current.applyRow = applyRow;
  apiRef.current.settleRound = settleRound;
  apiRef.current.replySnapshot = replySnapshot;
  apiRef.current.sendSignal = sendSignal;

  // ─────────────── 生命周期 ───────────────
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      apiRef.current.flushPts();
      apiRef.current.flushOutbox();
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  useEffect(() => {
    refreshCustomWords();
  }, [userId]);

  useEffect(() => {
    if (gameId && gameId !== activeIdRef.current) enterGame(gameId);
  }, [gameId]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      const active = state === 'active';
      appActiveRef.current = active;
      if (active && activeIdRef.current) {
        room
          .fetchGameRow(activeIdRef.current)
          .then((row) => apiRef.current.applyRow(row))
          .catch(() => {});
      }
    });
    return () => sub && sub.remove();
  }, []);

  // 对局行轮询（自适应间隔 + 后台暂停）
  useEffect(() => {
    if (!activeId) {
      setLoading(false);
      return undefined;
    }
    let cancelled = false;
    let timer = null;

    const schedule = () => {
      if (cancelled) return;
      const g = gameRef.current;
      const fast = !g || g.status !== 'finished';
      timer = setTimeout(tick, fast ? GAME_POLL_ACTIVE : GAME_POLL_IDLE);
    };

    const tick = async () => {
      if (cancelled) return;
      if (!appActiveRef.current) {
        schedule();
        return;
      }
      try {
        const row = await room.fetchGameRow(activeId);
        if (cancelled) return;
        if (row) {
          apiRef.current.applyRow(row);
          apiRef.current.ensureJoined(row);
          setErrorText('');
        } else {
          setErrorText('这局游戏不存在或已被取消');
        }
      } catch (e) {
        /* 静默，下个周期重试 */
      } finally {
        if (!cancelled) {
          setLoading(false);
          schedule();
        }
      }
    };

    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [activeId]);

  // 信号队列轮询
  useEffect(() => {
    if (!activeId) return undefined;
    let cancelled = false;
    let timer = null;

    const schedule = () => {
      if (cancelled) return;
      const g = gameRef.current;
      timer = setTimeout(tick, g && g.status === 'drawing' ? SIGNAL_POLL_DRAWING : SIGNAL_POLL_IDLE);
    };

    const tick = async () => {
      if (cancelled) return;
      if (!appActiveRef.current) {
        schedule();
        return;
      }
      try {
        const res = await pollSignals(activeId, lastSignalIdRef.current);
        if (cancelled) return;
        lastSignalIdRef.current = res.maxId;
        const list = res.signals || [];
        // 首次只对齐游标，不重放整局历史笔画
        if (primeRef.current) {
          if (list.length < PRIME_PAGE) primeRef.current = false;
        } else {
          for (let i = 0; i < list.length; i++) {
            const item = list[i];
            if (item.sender_id === userId) continue;
            apiRef.current.handleSignal(Object.assign({ type: item.type }, item.data || {}));
          }
        }
      } catch (e) {
        /* 静默 */
      } finally {
        schedule();
      }
    };

    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [activeId, userId]);

  // IM 快速通道
  useEffect(() => {
    if (!activeId) return undefined;
    const off = onSignal('dg:' + activeId, (payload) => {
      apiRef.current.handleSignal(payload);
    });
    return () => {
      if (off) off();
    };
  }, [activeId]);

  // 倒计时 + 超时兜底（以 DB deadline_at 为唯一依据）
  const status = game ? game.status : null;
  const round = game ? game.round : 0;
  const deadline = game ? game.deadline_at || game.started_at : null;

  useEffect(() => {
    if (status !== 'drawing') {
      setRemainSec(room.DRAW_SECONDS);
      return undefined;
    }
    const tick = () => {
      const g = gameRef.current;
      const left = room.computeRemainSec(g);
      setRemainSec(left);
      if (left > 0) return;
      const deadlineMs = room.computeDeadlineMs(g);
      if (!deadlineMs) return;
      const over = Date.now() - deadlineMs;
      const mine = isDrawerOf(g, userId);
      // 画题人负责结算；画题人掉线时猜题人在宽限期后接手
      if (mine || over > room.TIMEOUT_GRACE_MS) apiRef.current.settleRound('timeout');
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [status, round, deadline, userId]);

  // 猜题人中途进入：请求整幅画快照
  useEffect(() => {
    if (status !== 'drawing' || !game) return undefined;
    if (isDrawerOf(game, userId)) return undefined;
    if (syncRoundRef.current === round) return undefined;
    syncRoundRef.current = round;
    const timer = setTimeout(() => {
      apiRef.current.sendSignal('sync_request', { round: round });
    }, 700);
    return () => clearTimeout(timer);
  }, [status, round, userId, game]);

  const panHandlers = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => canDrawRef.current,
        onMoveShouldSetPanResponder: () => canDrawRef.current,
        onPanResponderTerminationRequest: () => false,
        onShouldBlockNativeResponder: () => true,
        onPanResponderGrant: (evt) => apiRef.current.beginStroke(evt.nativeEvent),
        onPanResponderMove: (evt) => apiRef.current.moveStroke(evt.nativeEvent),
        onPanResponderRelease: () => apiRef.current.endStroke(),
        onPanResponderTerminate: () => apiRef.current.endStroke(),
      }).panHandlers,
    []
  );

  const isDrawer = game ? isDrawerOf(game, userId) : false;
  const choices = useMemo(() => {
    if (choiceOverride) return choiceOverride;
    return room.mixCustomWord(room.normalizeChoices(game), wordsOf(customWords), round);
  }, [choiceOverride, game, customWords, round]);

  return {
    activeId,
    game,
    loading,
    errorText,
    strokes,
    liveStroke,
    remoteStroke,
    remainSec,
    feed,
    toast,
    tool,
    setTool,
    busy,
    saving,
    isDrawer,
    choices,
    customWords,
    partnerSavedRound,
    pendingRematchId,
    panHandlers,
    canDraw: status === 'drawing' && isDrawer,
    actions: {
      createInvite,
      cancelInvite,
      pick,
      reshuffleChoices,
      sendHintText,
      giveUp,
      submitGuess,
      sendQuickChat,
      undo,
      clearBoard,
      saveDrawing,
      rematch,
      enterGame,
      refreshCustomWords,
      showToast,
    },
  };
}

export default useDrawGuessSession;
