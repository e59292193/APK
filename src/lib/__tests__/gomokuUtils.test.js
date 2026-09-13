import {
  BOARD_SIZE,
  STONE,
  buildBoard,
  checkWin,
  isDraw,
  nextTurn,
  getWinLine,
  undoLastMove,
} from '../gomokuUtils';

describe('gomokuUtils 五子棋规则', () => {
  test('空棋盘构建', () => {
    const board = buildBoard([]);
    expect(board.length).toBe(BOARD_SIZE);
    expect(board.flat().every((c) => c === STONE.EMPTY)).toBe(true);
  });

  test('buildBoard 按 moves 落子且忽略非法坐标', () => {
    const board = buildBoard([
      { x: 3, y: 4, p: STONE.BLACK },
      { x: -1, y: 0, p: STONE.BLACK },   // 越界：忽略
      { x: 99, y: 99, p: STONE.WHITE },  // 越界：忽略
    ]);
    expect(board[4][3]).toBe(STONE.BLACK);
    expect(board.flat().filter((c) => c !== STONE.EMPTY).length).toBe(1);
  });

  test('横向五连判胜', () => {
    const moves = [];
    for (let x = 3; x <= 7; x++) moves.push({ x, y: 7, p: STONE.BLACK });
    const board = buildBoard(moves);
    expect(checkWin(board, 5, 7, STONE.BLACK)).toBe(true);
  });

  test('纵向五连判胜', () => {
    const moves = [];
    for (let y = 0; y <= 4; y++) moves.push({ x: 4, y, p: STONE.WHITE });
    const board = buildBoard(moves);
    expect(checkWin(board, 4, 2, STONE.WHITE)).toBe(true);
  });

  test('副对角线五连判胜', () => {
    const moves = [];
    for (let i = 0; i <= 4; i++) moves.push({ x: 5 + i, y: 9 - i, p: STONE.BLACK });
    const board = buildBoard(moves);
    expect(checkWin(board, 7, 7, STONE.BLACK)).toBe(true);
  });

  test('四连不判胜；断连不判胜', () => {
    let moves = [];
    for (let x = 0; x <= 3; x++) moves.push({ x, y: 7, p: STONE.BLACK });
    let board = buildBoard(moves);
    expect(checkWin(board, 2, 7, STONE.BLACK)).toBe(false);

    // 1 1 0 1 1 1 —— 中间被白子隔断
    moves = [
      { x: 0, y: 0, p: STONE.BLACK },
      { x: 1, y: 0, p: STONE.BLACK },
      { x: 2, y: 0, p: STONE.WHITE },
      { x: 3, y: 0, p: STONE.BLACK },
      { x: 4, y: 0, p: STONE.BLACK },
      { x: 5, y: 0, p: STONE.BLACK },
    ];
    board = buildBoard(moves);
    expect(checkWin(board, 4, 0, STONE.BLACK)).toBe(false);
  });

  test('checkWin 校验落子点必须属于该玩家', () => {
    const moves = [{ x: 5, y: 5, p: STONE.BLACK }];
    const board = buildBoard(moves);
    expect(checkWin(board, 5, 5, STONE.WHITE)).toBe(false);
  });

  test('getWinLine 返回五连坐标', () => {
    const moves = [];
    for (let x = 2; x <= 6; x++) moves.push({ x, y: 8, p: STONE.BLACK });
    const board = buildBoard(moves);
    const line = getWinLine(board, 4, 8, STONE.BLACK);
    expect(line).not.toBeNull();
    expect(line.length).toBeGreaterThanOrEqual(5);
  });

  test('平局与回合交替', () => {
    expect(isDraw(BOARD_SIZE * BOARD_SIZE - 1)).toBe(false);
    expect(isDraw(BOARD_SIZE * BOARD_SIZE)).toBe(true);
    expect(nextTurn(STONE.BLACK)).toBe('invitee');
    expect(nextTurn(STONE.WHITE)).toBe('creator');
  });

  test('undoLastMove 悔棋测试', () => {
    // 空棋盘无法悔棋
    expect(undoLastMove([])).toBeNull();
    expect(undoLastMove(null)).toBeNull();

    // 撤销黑棋（第一步）：步数变为 0，回合权归还给 creator
    const moves1 = [{ x: 7, y: 7, p: STONE.BLACK }];
    const undo1 = undoLastMove(moves1);
    expect(undo1).not.toBeNull();
    expect(undo1.newMoves.length).toBe(0);
    expect(undo1.removedMove).toEqual({ x: 7, y: 7, p: STONE.BLACK });
    expect(undo1.nextTurn).toBe('creator');

    // 撤销白棋（第二步）：步数变为 1，回合权归还给 invitee
    const moves2 = [
      { x: 7, y: 7, p: STONE.BLACK },
      { x: 8, y: 8, p: STONE.WHITE },
    ];
    const undo2 = undoLastMove(moves2);
    expect(undo2).not.toBeNull();
    expect(undo2.newMoves.length).toBe(1);
    expect(undo2.removedMove).toEqual({ x: 8, y: 8, p: STONE.WHITE });
    expect(undo2.nextTurn).toBe('invitee');
  });
});
