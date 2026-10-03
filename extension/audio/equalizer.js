import { EQ_FREQUENCIES, sanitizeAudioControls } from '../shared/audio-controls.js';

export function createEqualizer(context, controls) {
  const filters = EQ_FREQUENCIES.map((frequency, i) => {
    const filter = context.createBiquadFilter();
    filter.type = i === 0 ? 'lowshelf' : i === EQ_FREQUENCIES.length - 1 ? 'highshelf' : 'peaking';
    filter.frequency.value = Math.min(frequency, context.sampleRate * 0.45);
    filter.Q.value = 1.1;
    return filter;
  });
  for (let i = 1; i < filters.length; i++) filters[i - 1].connect(filters[i]);
  function update(value, initial = false) {
    const bands = sanitizeAudioControls(value).eqBands;
    filters.forEach((filter, i) => {
      if (initial) filter.gain.value = bands[i];
      else {
        filter.gain.cancelAndHoldAtTime(context.currentTime);
        filter.gain.setTargetAtTime(bands[i], context.currentTime, 0.02);
      }
    });
  }
  update(controls, true);
  return { input: filters[0], output: filters.at(-1), filters, update,
    disconnect() { filters.forEach(filter => filter.disconnect()); } };
}
