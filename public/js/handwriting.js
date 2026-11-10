// Kanji handwriting recognition by stroke matching against KanjiVG-derived templates.
// Shared by the build script (which encodes the templates), the worker and the tests.
//
// A character is reduced to its strokes; every stroke to POINTS points spaced evenly along it;
// every coordinate to 0..63 inside the character's own bounding square. Matching compares strokes
// point by point. It tolerates wrong stroke order, reversed strokes and a stroke or two too many/few,
// but correct order always scores best.

export const POINTS = 6;
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const B64_VALUE = new Uint8Array(128);
for (let i = 0; i < 64; i++) B64_VALUE[B64.charCodeAt(i)] = i;

/** Evenly re-space a polyline [[x,y],...] to exactly n points. */
export function resample(points, n = POINTS) {
  if (points.length === 1) return Array.from({ length: n }, () => points[0]);
  const seg = [];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const d = Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
    seg.push(d);
    total += d;
  }
  if (total === 0) return Array.from({ length: n }, () => points[0]);
  const out = [points[0]];
  let i = 0, walked = 0;
  for (let k = 1; k < n - 1; k++) {
    const target = (total * k) / (n - 1);
    while (i < seg.length - 1 && walked + seg[i] < target) walked += seg[i++];
    const t = seg[i] ? (target - walked) / seg[i] : 0;
    out.push([points[i][0] + (points[i + 1][0] - points[i][0]) * t, points[i][1] + (points[i + 1][1] - points[i][1]) * t]);
  }
  out.push(points[points.length - 1]);
  return out;
}

/**
 * strokes: array of polylines in any coordinate system.
 * Returns a Float32Array (strokes * POINTS * 2) scaled to 0..63 within the drawing's bounding square.
 */
export function normalizeStrokes(strokes) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of strokes) for (const [x, y] of s) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  const size = Math.max(maxX - minX, maxY - minY) || 1;
  const offX = (minX + maxX) / 2 - size / 2, offY = (minY + maxY) / 2 - size / 2;
  const out = new Float32Array(strokes.length * POINTS * 2);
  let o = 0;
  for (const s of strokes) for (const [x, y] of resample(s)) {
    out[o++] = ((x - offX) / size) * 63;
    out[o++] = ((y - offY) / size) * 63;
  }
  return out;
}

export function encodeTemplate(strokes) {
  let s = '';
  for (const v of normalizeStrokes(strokes)) s += B64[Math.max(0, Math.min(63, Math.round(v)))];
  return s;
}

const STRIDE = POINTS * 2;
const MAX = 40; // most strokes we handle

export class Recognizer {
  /** @param {string} text lines of "<kanji>\t<prior digit><encoded strokes>" */
  constructor(text) {
    const lines = text.split('\n').filter(Boolean);
    this.chars = [];
    this.prior = new Uint8Array(lines.length);
    this.count = new Uint8Array(lines.length);
    this.offset = new Uint32Array(lines.length);
    let total = 0;
    for (const l of lines) total += l.length - l.indexOf('\t') - 2;
    this.data = new Uint8Array(total);
    let o = 0;
    lines.forEach((line, i) => {
      const tab = line.indexOf('\t');
      this.chars.push(line.slice(0, tab));
      this.prior[i] = line.charCodeAt(tab + 1) - 48;
      this.offset[i] = o;
      this.count[i] = (line.length - tab - 2) / STRIDE;
      for (let j = tab + 2; j < line.length; j++) this.data[o++] = B64_VALUE[line.charCodeAt(j)];
    });
  }

  /** Mean point distance between input stroke a and template stroke b, as a fraction of the box. */
  strokeCost(input, a, t, b) {
    const { data } = this;
    let fwd = 0, rev = 0;
    for (let p = 0; p < POINTS; p++) {
      const x = input[a + p * 2], y = input[a + p * 2 + 1];
      let dx = x - data[t + b + p * 2], dy = y - data[t + b + p * 2 + 1];
      fwd += Math.sqrt(dx * dx + dy * dy);
      const q = POINTS - 1 - p;
      dx = x - data[t + b + q * 2]; dy = y - data[t + b + q * 2 + 1];
      rev += Math.sqrt(dx * dx + dy * dy);
    }
    return Math.min(fwd, rev + POINTS * 4) / (POINTS * 63);
  }

  /** Fill `cost` (n x m, row stride MAX) for template i; returns the mean of the row minima (a lower bound). */
  costMatrix(input, n, i, cost) {
    const m = this.count[i], t = this.offset[i];
    let bound = 0;
    for (let a = 0; a < n; a++) {
      let min = Infinity;
      for (let b = 0; b < m; b++) {
        const c = this.strokeCost(input, a * STRIDE, t, b * STRIDE);
        cost[a * MAX + b] = c;
        if (c < min) min = c;
      }
      bound += min;
    }
    return bound / n;
  }

  /**
   * @param {number[][][]} strokes user strokes as polylines
   * @returns {string[]} best matching kanji, best first
   */
  recognize(strokes, limit = 12) {
    strokes = strokes.filter((s) => s.length);
    const n = strokes.length;
    if (!n || n > MAX) return [];
    const input = normalizeStrokes(strokes);
    const slack = n <= 3 ? 1 : 2;
    const cost = new Float32Array(MAX * MAX);

    // Pass 1: cheap lower bound for every template with a plausible stroke count.
    const shortlist = [];
    for (let i = 0; i < this.chars.length; i++) {
      const m = this.count[i];
      if (Math.abs(m - n) > slack || m > MAX) continue;
      shortlist.push([this.costMatrix(input, n, i, cost), i]);
    }
    shortlist.sort((x, y) => x[0] - y[0]);

    // Pass 2: proper stroke assignment for the most promising ones.
    const usedA = new Uint8Array(MAX), usedB = new Uint8Array(MAX);
    const results = [];
    for (const [, i] of shortlist.slice(0, 150)) {
      const m = this.count[i];
      this.costMatrix(input, n, i, cost);
      // Same count, same order.
      let ordered = Infinity;
      if (m === n) {
        ordered = 0;
        for (let a = 0; a < n; a++) ordered += cost[a * MAX + a];
        ordered /= n;
      }
      // Any order: repeatedly pair the closest unmatched strokes.
      usedA.fill(0); usedB.fill(0);
      let free = 0;
      const pairs = Math.min(n, m);
      for (let k = 0; k < pairs; k++) {
        let best = Infinity, ba = 0, bb = 0;
        for (let a = 0; a < n; a++) {
          if (usedA[a]) continue;
          for (let b = 0; b < m; b++) {
            if (!usedB[b] && cost[a * MAX + b] < best) { best = cost[a * MAX + b]; ba = a; bb = b; }
          }
        }
        usedA[ba] = usedB[bb] = 1;
        free += best;
      }
      free = (free + 0.25 * Math.abs(n - m)) / Math.max(n, m) + 0.015;

      // Small prior so that everyday kanji win ties against rare look-alikes.
      results.push([Math.min(ordered, free) + this.prior[i] * 0.004, i]);
    }
    results.sort((x, y) => x[0] - y[0]);
    return results.slice(0, limit).map(([, i]) => this.chars[i]);
  }
}
