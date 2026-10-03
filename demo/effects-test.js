import { createEqualizer } from '/extension/audio/equalizer.js';
const result = document.querySelector('#result');
const button = document.querySelector('#test');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const dbGain = db => 10 ** (db / 20);
const check = (condition, text) => { if (!condition) throw new Error(text); };
button.addEventListener('click', async () => {
  button.disabled = true;
  let context;
  try {
    context = new AudioContext(); await context.resume();
    result.textContent = 'Проверяем частотные характеристики…';
    const response = (preset, frequency, bands) => {
      const eq = createEqualizer(context, { eqPreset: preset, eqBands: bands });
      let magnitude = 1;
      for (const filter of eq.filters) {
        const mag = new Float32Array(1), phase = new Float32Array(1);
        filter.getFrequencyResponse(new Float32Array([frequency]), mag, phase);
        magnitude *= mag[0];
      }
      eq.disconnect(); return 20 * Math.log10(magnitude);
    };
    const flat = response('default', 1000);
    const bass = response('bass', 62);
    const voice = response('voice', 2000);
    const lowVoice = response('voice', 125);
    const custom = response('custom', 1000, [0, 0, 0, 0, 0, 8, 0, 0, 0, 0]);
    check(Math.abs(flat) < 0.01 && bass > 3 && voice > 2 && lowVoice < -1 && custom > 7.5, 'Неверная частотная характеристика EQ');
    await context.audioWorklet.addModule('/extension/audio/normalizer-worklet.js');
    const node = new AudioWorkletNode(context, 'tab-normalizer', {
      numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: 'explicit',
      processorOptions: { controls: { smartVolume: false, volumePercent: 100 } },
    });
    const oscillator = context.createOscillator(); oscillator.frequency.value = 440;
    const sourceGain = context.createGain(); sourceGain.gain.value = Math.SQRT2 * dbGain(-42);
    const eq = createEqualizer(context);
    const silentOutput = context.createGain(); silentOutput.gain.value = 0;
    oscillator.connect(sourceGain).connect(eq.input); eq.output.connect(node).connect(silentOutput).connect(context.destination);
    let measurements = [], processorFailed = false;
    node.onprocessorerror = () => { processorFailed = true; };
    node.port.onmessage = ({ data }) => measurements.push(data);
    oscillator.start();
    const controls = async value => {
      measurements = []; node.port.postMessage({ type: 'controls', controls: value });
      await sleep(600);
      check(!processorFailed && measurements.length > 0, 'AudioWorklet не вернул данные');
      return measurements.at(-1);
    };
    result.textContent = 'Проверяем 100% → 600% и mute…';
    const normal = await controls({ smartVolume: false, volumePercent: 100 });
    const boosted = await controls({ smartVolume: false, volumePercent: 600 });
    const difference = boosted.outputDb - normal.outputDb;
    check(Math.abs(difference - 20 * Math.log10(6)) < 0.08, `600%: прибавка ${difference} dB`);
    const muted = await controls({ smartVolume: false, volumePercent: 600, muted: true });
    check(muted.outputDb <= -119, 'Mute не заглушил выход');
    const zero = await controls({ smartVolume: false, volumePercent: 0 });
    check(zero.outputDb <= -119, '0% не заглушил выход');
    eq.update({ eqPreset: 'bass' }); oscillator.frequency.value = 62;
    sourceGain.gain.setValueAtTime(Math.SQRT2 * dbGain(-6), context.currentTime);
    result.textContent = 'Проверяем Bass + 600% и защиту пиков…';
    const limited = await controls({ smartVolume: false, volumePercent: 600 });
    check(measurements.every(value => value.peakDb <= -0.99), 'Перегруз после EQ/усиления');
    oscillator.stop();
    result.textContent = `PASS — настоящий EQ и AudioWorklet\nЧастота: ${context.sampleRate} Hz\nDefault 1 kHz: ${flat.toFixed(2)} dB\nBass 62 Hz: +${bass.toFixed(2)} dB\nVoice 2 kHz: +${voice.toFixed(2)} dB; 125 Hz: ${lowVoice.toFixed(2)} dB\nСвоя полоса 1 kHz: +${custom.toFixed(2)} dB\n100% → 600%: +${difference.toFixed(3)} dB\nMute: ${muted.outputDb.toFixed(0)} dBFS; 0%: ${zero.outputDb.toFixed(0)} dBFS\nBass + 600%: пик ${limited.peakDb.toFixed(2)} dBFS`;
    document.documentElement.dataset.smoke = 'pass';
  } catch (error) {
    result.textContent = 'FAIL — ' + error.message; document.documentElement.dataset.smoke = 'fail';
  } finally { await context?.close(); button.disabled = false; }
});
