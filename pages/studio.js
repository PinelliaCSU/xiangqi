import { BoardView } from './board.js';
import { boardName, createExample, createStudy, playMove, replay, restoreStudy, splitBoard } from './study.js';
import { gameStatus, inCheck, positionToFen, RED } from '../shared/rules.js';
import { reasonText, resultText } from '../shared/notation.js';
import { buildPgn, parsePgn } from '../shared/pgn.js';

const $ = selector => document.querySelector(selector);
const STORAGE = 'xiangqi-studio-pages-v1';
const container = $('#boards');
const views = new Map();
let study = createStudy();
try {
  const saved = localStorage.getItem(STORAGE);
  if (saved) study = restoreStudy(saved);
} catch {
  $('#notice').textContent = '未能恢复本地棋局，已打开新的棋盘。';
  $('#notice').hidden = false;
}

function save() {
  try {
    localStorage.setItem(STORAGE, JSON.stringify(study));
    $('#save-state').textContent = '棋局自动保存在当前浏览器';
  } catch {
    $('#save-state').textContent = '浏览器未能保存棋局，可导出棋谱';
  }
}

function updateActive(id) {
  study.active = id;
  for (const [key, view] of views) view.card.classList.toggle('active', key === id);
  $('#fork-active').title = `从${boardName(id)}的当前局面拆分`;
}

function announce(text) {
  $('#announcement').textContent = text;
}

function renderBoard(board) {
  const view = views.get(board.id);
  if (view.line?.entries.length !== board.moves.length) view.line = replay(study.fen, board.moves);
  const {positions, entries, keys} = view.line;
  const position = positions[board.cursor];
  const status = gameStatus(position, keys.slice(0, board.cursor + 1));
  const lastMove = entries[board.cursor - 1];
  view.position = position;
  view.legal = status.legal ?? [];
  view.board.render({ position, selected: view.selected, legal: view.legal, lastMove, flipped: study.flipped });

  const card = view.card;
  card.querySelector('.turn').classList.toggle('red-turn', position.side === RED && !status.over);
  const turn = position.side === RED ? '红方走棋' : '黑方走棋';
  card.querySelector('.turn-label').textContent = status.over ? resultText(status.result) : turn;
  card.querySelector('.ply-count').textContent = `第 ${board.cursor} 手`;
  const message = card.querySelector('.board-message');
  message.textContent = view.error || (status.over ? reasonText(status.reason) : inCheck(position) ? '将军' : '');
  message.hidden = !message.textContent;
  const engine = card.querySelector('.engine');
  engine.disabled = status.over || !!view.worker;
  engine.textContent = view.worker ? '电脑思考中…' : '电脑走一步';
  for (const button of card.querySelectorAll('[data-step]')) {
    const backwards = button.dataset.step === 'start' || button.dataset.step === 'previous';
    button.disabled = backwards ? board.cursor === 0 : board.cursor === board.moves.length;
  }
  const moveList = card.querySelector('.move-list');
  if (view.historyLength !== entries.length) {
    view.historyLength = entries.length;
    const moves = entries.map((move, i) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = move.side === RED ? 'move red-move' : 'move';
      button.dataset.ply = i + 1;
      button.textContent = `${move.number}${move.side === RED ? '.' : '…'} ${move.chinese}`;
      button.addEventListener('click', () => seek(board, i + 1));
      return button;
    });
    if (!moves.length) {
      const empty = document.createElement('span');
      empty.className = 'empty-history';
      empty.textContent = '选择棋子开始走棋';
      moves.push(empty);
    }
    moveList.replaceChildren(...moves);
  }
  for (const button of moveList.querySelectorAll('button')) {
    const current = Number(button.dataset.ply) === board.cursor;
    button.classList.toggle('current', current);
    if (current) button.setAttribute('aria-current', 'step');
    else button.removeAttribute('aria-current');
  }
  const current = moveList.querySelector('.current');
  if (current) {
    const clip = moveList.getBoundingClientRect();
    const item = current.getBoundingClientRect();
    if (item.left < clip.left) moveList.scrollLeft += item.left - clip.left;
    if (item.right > clip.right) moveList.scrollLeft += item.right - clip.right;
  }
}

function cancelWorker(view) {
  view.worker?.terminate();
  view.worker = null;
}

function seek(board, ply) {
  const view = views.get(board.id);
  cancelWorker(view);
  board.cursor = ply;
  view.selected = null;
  view.error = '';
  updateActive(board.id);
  renderBoard(board);
  save();
}

function commitMove(board, move) {
  const view = views.get(board.id);
  cancelWorker(view);
  view.selected = null;
  view.error = '';
  const target = playMove(study, board, move);
  study.active = target.id;
  render();
  if (target !== board) {
    bringIntoView(target, move.to);
    announce(`已保留原棋路，并在${boardName(target.id)}走出另一种应对`);
  }
  save();
}

function pick(board, square) {
  const view = views.get(board.id);
  const move = view.legal.find(({from, to}) => from === view.selected && to === square);
  if (move) {
    commitMove(board, move);
    return;
  }
  const isOwn = Math.sign(view.position.board[square]) === view.position.side;
  view.selected = isOwn && view.legal.length && view.selected !== square ? square : null;
  renderBoard(board);
}

