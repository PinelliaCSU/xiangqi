const directory = new URL('../vendor/fairy-stockfish/', self.location.href);
const model = 'xiangqi-c07e94a5c7cb.nnue';
const modelPath = '/' + model;
let stockfish;
let receive;

function waitFor(command, accepts) {
  return new Promise((resolve, reject) => {
    receive = (line) => {
      if (/^info string ERROR/i.test(line)) {
        receive = null;
        reject(new Error(line));
      } else if (accepts(line)) {
        receive = null;
        resolve(line);
      }
    };
    stockfish.postMessage(command);
  });
}

async function prepare() {
  self.postMessage({progress: '正在下载进阶引擎和象棋模型…'});
  const download = fetch(new URL(model, directory));
  const script = new URL('stockfish.js', directory).href;
  importScripts(script);
  const response = await download;
  if (!response.ok) throw new Error('NNUE HTTP ' + response.status);
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength !== 11261932) throw new Error('Unexpected NNUE size');
  stockfish = await Stockfish({
    locateFile: file => new URL(file, directory).href,
    mainScriptUrlOrBlob: script,
  });
  stockfish.addMessageListener(line => receive?.(line));
  await waitFor('uci', line => line === 'uciok');
  stockfish.FS.writeFile(modelPath, new Uint8Array(buffer));
  stockfish.postMessage('setoption name UCI_Variant value xiangqi');
  stockfish.postMessage('setoption name EvalFile value ' + modelPath);
  stockfish.postMessage('setoption name Use NNUE value true');
  await waitFor('isready', line => line === 'readyok');
}

self.onmessage = async ({data: {id, fen}}) => {
  try {
    if (!stockfish) await prepare();
    stockfish.postMessage('position fen ' + fen);
    self.postMessage({progress: '进阶引擎思考中…'});
    let usingModel = false;
    const result = await waitFor('go movetime 1000', line => {
      if (line.startsWith('info string NNUE evaluation') && line.includes(model) && line.includes('enabled')) usingModel = true;
      return line.startsWith('bestmove ');
    });
    if (!usingModel) throw new Error('Engine did not confirm NNUE evaluation');
    self.postMessage({id, coordinate: result.split(/\s+/)[1]});
  } catch (error) {
    self.postMessage({id, error: error.message});
  }
};
