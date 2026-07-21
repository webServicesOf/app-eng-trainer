import { bufferPeaks } from './RecordCompare';

// Stub AudioBuffer: bufferPeaks only reads getChannelData(0) + sampleRate.
function stub(samples: number[], sampleRate = 10): AudioBuffer {
  const data = Float32Array.from(samples);
  return { sampleRate, getChannelData: () => data } as unknown as AudioBuffer;
}

test('buckets count + max-abs + time mapping', () => {
  // 10 samples @ 10Hz = 1s. Spike at index 5 (t=0.5s).
  const buf = stub([0, 0, 0, 0, 0, -1, 0, 0, 0, 0]);
  const peaks = bufferPeaks(buf, 0, 1, 5); // 5 buckets over full 1s
  expect(peaks).toHaveLength(5);
  // bucket 2 covers samples [4,5] → max abs = 1
  expect(peaks[2].v).toBe(1);
  expect(peaks[0].v).toBe(0);
  // time axis spans [0,1): t = i/buckets * dur
  expect(peaks[0].t).toBeCloseTo(0);
  expect(peaks[4].t).toBeCloseTo(0.8);
});

test('sub-range slice honors start/end seconds', () => {
  const buf = stub([1, 0, 0, 0, 0, 0, 0, 0, 0, 0]); // spike at t=0
  // slice [0.5,1] excludes the spike → all zero
  expect(bufferPeaks(buf, 0.5, 1, 4).every(p => p.v === 0)).toBe(true);
});

test('invalid range → empty', () => {
  const buf = stub([1, 1, 1]);
  expect(bufferPeaks(buf, 1, 0, 4)).toHaveLength(0);
  expect(bufferPeaks(buf, 0, 1, 0)).toHaveLength(0);
});
