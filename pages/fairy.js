import { idxOf } from '../shared/rules.js';

const STORAGE = 'xiangqi-nnue-mode';
let worker;
let queue = Promise.resolve();
let sequence = 0;

export function preferredEngine() {
  try {
    return localStorage.getItem(STORAGE) === 'nnue' ? 'nnue' : 'fast';
  } catch {
    return 'fast';
  }
}

export async function selectEngine(mode) {
  try { localStorage.setItem(STORAGE, mode); } catch { /* keep the current selection in this tab */ }
  if (mode !== 'nnue' || self.crossOriginIsolated) return;
  if (!navigator.serviceWorker) throw new Error('当前浏览器无法启用进阶引擎');
  const service = navigator.serviceWorker;
  if (!service.controller) {
    const controlled = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        service.removeEventListener('controllerchange', onControl);
        reject(new Error('进阶引擎初始化超时'));
      }, 10000);
      function onControl() {
        if (!service.controller) return;
        clearTimeout(timer);
        service.removeEventListener('controllerchange', onControl);
        resolve();
      }
      service.addEventListener('controllerchange', onControl);
    });
    await Promise.all([controlled, service.register(new URL('../engine-isolation.js', import.meta.url))]);
  }
  location.reload();
}

function toMove(value) {
  // Fairy-Stockfish uses ranks 1–10. The study's ICCS coordinates use 0–9.
  const match = /^([a-i])(10|[1-9])([a-i])(10|[1-9])$/.exec(value);
  if (!match) throw new Error('进阶引擎返回了未知着法');
  const index = (file, rank) => idxOf(10 - Number(rank), file.charCodeAt(0) - 97);
  return {from: index(match[1], match[2]), to: index(match[3], match[4])};
}

export function fairyMove(fen, signal, onProgress) {
  const result = queue.then(() => {
    signal.throwIfAborted();
    if (!self.crossOriginIsolated) throw new Error('当前页面未启用进阶引擎所需的浏览器功能');
    worker ??= new Worker(new URL('./fairy-worker.js', import.meta.url));
    return new Promise((resolve, reject) => {
      const instance = worker;
      const id = ++sequence;
      let timer;
      function waitForProgress() {
        clearTimeout(timer);
        timer = setTimeout(() => fail(new Error('进阶引擎未及时返回')), 45000);
      }
      function cleanup() {
        clearTimeout(timer);
        instance.onmessage = null;
        instance.onerror = null;
      }
      function fail(error) {
        cleanup();
        instance.terminate();
        worker = null;
        reject(error);
      }
      instance.onerror = () => fail(new Error('进阶引擎加载失败'));
      instance.onmessage = ({data}) => {
        if (data.progress) {
          waitForProgress();
          if (!signal.aborted) onProgress(data.progress);
        }
        if (data.id !== id) return;
        if (data.error) {
          fail(new Error(data.error));
          return;
        }
        try {
          const move = toMove(data.coordinate);
          cleanup();
          resolve(move);
        } catch (error) {
          fail(error);
        }
      };
      waitForProgress();
      instance.postMessage({id, fen});
    });
  });
  queue = result.catch(() => {});
  return result;
}
