import { positionFromFen } from '../shared/rules.js';
import { search } from '../server/engine/fallback.js';

self.onmessage = ({data: fen}) => {
  try {
    const { candidates } = search(positionFromFen(fen), { depth: 3, timeMs: 450 });
    self.postMessage({ move: candidates[0]?.move });
  } catch {
    self.postMessage({ error: true });
  }
};
