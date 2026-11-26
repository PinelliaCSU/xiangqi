/**
 * 中国象棋规则内核
 *
 * 设计要求：
 *  - 纯函数、无 IO、无框架依赖，服务端与浏览器共用同一份实现（单一事实来源）
 *  - 局面不可变（applyMove 返回新对象），悔棋=换指针、分支=共享父节点
 *
 * 棋盘坐标：idx = r * 9 + c
 *   r = 0 为黑方底线（屏幕上方），r = 9 为红方底线（屏幕下方）
 *   c = 0 为屏幕最左，c = 8 为屏幕最右
 *
 * 棋子编码：正数=红，负数=黑；绝对值 1..7 对应 将 士 象 马 车 炮 兵
 */

export const RED = 1;
export const BLACK = -1;

export const K = 1; // 帅 / 将
export const A = 2; // 仕 / 士
export const B = 3; // 相 / 象
export const N = 4; // 马
export const R = 5; // 车
export const C = 6; // 炮
export const P = 7; // 兵 / 卒

export const PIECE_CHAR = {
  [RED]: { 1: '帅', 2: '仕', 3: '相', 4: '马', 5: '车', 6: '炮', 7: '兵' },
  [BLACK]: { 1: '将', 2: '士', 3: '象', 4: '马', 5: '车', 6: '炮', 7: '卒' },
};

export const START_FEN = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1';

const FEN_TO_PIECE = { k: K, a: A, b: B, n: N, r: R, c: C, p: P };
const PIECE_TO_FEN = { 1: 'k', 2: 'a', 3: 'b', 4: 'n', 5: 'r', 6: 'c', 7: 'p' };

const ORTHO = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const DIAG = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
const KNIGHT = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];

export const idxOf = (r, c) => r * 9 + c;
export const rowOf = (idx) => (idx / 9) | 0;
export const colOf = (idx) => idx % 9;
export const other = (side) => (side === RED ? BLACK : RED);

export function createInitialPosition() {
  return positionFromFen(START_FEN);
}

export function positionFromFen(fen) {
  if (typeof fen !== 'string') throw new Error('FEN 必须是字符串');
  const parts = fen.trim().split(/\s+/);
  const [placement, sideStr, , , halfStr, fullStr] = parts;
  const rows = (placement || '').split('/');
  if (rows.length !== 10) throw new Error(`FEN 行数应为 10，实际 ${rows.length}`);
  const board = new Int8Array(90);
  for (let r = 0; r < 10; r++) {
    let c = 0;
    for (const ch of rows[r]) {
      if (ch >= '1' && ch <= '9') {
        c += Number(ch);
      } else {
        const base = FEN_TO_PIECE[ch.toLowerCase()];
        if (!base) throw new Error(`FEN 含非法字符 "${ch}"`);
        if (c > 8) throw new Error('FEN 某行超出 9 列');
        board[idxOf(r, c)] = ch === ch.toUpperCase() ? base : -base;
        c++;
      }
    }
    if (c !== 9) throw new Error(`FEN 第 ${r + 1} 行列数为 ${c}，应为 9`);
  }
  const side = sideStr === 'b' ? BLACK : RED;
  const halfMove = Number.parseInt(halfStr ?? '0', 10);
  const fullMove = Number.parseInt(fullStr ?? '1', 10);
  const pos = {
    board,
    side,
    halfMove: Number.isFinite(halfMove) ? halfMove : 0,
    fullMove: Number.isFinite(fullMove) ? fullMove : 1,
  };
  if (countKings(pos).red !== 1 || countKings(pos).black !== 1) {
    throw new Error('局面必须且只能各有一个帅/将');
  }
  return pos;
}

export function positionToFen(pos) {
  const rows = [];
  for (let r = 0; r < 10; r++) {
    let s = '';
    let empty = 0;
    for (let c = 0; c < 9; c++) {
      const p = pos.board[idxOf(r, c)];
      if (p === 0) {
        empty++;
      } else {
        if (empty) {
          s += empty;
          empty = 0;
        }
        const ch = PIECE_TO_FEN[Math.abs(p)];
        s += p > 0 ? ch.toUpperCase() : ch;
      }
    }
    if (empty) s += empty;
    rows.push(s);
  }
  return `${rows.join('/')} ${pos.side === RED ? 'w' : 'b'} - - ${pos.halfMove} ${pos.fullMove}`;
}

export function clonePosition(pos) {
  return {
    board: Int8Array.from(pos.board),
    side: pos.side,
    halfMove: pos.halfMove,
    fullMove: pos.fullMove,
  };
}

function countKings(pos) {
  let red = 0;
  let black = 0;
  for (let i = 0; i < 90; i++) {
    if (pos.board[i] === K) red++;
    else if (pos.board[i] === -K) black++;
  }
  return { red, black };
}

export function kingIndex(pos, side) {
  const target = side === RED ? K : -K;
  for (let i = 0; i < 90; i++) if (pos.board[i] === target) return i;
  return -1;
}

export function inPalace(r, c, side) {
  if (c < 3 || c > 5) return false;
  return side === RED ? r >= 7 && r <= 9 : r >= 0 && r <= 2;
}

