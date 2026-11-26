import { colOf, inCheck, kingIndex, PIECE_CHAR, RED, rowOf } from '../shared/rules.js';

const WIDTH = 480;
const HEIGHT = 538;
const PAD = 32;
const CELL = 52;
const numbers = '一二三四五六七八九';
const traditional = { 马: '馬', 车: '車', 帅: '帥', 将: '將' };

function point(col, row) {
  return [PAD + col * CELL, 35 + row * CELL];
}

function drawGrid(canvas, flipped) {
  const ctx = canvas.getContext('2d');
  ctx.setTransform(canvas.width / WIDTH, 0, 0, canvas.height / HEIGHT, 0, 0);
  ctx.clearRect(0, 0, WIDTH, HEIGHT);
  ctx.strokeStyle = '#8e623e';
  ctx.lineWidth = 1;
  ctx.beginPath();
  const line = (c1, r1, c2, r2) => {
    ctx.moveTo(...point(c1, r1));
    ctx.lineTo(...point(c2, r2));
  };
  for (let row = 0; row < 10; row++) line(0, row, 8, row);
  line(0, 0, 0, 9);
  line(8, 0, 8, 9);
  for (let col = 1; col < 8; col++) {
    line(col, 0, col, 4);
    line(col, 5, col, 9);
  }
  for (const row of [0, 7]) {
    line(3, row, 5, row + 2);
    line(5, row, 3, row + 2);
  }
  for (const [row, cols] of [[2,[1,7]], [3,[0,2,4,6,8]], [6,[0,2,4,6,8]], [7,[1,7]]]) {
    for (const col of cols) {
      const [x, y] = point(col, row);
      for (const dx of [-1, 1]) {
        if (col + dx < 0 || col + dx > 8) continue;
        for (const dy of [-1, 1]) {
          ctx.moveTo(x + 13 * dx, y + 7 * dy);
          ctx.lineTo(x + 7 * dx, y + 7 * dy);
          ctx.lineTo(x + 7 * dx, y + 13 * dy);
        }
      }
    }
  }
  ctx.stroke();

  ctx.fillStyle = '#704927';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '14px system-ui, sans-serif';
  for (let col = 0; col < 9; col++) {
    const x = point(col, 0)[0];
    ctx.fillText(flipped ? numbers[col] : col + 1, x, 10);
    ctx.fillText(flipped ? 9 - col : numbers[8 - col], x, 529);
  }
  ctx.fillStyle = '#936744';
  ctx.font = '24px KaiTi, STKaiti, "Noto Serif CJK SC", serif';
  for (const [text, x] of [['楚  河', 135], ['漢  界', 345]]) ctx.fillText(text, x, 269);
}

export class BoardView {
  constructor(el, pick) {
    this.el = el;
    this.canvas = el.querySelector('canvas');
    this.squareLayer = el.querySelector('.squares');
    this.buttons = Array.from({length: 90}, (_, square) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'square';
      button.dataset.square = square;
      button.tabIndex = square === 85 ? 0 : -1;
      button.addEventListener('click', () => {
        this.setFocus(square);
        pick(square);
      });
      return button;
    });
    this.focusSquare = 85;
    this.squareLayer.append(...this.buttons);
    this.squareLayer.addEventListener('keydown', (event) => {
      const delta = {ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1]}[event.key];
      if (!delta) return;
      event.preventDefault();
      const direction = this.flipped ? -1 : 1;
      const row = Math.max(0, Math.min(9, rowOf(this.focusSquare) + delta[0] * direction));
      const col = Math.max(0, Math.min(8, colOf(this.focusSquare) + delta[1] * direction));
      this.setFocus(row * 9 + col);
      this.buttons[this.focusSquare].focus();
    });
  }

  setFocus(square) {
    this.buttons[this.focusSquare].tabIndex = -1;
    this.focusSquare = square;
    this.buttons[square].tabIndex = 0;
  }

  render({position, selected, legal, lastMove, flipped}) {
    if (this.flipped !== flipped) {
      this.flipped = flipped;
      drawGrid(this.canvas, flipped);
      for (const [square, button] of this.buttons.entries()) {
        const [x, y] = point(flipped ? 8 - colOf(square) : colOf(square), flipped ? 9 - rowOf(square) : rowOf(square));
        button.style.left = `${x / WIDTH * 100}%`;
        button.style.top = `${y / HEIGHT * 100}%`;
      }
    }
    const targets = new Set(legal.filter(move => move.from === selected).map(move => move.to));
    const checked = inCheck(position) ? kingIndex(position, position.side) : -1;
    for (const [square, button] of this.buttons.entries()) {
      const piece = position.board[square];
      const side = Math.sign(piece);
      const char = PIECE_CHAR[side]?.[Math.abs(piece)] ?? '';
      button.textContent = traditional[char] ?? char;
      button.classList.toggle('red-piece', side === RED);
      button.classList.toggle('black-piece', side < 0);
      button.classList.toggle('selected', square === selected);
      button.classList.toggle('checked', square === checked);
      button.classList.toggle('legal-target', targets.has(square));
      button.classList.toggle('last-from', square === lastMove?.from);
      button.classList.toggle('last-to', square === lastMove?.to);
      button.setAttribute('aria-label', `${String.fromCharCode(97 + colOf(square))}${9 - rowOf(square)} ${piece ? (side === RED ? '红' : '黑') + char : '空位'}${targets.has(square) ? '，可走' : ''}`);
      button.setAttribute('aria-pressed', square === selected);
    }
  }
}
