import { applyMove, gameStatus, moveToUci, positionFromFen, positionKey, START_FEN, uciToMove } from '../shared/rules.js';
import { moveToChinese } from '../shared/notation.js';

export function replay(fen, moves) {
  let position = positionFromFen(fen);
  const positions = [position];
  const entries = [];
  const keys = [positionKey(position)];
  for (const uci of moves) {
    const requested = uciToMove(uci);
    const move = gameStatus(position, keys).legal?.find(({from, to}) => from === requested.from && to === requested.to);
    if (!move) throw new Error(`第 ${entries.length + 1} 手走法无效`);
    entries.push({
      ...move,
      uci,
      chinese: moveToChinese(position, move),
      side: position.side,
      number: position.fullMove,
    });
    position = applyMove(position, move);
    positions.push(position);
    keys.push(positionKey(position));
  }
  return { positions, entries, keys };
}

export function createStudy(fen = START_FEN, moves = []) {
  replay(fen, moves);
  return {
    fen,
    flipped: false,
    active: 1,
    nextId: 3,
    boards: [
      { id: 1, moves: [...moves], cursor: moves.length, origin: null },
      { id: 2, moves: [...moves], cursor: moves.length, origin: { id: 1, ply: moves.length } },
    ],
  };
}

export function boardName(id) {
  return id === 1 ? '主棋盘' : `分盘 ${id - 1}`;
}

export function createExample() {
  const opening = ['h2e2'];
  const study = createStudy(START_FEN, opening);
  study.boards[0].moves.push('h9g7', 'h0g2', 'a9a8', 'i0h0');
  study.boards[1].moves.push('b9c7', 'b0c2', 'h9g7', 'h0g2');
  for (const board of study.boards) board.cursor = board.moves.length;
  return study;
}

export function splitBoard(study, source, ply = source.cursor) {
  const board = {
    id: study.nextId++,
    moves: source.moves.slice(0, ply),
    cursor: ply,
    origin: { id: source.id, ply },
  };
  study.boards.splice(study.boards.indexOf(source) + 1, 0, board);
  study.active = board.id;
  return board;
}

export function playMove(study, board, move) {
  const uci = moveToUci(move);
  if (board.cursor < board.moves.length && board.moves[board.cursor] !== uci) {
    board = splitBoard(study, board);
  }
  if (board.cursor === board.moves.length) board.moves.push(uci);
  board.cursor++;
  return board;
}

export function restoreStudy(raw) {
  const study = JSON.parse(raw);
  if (!study || !Array.isArray(study.boards) || study.boards[0]?.id !== 1) throw new Error('无效棋局');
  const ids = new Set();
  for (const board of study.boards) {
    if (!Number.isSafeInteger(board.id) || board.id < 1 || ids.has(board.id) ||
        !Array.isArray(board.moves) || !Number.isInteger(board.cursor) ||
        board.cursor < 0 || board.cursor > board.moves.length) throw new Error('无效棋盘');
    if (board.id === 1 ? board.origin !== null :
      !Number.isSafeInteger(board.origin?.id) || !Number.isInteger(board.origin.ply) ||
      board.origin.ply < 0 || board.origin.ply > board.moves.length) throw new Error('无效分盘来源');
    replay(study.fen, board.moves);
    ids.add(board.id);
  }
  study.active = ids.has(study.active) ? study.active : 1;
  study.nextId = Math.max(...ids, Number.isSafeInteger(study.nextId) ? study.nextId - 1 : 1) + 1;
  return study;
}