/** 伪合法着法（不检查是否自陷将军） */
export function generatePseudoMoves(pos) {
  const moves = [];
  const board = pos.board;
  const side = pos.side;
  for (let from = 0; from < 90; from++) {
    const piece = board[from];
    if (piece === 0 || Math.sign(piece) !== side) continue;
    const type = Math.abs(piece);
    const r = rowOf(from);
    const c = colOf(from);
    const push = (tr, tc) => {
      if (tr < 0 || tr > 9 || tc < 0 || tc > 8) return false;
      const target = board[idxOf(tr, tc)];
      if (target !== 0 && Math.sign(target) === side) return false;
      moves.push({ from, to: idxOf(tr, tc), cap: target === 0 ? 0 : target });
      return target === 0;
    };

    if (type === K) {
      for (const [dr, dc] of ORTHO) {
        const tr = r + dr;
        const tc = c + dc;
        if (inPalace(tr, tc, side)) push(tr, tc);
      }
    } else if (type === A) {
      for (const [dr, dc] of DIAG) {
        const tr = r + dr;
        const tc = c + dc;
        if (inPalace(tr, tc, side)) push(tr, tc);
      }
    } else if (type === B) {
      for (const [dr, dc] of DIAG) {
        const tr = r + dr * 2;
        const tc = c + dc * 2;
        if (tr < 0 || tr > 9 || tc < 0 || tc > 8) continue;
        // 相/象不过河
        if (side === RED ? tr < 5 : tr > 4) continue;
        if (board[idxOf(r + dr, c + dc)] !== 0) continue; // 塞象眼
        push(tr, tc);
      }
    } else if (type === N) {
      for (const [dr, dc] of KNIGHT) {
        const tr = r + dr;
        const tc = c + dc;
        if (tr < 0 || tr > 9 || tc < 0 || tc > 8) continue;
        // 蹩马腿：取移动向量中较大的分量方向上的相邻格
        const legR = Math.abs(dr) === 2 ? r + dr / 2 : r;
        const legC = Math.abs(dc) === 2 ? c + dc / 2 : c;
        if (board[idxOf(legR, legC)] !== 0) continue;
        push(tr, tc);
      }
    } else if (type === R) {
      for (const [dr, dc] of ORTHO) {
        let tr = r + dr;
        let tc = c + dc;
        while (tr >= 0 && tr <= 9 && tc >= 0 && tc <= 8) {
          const target = board[idxOf(tr, tc)];
          if (target === 0) {
            moves.push({ from, to: idxOf(tr, tc), cap: 0 });
          } else {
            if (Math.sign(target) !== side) moves.push({ from, to: idxOf(tr, tc), cap: target });
            break;
          }
          tr += dr;
          tc += dc;
        }
      }
    } else if (type === C) {
      for (const [dr, dc] of ORTHO) {
        let tr = r + dr;
        let tc = c + dc;
        let screen = false;
        while (tr >= 0 && tr <= 9 && tc >= 0 && tc <= 8) {
          const target = board[idxOf(tr, tc)];
          if (!screen) {
            if (target === 0) {
              moves.push({ from, to: idxOf(tr, tc), cap: 0 });
            } else {
              screen = true; // 找到炮架
            }
          } else if (target !== 0) {
            if (Math.sign(target) !== side) moves.push({ from, to: idxOf(tr, tc), cap: target });
            break;
          }
          tr += dr;
          tc += dc;
        }
      }
    } else if (type === P) {
      const forward = side === RED ? -1 : 1;
      push(r + forward, c);
      const crossed = side === RED ? r <= 4 : r >= 5;
      if (crossed) {
        push(r, c - 1);
        push(r, c + 1);
      }
    }
  }
  return moves;
}

/** 判断 idx 是否被 bySide 方攻击（含白脸将） */
export function isAttacked(board, idx, bySide) {
  const r = rowOf(idx);
  const c = colOf(idx);

  // 兵/卒
  const pawn = bySide === RED ? P : -P;
  if (bySide === RED) {
    if (r + 1 <= 9 && board[idxOf(r + 1, c)] === pawn) return true;
    if (r <= 4) {
      if (c - 1 >= 0 && board[idxOf(r, c - 1)] === pawn) return true;
      if (c + 1 <= 8 && board[idxOf(r, c + 1)] === pawn) return true;
    }
  } else {
    if (r - 1 >= 0 && board[idxOf(r - 1, c)] === pawn) return true;
    if (r >= 5) {
      if (c - 1 >= 0 && board[idxOf(r, c - 1)] === pawn) return true;
      if (c + 1 <= 8 && board[idxOf(r, c + 1)] === pawn) return true;
    }
  }

  // 马
  const knight = bySide === RED ? N : -N;
  for (const [dr, dc] of KNIGHT) {
    const nr = r + dr;
    const nc = c + dc;
    if (nr < 0 || nr > 9 || nc < 0 || nc > 8) continue;
    if (board[idxOf(nr, nc)] !== knight) continue;
    // 马在 (nr,nc) 想走到 (r,c)，蹩腿格相对马计算
    const legR = Math.abs(dr) === 2 ? nr - dr / 2 : nr;
    const legC = Math.abs(dc) === 2 ? nc - dc / 2 : nc;
    if (board[idxOf(legR, legC)] === 0) return true;
  }

  // 车 / 炮 / 将（白脸）
  for (const [dr, dc] of ORTHO) {
    let tr = r + dr;
    let tc = c + dc;
    let screens = 0;
    while (tr >= 0 && tr <= 9 && tc >= 0 && tc <= 8) {
      const piece = board[idxOf(tr, tc)];
      if (piece !== 0) {
        if (screens === 0) {
          if (Math.sign(piece) === bySide) {
            const type = Math.abs(piece);
            if (type === R) return true;
            if (type === K && Math.abs(dr) + Math.abs(dc) === 1) return true;
            // 白脸将：同行同列无阻挡
            if (type === K && dc === 0) return true;
          }
          screens = 1;
        } else {
          if (Math.sign(piece) === bySide && Math.abs(piece) === C) return true;
          break;
        }
      }
      tr += dr;
      tc += dc;
    }
  }
  return false;
}

