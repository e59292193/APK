// ═══════════════════════════════════════════════════════
// 五子棋工具函数：棋盘构建、判胜、坐标转换
// 纯函数，无副作用，便于测试与复用
// ═══════════════════════════════════════════════════════

// 棋盘尺寸
export const BOARD_SIZE = 15;

// 棋子角色：p=1 黑(邀请方/creator)，p=2 白(受邀方/invitee)
export const STONE = { EMPTY: 0, BLACK: 1, WHITE: 2 };

// 四个方向：横、竖、主对角线、副对角线
const DIRECTIONS = [
  [1, 0],   // 横向
  [0, 1],   // 纵向
  [1, 1],   // 右下对角
  [1, -1],  // 右上对角
];

/**
 * 从 moves 数组构建 15x15 棋盘二维数组
 * @param {Array<{x:number,y:number,p:number}>} moves
 * @returns {number[][]} board[y][x] = 0/1/2
 */
export function buildBoard(moves) {
  // 初始化空棋盘
  const board = [];
  for (let y = 0; y < BOARD_SIZE; y++) {
    const row = new Array(BOARD_SIZE).fill(STONE.EMPTY);
    board.push(row);
  }
  if (!moves || moves.length === 0) return board;
  for (const m of moves) {
    if (m && typeof m.x === 'number' && typeof m.y === 'number' && typeof m.p === 'number') {
      if (m.y >= 0 && m.y < BOARD_SIZE && m.x >= 0 && m.x < BOARD_SIZE) {
        board[m.y][m.x] = m.p;
      }
    }
  }
  return board;
}

/**
 * 判断在 (x, y) 落子后是否获胜（连五）
 * 只检查最后一手棋，O(n) 复杂度
 * @param {number[][]} board
 * @param {number} x
 * @param {number} y
 * @param {number} p 玩家 1/2
 * @returns {boolean}
 */
export function checkWin(board, x, y, p) {
  if (board[y] === undefined || board[y][x] !== p) return false;

  for (const [dx, dy] of DIRECTIONS) {
    let count = 1; // 包含当前落子
    // 正方向
    for (let i = 1; i < 5; i++) {
      const nx = x + dx * i;
      const ny = y + dy * i;
      if (nx < 0 || nx >= BOARD_SIZE || ny < 0 || ny >= BOARD_SIZE) break;
      if (board[ny][nx] === p) count++;
      else break;
    }
    // 反方向
    for (let i = 1; i < 5; i++) {
      const nx = x - dx * i;
      const ny = y - dy * i;
      if (nx < 0 || nx >= BOARD_SIZE || ny < 0 || ny >= BOARD_SIZE) break;
      if (board[ny][nx] === p) count++;
      else break;
    }
    if (count >= 5) return true;
  }
  return false;
}

/**
 * 判断是否平局（棋盘已满）
 * @param {number} movesCount
 * @returns {boolean}
 */
export function isDraw(movesCount) {
  return movesCount >= BOARD_SIZE * BOARD_SIZE;
}

/**
 * 获取下一回合玩家
 * @param {number} lastP 上一个落子的玩家 1/2
 * @returns {string} 'creator' | 'invitee'
 */
export function nextTurn(lastP) {
  // 黑(1, creator)先手，黑白交替
  return lastP === STONE.BLACK ? 'invitee' : 'creator';
}

/**
 * 角色转棋子编号
 */
export function roleToStone(role) {
  return role === 'creator' ? STONE.BLACK : STONE.WHITE;
}

/**
 * 棋子编号转角色
 */
export function stoneToRole(stone) {
  return stone === STONE.BLACK ? 'creator' : 'invitee';
}

/**
 * 计算获胜的连五坐标（用于高亮显示）
 * @param {number[][]} board
 * @param {number} x
 * @param {number} y
 * @param {number} p
 * @returns {Array<{x:number,y:number}>|null}
 */
export function getWinLine(board, x, y, p) {
  if (board[y] === undefined || board[y][x] !== p) return null;

  for (const [dx, dy] of DIRECTIONS) {
    const line = [{ x, y }];
    // 正方向
    for (let i = 1; i < 5; i++) {
      const nx = x + dx * i;
      const ny = y + dy * i;
      if (nx < 0 || nx >= BOARD_SIZE || ny < 0 || ny >= BOARD_SIZE) break;
      if (board[ny][nx] === p) line.push({ x: nx, y: ny });
      else break;
    }
    // 反方向
    for (let i = 1; i < 5; i++) {
      const nx = x - dx * i;
      const ny = y - dy * i;
      if (nx < 0 || nx >= BOARD_SIZE || ny < 0 || ny >= BOARD_SIZE) break;
      if (board[ny][nx] === p) line.push({ x: nx, y: ny });
      else break;
    }
    if (line.length >= 5) return line;
  }
  return null;
}
