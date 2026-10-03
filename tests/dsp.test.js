import test from 'node:test';
import assert from 'node:assert/strict';
import { NormalizerCore } from '../extension/audio/normalizer-core.js';
import { dbToGain, gainToDb, sanitizeSettings } from '../extension/shared/settings.js';

const rate = 48000;
function render(core, seconds, signal) {
  const length = Math.round(seconds * core.sampleRate);
  const result = [new Float32Array(length), new Float32Array(length)];
  for (let position = 0; position < length; position += 128) {
    const size = Math.min(128, length - position);
    const input = [new Float32Array(size), new Float32Array(size)];
    for (let i = 0; i < size; i++) {
      const sample = signal(position + i);
      input[0][i] = sample[0]; input[1][i] = sample[1];
    }
    const output = [result[0].subarray(position, position + size), result[1].subarray(position, position + size)];
    core.process(input, output);
  }
  return result;
}
const sine = (rmsDb, ratio = 1, sr = rate) => (n) => {
  const x = Math.SQRT2 * dbToGain(rmsDb) * Math.sin(2 * Math.PI * 440 * n / sr);
  return [x, x * ratio];
};
function rmsDb(samples) {
  let power = 0;
  for (const x of samples) power += x * x;
  return gainToDb(Math.sqrt(power / samples.length));
}

test('strong mode brings a 36 dB input range to a common level', () => {
  const levels = [-42, -30, -18, -6].map((db) => {
    const core = new NormalizerCore(rate, { mode: 'strong', targetDb: -18 });
    return rmsDb(render(core, 3, sine(db))[0].subarray(rate * 2));
  });
  const spread = Math.max(...levels) - Math.min(...levels);
  console.log(`Strong mode steady output: ${levels.map(x => x.toFixed(2)).join(', ')} dBFS; spread ${spread.toFixed(3)} dB`);
  assert.ok(spread < 2, `Spread is ${spread} dB`);
  levels.forEach((db) => assert.ok(Math.abs(db + 18) < 3, `Target mismatch: ${db}`));
});

test('sudden quiet-to-loud transitions and impulses stay below the peak ceiling', () => {
  for (const sr of [44100, 48000, 96000]) {
    const core = new NormalizerCore(sr);
    render(core, 1.5, sine(-42, 1, sr));
    const out = render(core, 1, (n) => {
      const x = n % 1703 === 0 ? 4 : Math.sin(n * 0.2) * 0.98;
      return [x, -x * 0.7];
    });
    let max = 0;
    for (const channel of out) for (const x of channel) {
      assert.ok(Number.isFinite(x)); max = Math.max(max, Math.abs(x));
    }
    assert.ok(max <= dbToGain(-1) + 1e-7, `${sr} Hz: ${max}`);
  }
});

test('silence and sub-gate noise do not ramp up gain', () => {
  const core = new NormalizerCore(rate);
  const silence = render(core, 1, () => [0, 0]);
  assert.ok(silence[0].every(x => x === 0));
  assert.equal(core.gain, 1);
  render(core, 2, sine(-85));
  assert.ok(core.gain <= 1);
  render(core, 2, sine(-42));
  const after = render(core, 3, () => [0, 0]);
  assert.ok(after[0].subarray(core.delaySamples).every(x => x === 0));
  assert.ok(core.gain < 1.15);
});

test('linked stereo gain preserves channel balance through limiting', () => {
  const core = new NormalizerCore(rate);
  const out = render(core, 2, sine(-6, 0.25));
  for (let i = 0; i < out[0].length; i++) assert.ok(Math.abs(out[1][i] - out[0][i] * 0.25) < 1e-7);
});

test('target updates affect a running processor and gentle mode keeps more dynamics', () => {
  const core = new NormalizerCore(rate);
  const before = rmsDb(render(core, 2, sine(-30))[0].subarray(rate));
  core.configure({ mode: 'strong', targetDb: -24 });
  const after = rmsDb(render(core, 2, sine(-30))[0].subarray(rate));
  assert.ok(Math.abs(before - after - 6) < 0.4);
  const gentle = [-36, -12].map(db => rmsDb(render(new NormalizerCore(rate, { mode: 'gentle' }), 3, sine(db))[0].subarray(rate * 2)));
  assert.ok(gentle[1] - gentle[0] > 5);
});

test('invalid settings, non-finite input and missing channels remain safe', () => {
  assert.deepEqual(sanitizeSettings({ mode: '__proto__', targetDb: Infinity }), { mode: 'strong', targetDb: -18 });
  assert.deepEqual(sanitizeSettings(null), { mode: 'strong', targetDb: -18 });
  assert.equal(sanitizeSettings({ targetDb: 100 }).targetDb, -12);
  const core = new NormalizerCore(rate);
  const output = [new Float32Array(128), new Float32Array(128)];
  core.process([Float32Array.from({ length: 128 }, () => NaN)], output);
  core.process([], output);
  assert.ok(output.every(channel => channel.every(x => x === 0)));
  assert.ok(Object.values(core.takeLevels()).every(Number.isFinite));
});

test('manual gain supplies 25%, 100% and 600% when smart volume is off and headroom exists', () => {
  for (const volumePercent of [25, 100, 600]) {
    const core = new NormalizerCore(rate, {}, { smartVolume: false, volumePercent });
    const output = rmsDb(render(core, 1, sine(-36))[0].subarray(rate / 2));
    assert.ok(Math.abs(output - (-36 + gainToDb(volumePercent / 100))) < 0.02);
  }
});

test('mute and zero volume immediately silence buffered audio and unmute preserves the set level', () => {
  const core = new NormalizerCore(rate, {}, { smartVolume: false, volumePercent: 250 });
  render(core, 1, sine(-36));
  core.configureControls({ smartVolume: false, volumePercent: 250, muted: true });
  assert.ok(render(core, 0.1, sine(-36))[0].every(value => value === 0));
  core.configureControls({ smartVolume: false, volumePercent: 250, muted: false });
  const resumed = rmsDb(render(core, 1, sine(-36))[0].subarray(rate / 2));
  assert.ok(Math.abs(resumed - (-36 + gainToDb(2.5))) < 0.02);
  core.configureControls({ smartVolume: false, volumePercent: 0 });
  assert.ok(render(core, 0.1, sine(-36))[0].every(value => value === 0));
});

test('disabling smart volume returns to manual gain without recreating the processor', () => {
  const core = new NormalizerCore(rate);
  const before = rmsDb(render(core, 2, sine(-36))[0].subarray(rate));
  core.configureControls({ smartVolume: false, volumePercent: 100 });
  const after = rmsDb(render(core, 1, sine(-36))[0].subarray(rate / 2));
  assert.ok(before > -23);
  assert.ok(Math.abs(after + 36) < 0.02);
});

test('600% boost and aggressive signals stay below the limiter ceiling with and without AGC', () => {
  for (const smartVolume of [true, false]) {
    const core = new NormalizerCore(rate, {}, { smartVolume, volumePercent: 600 });
    const output = render(core, 1, n => [n % 53 === 0 ? 50 : Math.sin(n), -Math.sin(n) * 3]);
    for (const channel of output) for (const value of channel) {
      assert.ok(Number.isFinite(value));
      assert.ok(Math.abs(value) <= dbToGain(-1) + 1e-7);
    }
  }
});
