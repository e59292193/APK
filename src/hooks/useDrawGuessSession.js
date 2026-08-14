import { useEffect, useMemo, useRef, useState } from 'react';
import { AppState, PanResponder } from 'react-native';
import { emitSignal, onSignal } from '../lib/realtimeSignal';
import {
  getLatestSignalId,
  pollSignals,
  pushSignal,
  pushSignals,
} from '../lib/drawGuessSignalQueue';
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
const ROUND_SCOPED = new Set([
  'stroke_begin',
  'stroke_pts',
  'stroke_end',
  'undo',
  'clear',
  'danmaku',
  'guess',
  'sync_request',
  'snapshot',
]);
const GAME_POLL_ACTIVE = 2500;
const GAME_POLL_IDLE = 6000;
const SIGNAL_POLL_DRAWING = 900;
const SIGNAL_POLL_IDLE = 2400;
const SIGNAL_PAGE_SIZE = 200;
const OUTBOX_FLUSH_MS = 220;
const PTS_FLUSH_MS = 80;
const MAX_STROKE_POINTS = 900;
const FEED_TTL = 4200;

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

function clamp(value, min, max) {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function wordsOf(list) {
  return (list || [])
    .map((item) => (typeof item === 'string' ? item : item && item.word))
    .filter(Boolean);
}

function laterIso(a, b) {
  const aMs = a ? new Date(a).getTime() : 0;
  const bMs = b ? new Date(b).getTime() : 0;
  if (!Number.isFinite(aMs)) return b;
  if (!Number.isFinite(bMs)) return a;
  return aMs >= bMs ? a : b;
}

function mergeSameStage(previous, incoming) {
  if (
    !previous ||
    !incoming ||
    previous.id !== incoming.id ||
    previous.round !== incoming.round ||
    previous.status !== incoming.status
  ) {
    return incoming;
  }
  const next = { ...incoming };
  if (incoming.status === 'drawing') {
    next.word = incoming.word || previous.word;
    next.started_at = incoming.started_at || previous.started_at;
    next.hint = incoming.hint || previous.hint;
    next.deadline_at = laterIso(previous.deadline_at, incoming.deadline_at);
  }
  const oldResults = Array.isArray(previous.round_results) ? previous.round_results : [];
  const newResults = Array.isArray(incoming.round_results) ? incoming.round_results : [];
  if (oldResults.length > newResults.length) next.round_results = oldResults;
  next.rematch_game_id = incoming.rematch_game_id || previous.rematch_game_id;
  next.rematch_request_by = incoming.rematch_request_by || previous.rematch_request_by;
  return next;
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
  const remoteLiveRef = useRef(null);
  const toolRef = useRef(tool);
  const customWordsRef = useRef([]);
  const canDrawRef = useRef(false);
  const dedupeRef = useRef(null);
  const assemblerRef = useRef(null);
  const lastSignalIdRef = useRef(0);
  const primeRef = useRef(true);
  const outboxRef = useRef([]);
  const outboxTimerRef = useRef(null);
  const ptsRef = useRef({ si: null, flat: [], q: 0 });
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
      onLive: (stroke) => {
        remoteLiveRef.current = stroke;
        if (mountedRef.current) setRemoteStroke(stroke);
      },
      onComplete: (stroke) => {
        remoteLiveRef.current = null;
        if (!mountedRef.current) return;
        const next = strokesRef.current.concat([stroke]);
        strokesRef.current = next;
        setStrokes(next);
      },
    });
  }

  function showToast(text, kind) {
    if (!mountedRef.current) return;
    setToast({ text, kind: kind || 'info' });
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => {
      if (mountedRef.current) setToast(null);
    }, 2600);
  }

  function pushFeed(item) {
    if (!mountedRef.current || !item || !item.text) return;
    feedIdRef.current += 1;
    const entry = { id: feedIdRef.current, ...item };
    setFeed((previous) => previous.slice(-5).concat([entry]));
    setTimeout(() => {
      if (mountedRef.current) {
        setFeed((previous) => previous.filter((value) => value.id !== entry.id));
      }
    }, FEED_TTL);
  }

  function setStrokeList(next) {
    strokesRef.current = next;
    if (mountedRef.current) setStrokes(next);
  }

  function discardPendingSignals() {
    if (ptsTimerRef.current) clearTimeout(ptsTimerRef.current);
    if (outboxTimerRef.current) clearTimeout(outboxTimerRef.current);
    ptsTimerRef.current = null;
    outboxTimerRef.current = null;
    ptsRef.current = { si: null, flat: [], q: 0 };
    outboxRef.current = [];
  }

  function resetBoard() {
    setStrokeList([]);
    liveRef.current = null;
    remoteLiveRef.current = null;
    strokeIdRef.current = null;
    lastPointRef.current = null;
    ptsRef.current = { si: null, flat: [], q: 0 };
    if (mountedRef.current) {
      setLiveStroke(null);
      setRemoteStroke(null);
    }
    if (assemblerRef.current) assemblerRef.current.reset();
  }

  function applyRow(rawRow, opts) {
    if (!rawRow || !mountedRef.current) return;
    if (activeIdRef.current && rawRow.id !== activeIdRef.current) return;
    const previous = gameRef.current;
    const force = !!(opts && opts.force);
    if (
      previous &&
      previous.id === rawRow.id &&
      !force &&
      stateStamp(rawRow) < stateStamp(previous)
    ) {
      return;
    }

    const row = force ? rawRow : mergeSameStage(previous, rawRow);
    const roundChanged = !previous || previous.id !== row.id || previous.round !== row.round;
    const leftDrawing = !!previous && previous.status === 'drawing' && row.status !== 'drawing';
    const enteredDrawing = !!previous && previous.status !== 'drawing' && row.status === 'drawing';

    if (previous && (roundChanged || leftDrawing)) {
      const trailing = liveRef.current || remoteLiveRef.current;
      const captured = trailing && trailing.points && trailing.points.length > 0
        ? strokesRef.current.concat([sync.withPath(trailing)])
        : strokesRef.current;
      if (captured.length > 0) {
        snapshotRef.current = {
          gameId: previous.id,
          round: previous.round,
          word: previous.word,
          strokes: captured,
          drawerId:
            previous.current_drawer === 'creator' ? previous.creator_id : previous.invitee_id,
          guesserId:
            previous.current_drawer === 'creator' ? previous.invitee_id : previous.creator_id,
        };
      }
    }

    if (roundChanged || enteredDrawing) {
      discardPendingSignals();
      resetBoard();
      setPartnerSavedRound(null);
      setChoiceOverride(null);
    }

    if (previous && previous.status === 'drawing' && row.status !== 'drawing') {
      const results = Array.isArray(row.round_results) ? row.round_results : [];
      const result = results.find((item) => item && item.round === previous.round);
      const word = (result && result.word) || previous.word || '';
      if (result && result.winner === 'win') {
        showToast('猜中了！答案是「' + word + '」', 'win');
      } else if (result && result.winner === 'gaveup') {
        showToast('本轮答案是「' + word + '」', 'info');
      } else if (result) {
        showToast('时间到，答案是「' + word + '」', 'warn');
      }
    }

    gameRef.current = row;
    setGame(row);
    canDrawRef.current = row.status === 'drawing' && isDrawerOf(row, userId);
    if (row.rematch_game_id && row.rematch_request_by !== userId) {
      setPendingRematchId(row.rematch_game_id);
    }
  }

  function sendSignal(type, data, opts) {
    const gid = activeIdRef.current;
    if (!gid) return null;
    const current = gameRef.current;
    const options = opts || {};
    const payload = Object.assign(
      {
        type,
        uid: sync.makeUid(userId),
        from: userId,
        r: current && current.id === gid ? current.round : null,
      },
      data || {}
    );
    if (!options.dbOnly) emitSignal('dg:' + gid, payload);
    if (options.batch) {
      outboxRef.current.push({ type, data: payload });
      if (!outboxTimerRef.current) {
        outboxTimerRef.current = setTimeout(
          () => apiRef.current.flushOutbox(),
          OUTBOX_FLUSH_MS
        );
      }
    } else {
      pushSignal(gid, type, payload, userId);
    }
    return payload.uid;
  }

  function flushOutbox() {
    if (outboxTimerRef.current) clearTimeout(outboxTimerRef.current);
    outboxTimerRef.current = null;
    const gid = activeIdRef.current;
    const items = outboxRef.current;
    outboxRef.current = [];
    if (gid && items.length > 0) pushSignals(gid, items, userId);
  }

  function broadcastRow(row) {
    if (row) sendSignal('update', { row });
  }

  function replySnapshot(round) {
    const current = gameRef.current;
    if (!current || current.status !== 'drawing' || !isDrawerOf(current, userId)) return;
    if (round && Number(round) !== Number(current.round)) return;
    sendSignal(
      'snapshot',
      {
        round: current.round,
        r: current.round,
        s: sync.encodeStrokes(strokesRef.current, size, size),
      },
      { dbOnly: true }
    );
  }

  function handleSignal(signal) {
    if (!signal || !signal.type) return;
    if (signal.from && signal.from === userId) return;

    const current = gameRef.current;
    if (ROUND_SCOPED.has(signal.type)) {
      if (!current || current.status !== 'drawing') return;
      if (signal.r != null && Number(signal.r) !== Number(current.round)) return;
    }
    if (!dedupeRef.current.accept(signal.uid)) return;

    const assembler = assemblerRef.current;
    switch (signal.type) {
      case 'stroke_begin':
        assembler.begin(signal.si, { c: signal.c, w: signal.w, e: signal.e, p: signal.p });
        break;
      case 'stroke_pts':
        assembler.points(signal.si, signal.p, signal.q);
        break;
      case 'stroke_end':
        assembler.end(signal.si, signal.q);
        break;
      case 'undo':
        setStrokeList(strokesRef.current.slice(0, -1));
        break;
      case 'clear':
        resetBoard();
        break;
      case 'danmaku':
        pushFeed({ text: signal.text, from: signal.from, kind: 'chat' });
        break;
      case 'guess':
        pushFeed({ text: signal.text, from: signal.from, kind: signal.correct ? 'win' : 'guess' });
        break;
      case 'update':
        if (signal.row) applyRow(signal.row);
        break;
      case 'sync_request':
        replySnapshot(signal.round);
        break;
      case 'snapshot': {
        if (isDrawerOf(current, userId)) break;
        if (signal.round && Number(signal.round) !== Number(current.round)) break;
        const decoded = sync.decodeStrokes(signal.s, size, size);
        if (decoded.length >= strokesRef.current.length) setStrokeList(decoded);
        break;
      }
      case 'save':
        setPartnerSavedRound(signal.round || null);
        showToast('对方把这幅画存进画廊了', 'info');
        break;
      case 'rematch':
        if (signal.game_id) {
          setPendingRematchId(signal.game_id);
          showToast('对方想再来一局', 'info');
        }
        break;
      default:
        break;
    }
  }

  function beginStroke(nativeEvent) {
    if (!canDrawRef.current) return;
    const selected = toolRef.current;
    const x = clamp(nativeEvent.locationX, 0, size);
    const y = clamp(nativeEvent.locationY, 0, size);
    const strokeId = sync.makeStrokeId(userId);
    const stroke = {
      points: [{ x, y }],
      color: selected.color,
      width: selected.isEraser ? ERASER_WIDTH : selected.width,
      isEraser: selected.isEraser,
    };
    strokeIdRef.current = strokeId;
    lastPointRef.current = { x, y };
    liveRef.current = stroke;
    setLiveStroke(stroke);
    ptsRef.current = { si: strokeId, flat: [], q: 0 };
    sendSignal(
      'stroke_begin',
      {
        si: strokeId,
        c: stroke.color,
        w: stroke.width,
        e: stroke.isEraser ? 1 : 0,
        p: sync.encodePoints(stroke.points, size, size),
      },
      { batch: true }
    );
  }

  function moveStroke(nativeEvent) {
    const stroke = liveRef.current;
    if (!stroke || !canDrawRef.current) return;
    const x = clamp(nativeEvent.locationX, 0, size);
    const y = clamp(nativeEvent.locationY, 0, size);
    if (!sync.shouldAppendPoint(lastPointRef.current, x, y, 2)) return;
    if (stroke.points.length >= MAX_STROKE_POINTS) return;
    lastPointRef.current = { x, y };
    const next = { ...stroke, points: stroke.points.concat([{ x, y }]) };
    liveRef.current = next;
    setLiveStroke(next);
    ptsRef.current.flat.push(sync.toRel(x, size), sync.toRel(y, size));
    if (!ptsTimerRef.current) {
      ptsTimerRef.current = setTimeout(() => apiRef.current.flushPts(), PTS_FLUSH_MS);
    }
  }

  function flushPts() {
    if (ptsTimerRef.current) clearTimeout(ptsTimerRef.current);
    ptsTimerRef.current = null;
    const buffer = ptsRef.current;
    if (!buffer || !buffer.si || buffer.flat.length === 0) return;
    const flat = buffer.flat;
    buffer.flat = [];
    const chunks = sync.chunkFlatPoints(flat, 120);
    for (let index = 0; index < chunks.length; index += 1) {
      buffer.q += 1;
      sendSignal(
        'stroke_pts',
        { si: buffer.si, q: buffer.q, p: chunks[index] },
        { batch: true }
      );
    }
  }

  function endStroke() {
    const stroke = liveRef.current;
    const strokeId = strokeIdRef.current;
    flushPts();
    const lastSequence = ptsRef.current.q || 0;
    liveRef.current = null;
    strokeIdRef.current = null;
    lastPointRef.current = null;
    setLiveStroke(null);
    if (stroke && stroke.points.length > 0) {
      setStrokeList(strokesRef.current.concat([sync.withPath(stroke)]));
    }
    if (strokeId) {
      sendSignal('stroke_end', { si: strokeId, q: lastSequence }, { batch: true });
    }
    ptsRef.current = { si: null, flat: [], q: 0 };
    flushOutbox();
  }

  function undo() {
    if (!gameRef.current || !canDrawRef.current || strokesRef.current.length === 0) return;
    flushOutbox();
    setStrokeList(strokesRef.current.slice(0, -1));
    sendSignal('undo', {});
  }

  function clearBoard() {
    if (!gameRef.current || !canDrawRef.current) return;
    discardPendingSignals();
    resetBoard();
    sendSignal('clear', {});
  }

  function enterGame(id, row) {
    if (!id) return;
    flushPts();
    flushOutbox();
    discardPendingSignals();
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
    if (row) {
      applyRow(row, { force: true });
      setLoading(false);
    } else {
      setGame(null);
      setLoading(true);
    }
  }

  async function createInvite() {
    setBusy(true);
    let created = null;
    try {
      created = await room.createGame(userId, partnerId, wordsOf(customWordsRef.current));
      const message = await room.publishInviteMessage(created, userId, partnerId);
      enterGame(created.id, created);
      if (message) emitSignal('chat:message', message);
      broadcastRow(created);
      setErrorText('');
    } catch (error) {
      if (created) {
        try {
          await room.cancelInvite(created.id);
        } catch (cleanupError) {
          console.warn('[DrawGuess] 孤立邀请清理失败:', cleanupError.message);
        }
      }
      setErrorText(error.message || '创建对局失败，请检查网络');
    } finally {
      setBusy(false);
    }
  }

  async function cancelInvite() {
    const current = gameRef.current;
    if (!current || current.status !== 'waiting' || current.creator_id !== userId) return;
    setBusy(true);
    try {
      await room.cancelInvite(current.id);
      discardPendingSignals();
      gameRef.current = null;
      activeIdRef.current = null;
      setActiveId(null);
      setGame(null);
      setErrorText('');
    } catch (error) {
      showToast('取消失败，请重试', 'warn');
    } finally {
      setBusy(false);
    }
  }

  async function ensureJoined(row) {
    if (!row || row.status !== 'waiting' || row.creator_id === userId) return;
    try {
      const result = await room.joinGame(row.id);
      if (result.changed && result.row) {
        applyRow(result.row);
        broadcastRow(result.row);
      }
    } catch (error) {
      // 下一轮轮询自动重试。
    }
  }

  async function pick(word) {
    const current = gameRef.current;
    if (!current || current.status !== 'picking' || !isDrawerOf(current, userId) || !word) return;
    setBusy(true);
    try {
      const result = await room.pickWord(current.id, current.round, word);
      if (result.changed && result.row) {
        applyRow(result.row);
        broadcastRow(result.row);
      } else {
        applyRow(await room.fetchGameRow(current.id));
      }
    } catch (error) {
      showToast('选词失败，请确认已执行最新数据库脚本', 'warn');
    } finally {
      setBusy(false);
    }
  }

  function reshuffleChoices() {
    const current = gameRef.current;
    if (!current || current.status !== 'picking' || !isDrawerOf(current, userId)) return;
    setChoiceOverride(wordsOf(room.makeWordChoices(wordsOf(customWordsRef.current), 3)));
  }

  async function sendHintText(text) {
    const current = gameRef.current;
    const value = String(text || '').trim();
    if (!current || current.status !== 'drawing' || !isDrawerOf(current, userId) || !value) return;
    if (current.word && value.includes(current.word)) {
      showToast('提示不能直接包含答案', 'warn');
      return;
    }
    setBusy(true);
    try {
      const result = await room.sendHint(current.id, current.round, value, current.deadline_at);
      if (result.changed && result.row) {
        applyRow(result.row);
        broadcastRow(result.row);
        showToast('提示已发送，本轮加时 ' + room.HINT_EXTRA_SECONDS + ' 秒', 'info');
      } else {
        applyRow(await room.fetchGameRow(current.id));
        showToast('本轮已经发送过提示了', 'info');
      }
    } catch (error) {
      showToast('提示发送失败', 'warn');
    } finally {
      setBusy(false);
    }
  }

  async function settleRound(winner) {
    const current = gameRef.current;
    if (!current || current.status !== 'drawing' || finishingRef.current) return;
    finishingRef.current = true;
    try {
      const result = await room.finishRound(current, winner);
      if (result.changed && result.row) {
        applyRow(result.row);
        broadcastRow(result.row);
      } else {
        applyRow(await room.fetchGameRow(current.id));
      }
    } catch (error) {
      showToast('结算失败，正在等待自动重试', 'warn');
    } finally {
      finishingRef.current = false;
    }
  }

  async function giveUp() {
    const current = gameRef.current;
    if (!current || !isDrawerOf(current, userId)) return;
    await settleRound('gaveup');
  }

  async function submitGuess(text) {
    const current = gameRef.current;
    const value = String(text || '').trim();
    if (!current || current.status !== 'drawing' || isDrawerOf(current, userId) || !value) return;
    const correct = isCorrectGuess(value, current.word);
    sendSignal('guess', { text: value, correct });
    pushFeed({ text: value, from: userId, kind: correct ? 'win' : 'guess' });
    if (correct) await settleRound('win');
  }

  function sendQuickChat(text) {
    const value = String(text || '').trim();
    const current = gameRef.current;
    if (!value || !current || current.status !== 'drawing') return;
    sendSignal('danmaku', { text: value });
    pushFeed({ text: value, from: userId, kind: 'chat' });
  }

  async function saveDrawing() {
    const current = gameRef.current;
    if (current && current.status === 'drawing') {
      showToast('本轮结束后再保存，结果记录会更准确', 'info');
      return;
    }
    const snapshot = snapshotRef.current;
    if (!snapshot || !snapshot.strokes || snapshot.strokes.length === 0) {
      showToast('没有可保存的上一轮画作', 'warn');
      return;
    }
    setSaving(true);
    try {
      const results = current && Array.isArray(current.round_results) ? current.round_results : [];
      const result = results.find((item) => item && item.round === snapshot.round);
      const saved = await saveDrawingToGallery({
        gameId: snapshot.gameId,
        round: snapshot.round,
        word: snapshot.word,
        strokes: snapshot.strokes,
        canvasSize: size,
        drawerId: snapshot.drawerId,
        guesserId: snapshot.guesserId,
        result: result && result.winner ? result.winner : 'timeout',
        durationSec: result ? result.duration : null,
      });
      if (saved.saved) {
        showToast('已保存到画廊', 'win');
        sendSignal('save', { round: snapshot.round, r: snapshot.round });
      } else {
        showToast(saved.reason || '未保存', 'info');
      }
    } catch (error) {
      showToast('保存失败：' + (error.message || '请稍后再试'), 'warn');
    } finally {
      setSaving(false);
    }
  }

  async function rematch() {
    if (pendingRematchId) {
      enterGame(pendingRematchId);
      return;
    }
    const current = gameRef.current;
    if (!current || current.status !== 'finished') return;
    setBusy(true);
    let created = null;
    try {
      created = await room.createGame(userId, partnerId, wordsOf(customWordsRef.current));
      await room.markRematch(current.id, created.id, userId);
      sendSignal('rematch', { game_id: created.id });
      enterGame(created.id, created);
    } catch (error) {
      if (created) {
        try {
          await room.cancelInvite(created.id);
        } catch (cleanupError) {
          // 保留日志即可。
        }
      }
      showToast('创建新对局失败', 'warn');
    } finally {
      setBusy(false);
    }
  }

  async function refreshCustomWords() {
    try {
      const rows = await room.fetchCustomWords(userId);
      if (mountedRef.current) setCustomWords(rows);
    } catch (error) {
      // 词库是增强功能，不阻断游戏主流程。
    }
  }

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

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      apiRef.current.flushPts();
      apiRef.current.flushOutbox();
      mountedRef.current = false;
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
    const subscription = AppState.addEventListener('change', (state) => {
      const active = state === 'active';
      appActiveRef.current = active;
      if (active && activeIdRef.current) {
        room
          .fetchGameRow(activeIdRef.current)
          .then((row) => apiRef.current.applyRow(row))
          .catch(() => {});
      }
    });
    return () => subscription && subscription.remove();
  }, []);

  useEffect(() => {
    if (!activeId) {
      setLoading(false);
      return undefined;
    }
    let cancelled = false;
    let timer = null;

    const schedule = () => {
      if (cancelled) return;
      const current = gameRef.current;
      timer = setTimeout(
        tick,
        !current || current.status !== 'finished' ? GAME_POLL_ACTIVE : GAME_POLL_IDLE
      );
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
          gameRef.current = null;
          canDrawRef.current = false;
          resetBoard();
          setGame(null);
          setErrorText('这局游戏不存在或已被取消');
        }
      } catch (error) {
        // 下一周期重试。
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

  useEffect(() => {
    if (!activeId) return undefined;
    let cancelled = false;
    let timer = null;

    const requestSnapshotIfNeeded = () => {
      const current = gameRef.current;
      if (
        current &&
        current.status === 'drawing' &&
        !isDrawerOf(current, userId) &&
        strokesRef.current.length === 0
      ) {
        apiRef.current.sendSignal('sync_request', { round: current.round });
      }
    };

    const schedule = () => {
      if (cancelled) return;
      const current = gameRef.current;
      timer = setTimeout(
        tick,
        current && current.status === 'drawing' ? SIGNAL_POLL_DRAWING : SIGNAL_POLL_IDLE
      );
    };

    const tick = async () => {
      if (cancelled) return;
      if (!appActiveRef.current) {
        schedule();
        return;
      }
      try {
        // 正常路径一次查询直接跳到队尾；失败时才退回每页 200 条的历史对齐。
        if (primeRef.current) {
          const latestId = await getLatestSignalId(activeId);
          if (cancelled) return;
          if (latestId !== null) {
            lastSignalIdRef.current = latestId;
            primeRef.current = false;
            requestSnapshotIfNeeded();
            schedule();
            return;
          }
        }

        const result = await pollSignals(activeId, lastSignalIdRef.current);
        if (cancelled) return;
        lastSignalIdRef.current = result.maxId;
        const list = result.signals || [];
        const wasPriming = primeRef.current;
        if (wasPriming) {
          if (list.length < SIGNAL_PAGE_SIZE) {
            primeRef.current = false;
            requestSnapshotIfNeeded();
          }
        } else {
          for (let index = 0; index < list.length; index += 1) {
            const item = list[index];
            if (item.sender_id === userId) continue;
            apiRef.current.handleSignal(Object.assign({ type: item.type }, item.data || {}));
          }
        }
      } catch (error) {
        // 静默兜底。
      } finally {
        if (!cancelled && !timer) schedule();
      }
    };

    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [activeId, userId]);

  useEffect(() => {
    if (!activeId) return undefined;
    const unsubscribe = onSignal('dg:' + activeId, (payload) => {
      apiRef.current.handleSignal(payload);
    });
    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [activeId]);

  const status = game ? game.status : null;
  const round = game ? game.round : 0;
  const deadline = game ? game.deadline_at || game.started_at : null;

  useEffect(() => {
    if (status !== 'drawing') {
      setRemainSec(room.DRAW_SECONDS);
      return undefined;
    }
    const tick = () => {
      const current = gameRef.current;
      const left = room.computeRemainSec(current);
      setRemainSec(left);
      if (left > 0) return;
      const deadlineMs = room.computeDeadlineMs(current);
      if (!deadlineMs) return;
      const over = Date.now() - deadlineMs;
      if (isDrawerOf(current, userId) || over > room.TIMEOUT_GRACE_MS) {
        apiRef.current.settleRound('timeout');
      }
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [status, round, deadline, userId]);

  useEffect(() => {
    if (status !== 'drawing' || !game || isDrawerOf(game, userId)) return undefined;
    if (syncRoundRef.current === round) return undefined;
    syncRoundRef.current = round;
    const first = setTimeout(() => {
      apiRef.current.sendSignal('sync_request', { round });
    }, 700);
    const retry = setTimeout(() => {
      if (strokesRef.current.length === 0) {
        apiRef.current.sendSignal('sync_request', { round });
      }
    }, 2600);
    return () => {
      clearTimeout(first);
      clearTimeout(retry);
    };
  }, [status, round, userId, game]);

  const panHandlers = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => canDrawRef.current,
        onMoveShouldSetPanResponder: () => canDrawRef.current,
        onStartShouldSetPanResponderCapture: () => canDrawRef.current,
        onMoveShouldSetPanResponderCapture: () => canDrawRef.current,
        onPanResponderTerminationRequest: () => false,
        onShouldBlockNativeResponder: () => true,
        onPanResponderGrant: (event) => apiRef.current.beginStroke(event.nativeEvent),
        onPanResponderMove: (event) => apiRef.current.moveStroke(event.nativeEvent),
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
