import { MODES, sanitizeSettings, dbToGain, gainToDb } from '../shared/settings.js';

// Linked stereo RMS automatic gain + lookahead sample-peak limiter.
// The same gain is applied to both channels to keep the stereo image intact.
export class NormalizerCore {
  constructor(sampleRate, settings = {}) {
    if (!Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 384000) {
      throw new RangeError('Unsupported sample rate');
    }
    this.sampleRate = sampleRate;
    this.delaySamples = Math.ceil(sampleRate * 0.005);
    this.size = this.delaySamples + 1;
    this.delay = [new Float32Array(this.size), new Float32Array(this.size)];
    // Monotonic maximum deque, covering exactly the lookahead window.
    this.queueSize = this.size + 1;
    this.peakValues = new Float64Array(this.queueSize);
    this.peakTimes = new Float64Array(this.queueSize);
    this.head = 0;
    this.tail = 0;
    this.position = 0;
    this.power = 0;
    this.gain = 1;
    this.limiterGain = 1;
    this.ceiling = dbToGain(-1);
    this.gatePower = dbToGain(-58) ** 2;
    this.powerAttack = Math.exp(-1 / (sampleRate * 0.012));
    this.powerRelease = Math.exp(-1 / (sampleRate * 0.08));
    this.limiterRelease = Math.exp(-1 / (sampleRate * 0.07));
    this.silenceRelease = Math.exp(-1 / (sampleRate * 0.5));
    this.meterInput = 0;
    this.meterOutput = 0;
    this.meterPeak = 0;
    this.meterFrames = 0;
    this.configure(settings);
  }

  configure(settings) {
    this.settings = sanitizeSettings(settings);
    const mode = MODES[this.settings.mode];
    this.strength = mode.strength;
    this.target = dbToGain(this.settings.targetDb);
    this.maxGain = dbToGain(mode.maxBoostDb);
    this.minGain = dbToGain(-36);
    this.gainRise = Math.exp(-1 / (this.sampleRate * mode.rise));
    this.gainFall = Math.exp(-1 / (this.sampleRate * mode.fall));
  }

  process(input, output) {
    if (!output.length) return;
    const frames = output[0].length;
    const channels = Math.min(2, output.length);
    for (let i = 0; i < frames; i++) {
      let energy = 0;
      for (let c = 0; c < channels; c++) {
        const x = input[c]?.[i] ?? input[0]?.[i] ?? 0;
        energy += Number.isFinite(x) ? x * x : 0;
      }
      energy /= channels;
      const powerCoeff = energy > this.power ? this.powerAttack : this.powerRelease;
      this.power = powerCoeff * this.power + (1 - powerCoeff) * energy;
      let desiredGain;
      let gainCoeff;
      if (this.power < this.gatePower) {
        // Never increase gain for silence or near-silence. This is not a mute gate.
        desiredGain = Math.min(this.gain, 1);
        gainCoeff = this.silenceRelease;
      } else {
        desiredGain = Math.max(this.minGain, Math.min(this.maxGain,
          (this.target / Math.sqrt(this.power)) ** this.strength));
        gainCoeff = desiredGain < this.gain ? this.gainFall : this.gainRise;
      }
      this.gain = gainCoeff * this.gain + (1 - gainCoeff) * desiredGain;
      const write = this.position % this.size;
      let peak = 0;
      for (let c = 0; c < channels; c++) {
        const raw = input[c]?.[i] ?? input[0]?.[i] ?? 0;
        const x = (Number.isFinite(raw) ? raw : 0) * this.gain;
        this.delay[c][write] = x;
        peak = Math.max(peak, Math.abs(x));
      }

      while (this.head !== this.tail &&
          this.peakTimes[this.head] < this.position - this.delaySamples) {
        this.head = (this.head + 1) % this.queueSize;
      }
      while (this.head !== this.tail) {
        const previous = (this.tail + this.queueSize - 1) % this.queueSize;
        if (this.peakValues[previous] > peak) break;
        this.tail = previous;
      }
      this.peakTimes[this.tail] = this.position;
      this.peakValues[this.tail] = peak;
      this.tail = (this.tail + 1) % this.queueSize;
      const windowPeak = this.peakValues[this.head];
      const limit = windowPeak > this.ceiling ? this.ceiling / windowPeak : 1;
      this.limiterGain = Math.min(limit,
        this.limiterRelease * this.limiterGain + (1 - this.limiterRelease) * limit);
      const read = (this.position + 1) % this.size;
      let outEnergy = 0;
      for (let c = 0; c < channels; c++) {
        const delayed = this.position >= this.delaySamples ? this.delay[c][read] : 0;
        const y = Math.max(-this.ceiling, Math.min(this.ceiling, delayed * this.limiterGain));
        output[c][i] = y;
        outEnergy += y * y;
        this.meterPeak = Math.max(this.meterPeak, Math.abs(y));
      }
      for (let c = channels; c < output.length; c++) output[c][i] = 0;
      this.meterInput += energy;
      this.meterOutput += outEnergy / channels;
      this.meterFrames++;
      this.position++;
    }
  }

  takeLevels() {
    const n = Math.max(1, this.meterFrames);
    const levels = {
      inputDb: gainToDb(Math.sqrt(this.meterInput / n)),
      outputDb: gainToDb(Math.sqrt(this.meterOutput / n)),
      peakDb: gainToDb(this.meterPeak),
      gainDb: gainToDb(this.gain * this.limiterGain),
    };
    this.meterInput = this.meterOutput = this.meterPeak = this.meterFrames = 0;
    return levels;
  }
}