function playComputer(board) {
  const view = views.get(board.id);
  if (view.worker || !view.legal.length) return;
  view.selected = null;
  view.error = '';
  const failed = () => {
    cancelWorker(view);
    view.error = '电脑暂时无法走棋，请重试。';
    renderBoard(board);
  };
  try {
    const worker = new Worker(new URL('./engine-worker.js', import.meta.url), {type: 'module'});
    view.worker = worker;
    worker.onmessage = ({data}) => {
      if (view.worker !== worker) return;
      const move = view.legal.find(({from, to}) => data.move?.from === from && data.move.to === to);
      if (move) commitMove(board, move);
      else failed();
    };
    worker.onerror = () => {
      if (view.worker === worker) failed();
    };
    worker.postMessage(positionToFen(view.position));
    renderBoard(board);
  } catch {
    failed();
  }
}

function bringIntoView(board, square) {
  const view = views.get(board.id);
  if (square !== undefined) view.board.setFocus(square);
  view.board.buttons[view.board.focusSquare].focus({preventScroll: true});
  view.card.scrollIntoView({block: 'nearest', inline: 'nearest'});
}

function fork(board) {
  const created = splitBoard(study, board);
  render();
  bringIntoView(created);
  announce(`已从${boardName(board.id)}第 ${board.cursor} 手拆出${boardName(created.id)}`);
  save();
}

function remove(board) {
  if (board.moves.length > board.origin.ply && !confirm(`移除${boardName(board.id)}及其走子记录？`)) return;
  cancelWorker(views.get(board.id));
  views.get(board.id).card.remove();
  views.delete(board.id);
  study.boards = study.boards.filter(entry => entry !== board);
  if (study.active === board.id) study.active = 1;
  render();
  $('#fork-active').focus({preventScroll: true});
  save();
}

function makeView(board) {
  const card = $('#board-card').content.firstElementChild.cloneNode(true);
  const name = boardName(board.id);
  card.dataset.board = board.id;
  card.querySelector('h2').textContent = name;
  card.querySelector('.board-symbol').textContent = board.origin ? '分' : '主';
  card.querySelector('.origin').textContent = board.origin
    ? `源自${boardName(board.origin.id)} · ${board.origin.ply ? `第 ${board.origin.ply} 手` : '开局'}`
    : '对照基准';
  card.querySelector('.board').setAttribute('aria-label', `${name}，用方向键移动，回车选择`);
  card.querySelector('.remove').hidden = !board.origin;
  card.querySelector('.remove').addEventListener('click', () => remove(board));
  card.querySelector('.fork').addEventListener('click', () => fork(board));
  card.querySelector('.engine').addEventListener('click', () => playComputer(board));
  card.addEventListener('focusin', () => updateActive(board.id));
  card.addEventListener('pointerdown', () => updateActive(board.id));
  for (const button of card.querySelectorAll('[data-step]')) {
    button.addEventListener('click', () => {
      const targets = {start: 0, previous: board.cursor - 1, next: board.cursor + 1, end: board.moves.length};
      seek(board, targets[button.dataset.step]);
    });
  }
  return {card, board: new BoardView(card.querySelector('.board'), square => pick(board, square)), selected: null};
}

function render() {
  for (const [i, board] of study.boards.entries()) {
    if (!views.has(board.id)) views.set(board.id, makeView(board));
    const {card} = views.get(board.id);
    if (container.children[i] !== card) container.insertBefore(card, container.children[i] ?? null);
    renderBoard(board);
  }
  updateActive(study.active);
  $('#flip').setAttribute('aria-pressed', study.flipped);
}

function canReplace() {
  return !study.boards.some(board => board.moves.length) || confirm('替换当前棋局和所有分盘？');
}

function replaceStudy(next) {
  for (const view of views.values()) cancelWorker(view);
  views.clear();
  container.replaceChildren();
  study = next;
  $('#notice').hidden = true;
  render();
  save();
}

function activeBoard() {
  return study.boards.find(board => board.id === study.active);
}

$('#fork-active').addEventListener('click', () => fork(activeBoard()));
$('#expand').addEventListener('click', () => {
  const expanded = container.classList.toggle('expanded');
  $('#expand').setAttribute('aria-pressed', expanded);
  $('#expand').textContent = expanded ? '并排显示' : '放大棋盘';
});
$('#flip').addEventListener('click', () => {
  study.flipped = !study.flipped;
  render();
  save();
});
$('#new-study').addEventListener('click', () => {
  if (canReplace()) replaceStudy(createStudy());
});
$('#example').addEventListener('click', () => {
  if (canReplace()) replaceStudy(createExample());
});
$('#import').addEventListener('click', () => $('#import-file').click());
$('#import-file').addEventListener('change', async (event) => {
  const [file] = event.target.files;
  event.target.value = '';
  if (!file) return;
  try {
    const {startFen, moves} = parsePgn(await file.text());
    if (!moves.length && startFen === createStudy().fen) throw new Error('未找到 ICCS 坐标走法');
    const next = createStudy(startFen, moves);
    if (canReplace()) replaceStudy(next);
  } catch (error) {
    $('#notice').textContent = `棋谱导入失败：${error.message}`;
    $('#notice').hidden = false;
  }
});
$('#export').addEventListener('click', () => {
  const board = activeBoard();
  const {entries, keys, positions} = views.get(board.id).line;
  const result = gameStatus(positions.at(-1), keys).result ?? '*';
  const pgn = buildPgn({startFen: study.fen, moves: entries, tags: {Event: boardName(board.id), Result: result}});
  const url = URL.createObjectURL(new Blob([pgn], {type: 'text/plain;charset=utf-8'}));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${boardName(board.id)}.pgn`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

render();
