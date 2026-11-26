/**
 * 中文记谱（如「炮二平五」「前车进三」）
 * 纯函数，依赖规则内核提供的局面与着法结构。
 */
import { RED, PIECE_CHAR, rowOf, colOf } from './rules.js';

const CN_DIGIT = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];

function fileLabel(col, side) {
  // 红方从右至左为一至九；黑方从右至左为 1 至 9（黑方视角的右 = 屏幕左）
  return side === RED ? 9 - col : col + 1;
}

function digit(n, side) {
  if (side === RED) return CN_DIGIT[n] || String(n);
  return String(n);
}

/** 同一列上同兵种棋子的排序（返回按「前→后」排序的下标数组） */
function sameFileGroup(board, col, side, type) {
  const list = [];
  for (let r = 0; r < 10; r++) {
    const p = board[r * 9 + col];
    if (p !== 0 && Math.sign(p) === side && Math.abs(p) === type) list.push(r);
  }
  // 红方「前」= 更靠近黑方（r 小）；黑方「前」= 更靠近红方（r 大）
  list.sort((a, b) => (side === RED ? a - b : b - a));
  return list;
}

function disambiguate(pos, move) {
  const piece = pos.board[move.from];
  const side = Math.sign(piece);
  const type = Math.abs(piece);
  const col = colOf(move.from);
  const group = sameFileGroup(pos.board, col, side, type);
  if (group.length <= 1) return '';

  const rank = group.indexOf(rowOf(move.from));
  if (rank < 0) return '';
  if (group.length === 2) return rank === 0 ? '前' : '后';
  if (rank === 0) return '前';
  if (rank === group.length - 1) return '后';
  return CN_DIGIT[rank + 1] || String(rank + 1);
}

/**
 * 生成中文着法
 * @param {object} pos 走子之前的局面
 * @param {{from:number,to:number}} move
 */
export function moveToChinese(pos, move) {
  const piece = pos.board[move.from];
  if (!piece) return '??';
  const side = Math.sign(piece);
  const type = Math.abs(piece);
  const fromR = rowOf(move.from);
  const toR = rowOf(move.to);
  const fromC = colOf(move.from);
  const toC = colOf(move.to);

  const prefix = disambiguate(pos, move);
  const name = PIECE_CHAR[side][type];
  const origin = prefix ? '' : digit(fileLabel(fromC, side), side);

  if (fromR === toR) {
    return `${prefix}${name}${origin}平${digit(fileLabel(toC, side), side)}`;
  }

  const forward = side === RED ? toR < fromR : toR > fromR;
  const action = forward ? '进' : '退';
  const straight = type === 5 || type === 6 || type === 7 || type === 1;
  const amount = straight ? Math.abs(toR - fromR) : fileLabel(toC, side);
  return `${prefix}${name}${origin}${action}${digit(amount, side)}`;
}

/** 结果文本 */
export function resultText(result) {
  if (result === '1-0') return '红胜';
  if (result === '0-1') return '黑胜';
  if (result === '1/2-1/2') return '和棋';
  return '进行中';
}

export function reasonText(reason) {
  return (
    {
      checkmate: '将死',
      stalemate: '困毙',
      'sixty-move': '六十回合无吃子',
      repetition: '三次重复局面',
      insufficient: '双方无进攻子力',
      resign: '认输',
      timeout: '超时',
    }[reason] || reason || ''
  );
}