export function inCheck(pos, side = pos.side) {
  const k = kingIndex(pos, side);
  if (k < 0) return true;
  return isAttacked(pos.board, k, other(side));
}

/** 应用着法，返回新局面（不校验合法性，调用方需先校验） */
export function applyMove(pos, move) {
  const board = Int8Array.from(pos.board);
  const piece = board[move.from];
  const captured = board[move.to];
  board[move.to] = piece;
  board[move.from] = 0;
  const isCapture = captured !== 0;
  return {
    board,
    side: other(pos.side),
    halfMove: isCapture ? 0 : pos.halfMove + 1,
    // 黑方走完算一手结束
    fullMove: pos.side === BLACK ? pos.fullMove + 1 : pos.fullMove,
  };
}

export function isLegalMove(pos, from, to) {
  if (from === to) return false;
  const piece = pos.board[from];
  if (piece === 0 || Math.sign(piece) !== pos.side) return false;
  const pseudo = generatePseudoMoves(pos);
  const found = pseudo.some((m) => m.from === from && m.to === to);
  if (!found) return false;
  const next = applyMove(pos, { from, to, cap: pos.board[to] });
  return !inCheck(next, pos.side);
}

export function generateLegalMoves(pos) {
  const out = [];
  for (const m of generatePseudoMoves(pos)) {
    const next = applyMove(pos, m);
    if (!inCheck(next, pos.side)) out.push(m);
  }
  return out;
}

const FILE_CHARS = 'abcdefghi';
export function moveToUci(move) {
  const from = `${FILE_CHARS[colOf(move.from)]}${9 - rowOf(move.from)}`;
  const to = `${FILE_CHARS[colOf(move.to)]}${9 - rowOf(move.to)}`;
  return `${from}${to}`;
}

export function uciToMove(uci) {
  if (typeof uci !== 'string' || !/^[a-i][0-9][a-i][0-9]$/.test(uci.trim())) {
    throw new Error(`非法着法字符串 "${uci}"`);
  }
  const s = uci.trim();
  const toIdx = (f, r) => idxOf(9 - Number(r), FILE_CHARS.indexOf(f));
  return { from: toIdx(s[0], s[1]), to: toIdx(s[2], s[3]) };
}

/** 局面键：用于重复局面判定与缓存。含行棋方，不含限招计数 */
export function positionKey(pos) {
  let s = '';
  for (let i = 0; i < 90; i++) s += String.fromCharCode(pos.board[i] + 100);
  return s + (pos.side === RED ? 'w' : 'b');
}

export function insufficientMaterial(pos) {
  for (let i = 0; i < 90; i++) {
    const t = Math.abs(pos.board[i]);
    if (t === R || t === N || t === C || t === P) return false;
  }
  return true;
}

/**
 * 终局判定
 * @param {object} pos 当前局面
 * @param {string[]} keys 从根局面到当前局面的 positionKey 序列（含当前）
 * @returns {{over:boolean, result?:string, winner?:number, reason?:string}}
 */
export function gameStatus(pos, keys = []) {
  const legal = generateLegalMoves(pos);
  if (legal.length === 0) {
    // 象棋：困毙同样是输
    const checked = inCheck(pos, pos.side);
    return {
      over: true,
      result: pos.side === RED ? '0-1' : '1-0',
      winner: other(pos.side),
      reason: checked ? 'checkmate' : 'stalemate',
    };
  }
  if (pos.halfMove >= 120) {
    return { over: true, result: '1/2-1/2', reason: 'sixty-move' };
  }
  const key = positionKey(pos);
  let repeat = 0;
  for (const k of keys) if (k === key) repeat++;
  if (repeat >= 3) {
    return { over: true, result: '1/2-1/2', reason: 'repetition' };
  }
  if (insufficientMaterial(pos)) {
    return { over: true, result: '1/2-1/2', reason: 'insufficient' };
  }
  return { over: false, legal };
}
