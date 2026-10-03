import { NormalizerCore } from './normalizer-core.js';

class NormalizerProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.core = new NormalizerCore(sampleRate, options.processorOptions?.settings);
    this.frames = 0;
    this.port.onmessage = ({ data }) => {
      if (data?.type === 'settings') this.core.configure(data.settings);
    };
  }

  process(inputs, outputs) {
    this.core.process(inputs[0] ?? [], outputs[0] ?? []);
    this.frames += outputs[0]?.[0]?.length ?? 0;
    if (this.frames >= sampleRate / 10) {
      this.port.postMessage(this.core.takeLevels());
      this.frames = 0;
    }
    return true;
  }
}

registerProcessor('tab-normalizer', NormalizerProcessor);
