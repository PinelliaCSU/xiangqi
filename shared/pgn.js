/**
 * PGN（中国象棋）导出 / 解析
 * 采用 WXF 通行做法：起始局面写 [FEN]，着法用 ICCS 坐标（如 h2e2），
 * 中文记谱放进 {} 注释，方便人类阅读与外部工具互通。
 */
import { START_FEN, positionFromFen, uciToMove, isLegalMove, applyMove, RED } from './rules.js';

function escapeTag(v) {
  return String(v ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * @param {object} p
 * @param {Record<string,string>} p.tags
 * @param {string} p.startFen
 * @param {Array<{uci:string, chinese?:string, comment?:string}>} p.moves
 */
export function buildPgn({ tags = {}, startFen = START_FEN, moves = [] }) {
  const lines = [];
  const allTags = {
    Event: '对局',
    Site: '象棋研究',
    Date: new Date().toISOString().slice(0, 10).replace(/-/g, '.'),
    Round: '-',
    Red: '红方',
    Black: '黑方',
    Result: '*',
    Variant: 'Xiangqi',
    ...tags,
  };
  if (startFen !== START_FEN) allTags.FEN = startFen;
  for (const [k, v] of Object.entries(allTags)) {
    lines.push(`[${k} "${escapeTag(v)}"]`);
  }
  lines.push('');

  const parts = [];
  let moveNo = startFen === START_FEN ? 1 : Number(startFen.trim().split(/\s+/)[5] || 1);
  let side = startFen.trim().split(/\s+/)[1] === 'b' ? -1 : RED;

  for (const mv of moves) {
    const prefix = side === RED ? `${moveNo}.` : `${moveNo}...`;
    let token = `${prefix} ${mv.uci}`;
    const note = [mv.chinese && `(${mv.chinese})`, mv.comment].filter(Boolean).join(' ');
    if (note) token += ` {${note.replace(/[{}]/g, '')}}`;
    parts.push(token);
    if (side !== RED) moveNo++;
    side = side === RED ? -1 : RED;
  }

  const body = [];
  let line = '';
  for (const p of parts) {
    if ((line + ' ' + p).trim().length > 78) {
      body.push(line.trim());
      line = p;
    } else {
      line = (line + ' ' + p).trim();
    }
  }
  if (line.trim()) body.push(line.trim());
  body.push(allTags.Result || '*');
  return `${lines.join('\n')}\n${body.join('\n')}\n`;
}

/**
 * 解析 PGN：只取主线着法，忽略变例括号
 * @returns {{tags:Record<string,string>, startFen:string, moves:string[]}}
 */
export function parsePgn(text) {
  if (typeof text !== 'string' || !text.trim()) throw new Error('PGN 内容为空');
  const tags = {};
  const tagRe = /\[(\w+)\s+"((?:[^"\\]|\\.)*)"\]/g;
  let m;
  while ((m = tagRe.exec(text)) !== null) {
    tags[m[1]] = m[2].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  let body = text.replace(tagRe, '');

  // 去掉注释与变例
  body = body.replace(/\{[^}]*\}/g, ' ');
  let prev;
  do {
    prev = body;
    body = body.replace(/\([^()]*\)/g, ' ');
  } while (body !== prev);
  body = body.replace(/;[^\n]*/g, ' ');

  const tokens = body.split(/\s+/).filter(Boolean);
  const moves = [];
  for (const tk of tokens) {
    if (/^\d+\.+$/.test(tk)) continue;
    if (/^(\d+\.)+\d*$/.test(tk)) continue;
    if (/^(1-0|0-1|1\/2-1\/2|\*)$/.test(tk)) continue;
    if (/^[a-i][0-9][a-i][0-9]$/i.test(tk)) moves.push(tk.toLowerCase());
  }

  const startFen = tags.FEN ? tags.FEN : START_FEN;
  // 逐着校验，导入前就发现非法棋谱
  let pos = positionFromFen(startFen);
  for (const uci of moves) {
    const mv = uciToMove(uci);
    if (!isLegalMove(pos, mv.from, mv.to)) {
      throw new Error(`棋谱第 ${moves.indexOf(uci) + 1} 着 "${uci}" 在该局面下不合法`);
    }
    pos = applyMove(pos, { ...mv, cap: pos.board[mv.to] });
  }

  return { tags, startFen, moves };
}
