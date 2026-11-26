/**
 * 内置兜底引擎：α-β 搜索 + 子力/位置评估
 *
 * 定位：**仅在未安装真实模型（Pikafish NNUE）时兜底**，保证软件开箱可用。
 * 它不是产品宣称的 AI 主体；界面会明确标注当前引擎类型。
 * 提供 MultiPV 候选列表，交由统一的难度选择层抽样，保证与引擎后端口径一致。
 */
import {
  RED,
  applyMove,
  generateLegalMoves,
  inCheck,
} from '../../shared/rules.js';

const INF = 1e9;
const MATE = 90000;
const TIMEOUT = Symbol('timeout');

const VALUE = { 1: 6000, 2: 200, 3: 200, 4: 400, 5: 900, 6: 450, 7: 100 };

function pst(type, side, r, c) {
  // 统一换算成「红方视角」的行号，便于复用同一套位置分
  const rr = side === RED ? r : 9 - r;
  const centerDist = Math.abs(c - 4);
  switch (type) {
    case 7: {
      const crossed = rr <= 4;
      return (crossed ? 55 : 0) + (9 - rr) * 6 + (4 - centerDist) * 5;
    }
    case 4:
      return (4 - centerDist) * 8 + (4 - Math.abs(rr - 5)) * 5;
    case 6:
      return (4 - centerDist) * 6 + (rr <= 6 ? 6 : 0);
    case 5:
      return (4 - centerDist) * 4 + (rr <= 6 ? 4 : 0);
    case 2:
    case 3:
      return rr >= 7 ? 8 : 0;
    case 1:
      return rr >= 9 ? 12 : 0;
    default:
      return 0;
  }
}

/** 红方视角评分 */
export function evaluate(pos) {
  let score = 0;
  for (let i = 0; i < 90; i++) {
    const p = pos.board[i];
    if (!p) continue;
    const side = Math.sign(p);
    const type = Math.abs(p);
    const r = (i / 9) | 0;
    const c = i % 9;
    score += side * (VALUE[type] + pst(type, side, r, c));
  }
  return score;
}

const evalForSide = (pos) => (pos.side === RED ? evaluate(pos) : -evaluate(pos));

/** 吃子优先（MVV）：先搜大子吃子，能显著提高剪枝率 */
function orderMoves(moves) {
  return moves
    .map((m) => ({ m, s: m.cap ? 10000 + VALUE[Math.abs(m.cap)] * 10 : 0 }))
    .sort((a, b) => b.s - a.s)
    .map((x) => x.m);
}

function searchRoot(pos, depth, deadline, stats) {
  const rootMoves = generateLegalMoves(pos);
  if (rootMoves.length === 0) return { candidates: [], depth: 0 };
  let ordered = orderMoves(rootMoves).map((m) => ({ move: m, score: -INF }));
  let bestComplete = null;

  for (let d = 1; d <= depth; d++) {
    const scored = [];
    let alpha = -INF;
    try {
      for (let i = 0; i < ordered.length; i++) {
        const m = ordered[i].move;
        const child = applyMove(pos, m);
        let v;
        if (i === 0) {
          // 首个着法用全窗口，保证 alpha 是真实值
          v = -negamax(child, d - 1, -INF, INF, deadline, stats, 1);
        } else {
          // PVS：先用零窗口探路，只有超过当前最优才用全窗口重搜，
          // 否则拿到的是上界而非真实分，排序会被着法顺序带偏
          v = -negamax(child, d - 1, -alpha - 1, -alpha, deadline, stats, 1);
          if (v > alpha) v = -negamax(child, d - 1, -INF, -alpha, deadline, stats, 1);
        }
        scored.push({ move: m, score: v });
        if (v > alpha) alpha = v;
      }
    } catch (err) {
      if (err !== TIMEOUT) throw err;
      break; // 本层未完成，沿用上一层结果
    }
    scored.sort((a, b) => b.score - a.score);
    bestComplete = { candidates: scored, depth: d };
    ordered = scored;
    if (Math.abs(scored[0].score) > MATE - 1000) break; // 已见杀，不必再深
  }

  return bestComplete || { candidates: ordered, depth: 0 };
}

function negamax(pos, depth, alpha, beta, deadline, stats, ply) {
  stats.nodes++;
  if ((stats.nodes & 511) === 0 && Date.now() > deadline) throw TIMEOUT;

  const moves = generateLegalMoves(pos);
  if (moves.length === 0) {
    // 无着可走：被将死或困毙，均判负
    return -MATE + ply;
  }
  if (depth <= 0) {
    if (inCheck(pos, pos.side)) depth = 1; // 被将军时延伸一层，减少战术漏算
    else return quiesce(pos, alpha, beta, deadline, stats, ply, 6);
  }

  let best = -INF;
  const ordered = orderMoves(moves);
  for (const m of ordered) {
    const child = applyMove(pos, m);
    const v = -negamax(child, depth - 1, -beta, -alpha, deadline, stats, ply + 1);
    if (v > best) best = v;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}

/**
 * 静态搜索：只搜吃子，直到局面「安静」为止。
 * 没有它，固定深度的评估会停在换子中途，出现「白吃一子却没算到被吃回」
 * 的典型失误（奇数层尤其明显）。
 */
function quiesce(pos, alpha, beta, deadline, stats, ply, qdepth) {
  stats.nodes++;
  if ((stats.nodes & 511) === 0 && Date.now() > deadline) throw TIMEOUT;

  const stand = evalForSide(pos);
  if (stand >= beta) return stand;
  if (stand > alpha) alpha = stand;
  if (qdepth <= 0) return alpha;

  const caps = orderMoves(generateLegalMoves(pos).filter((m) => m.cap));
  for (const m of caps) {
    const child = applyMove(pos, m);
    const v = -quiesce(child, -beta, -alpha, deadline, stats, ply + 1, qdepth - 1);
    if (v >= beta) return v;
    if (v > alpha) alpha = v;
  }
  return alpha;
}

/**
 * @param {object} pos 局面
 * @param {{depth:number, timeMs:number}} opts
 * @returns {{candidates:Array<{move:object,score:number}>, depth:number, nodes:number}}
 */
export function search(pos, { depth = 3, timeMs = 600 } = {}) {
  const deadline = Date.now() + Math.max(50, timeMs);
  const stats = { nodes: 0 };
  try {
    const r = searchRoot(pos, depth, deadline, stats);
    return { ...r, nodes: stats.nodes, value: r.candidates[0]?.score ?? 0 };
  } catch (err) {
    if (err !== TIMEOUT) throw err;
    return { candidates: [], depth: 0, nodes: stats.nodes, value: 0 };
  }
}
