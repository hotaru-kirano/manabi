import test from 'node:test';
import assert from 'node:assert/strict';
import { Recognizer, encodeTemplate, resample } from '../public/js/handwriting.js';

// Hand-made templates in a 100x100 box.
const SHAPES = {
  一: [[[10, 50], [90, 50]]],
  二: [[[25, 30], [75, 30]], [[10, 75], [90, 75]]],
  十: [[[10, 50], [90, 50]], [[50, 10], [50, 90]]],
  人: [[[50, 10], [15, 90]], [[50, 35], [88, 90]]],
  口: [[[20, 20], [20, 80]], [[20, 20], [80, 20], [80, 80]], [[20, 80], [80, 80]]],
};
const rec = new Recognizer(Object.entries(SHAPES).map(([ch, s]) => `${ch}\t0${encodeTemplate(s)}`).join('\n'));
const moved = (strokes, scale, dx, dy) => strokes.map((s) => s.map(([x, y]) => [x * scale + dx, y * scale + dy]));

test('resample keeps the end points and spaces the rest evenly', () => {
  assert.deepEqual(resample([[0, 0], [10, 0]], 3), [[0, 0], [5, 0], [10, 0]]);
});

test('recognises a drawing regardless of size and position', () => {
  for (const ch of Object.keys(SHAPES)) assert.equal(rec.recognize(moved(SHAPES[ch], 2.7, 140, 30))[0], ch);
});

test('tolerates wrong stroke order and direction', () => {
  const wrongOrder = [SHAPES.十[1], SHAPES.十[0]];
  assert.equal(rec.recognize(wrongOrder)[0], '十');
  const backwards = [SHAPES.人[0], [...SHAPES.人[1]].reverse()];
  assert.equal(rec.recognize(backwards)[0], '人');
});
