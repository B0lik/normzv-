const $ = id => document.getElementById(id);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const gain = db => 10 ** (db / 20);
let toneContext;
let toneTimer;

$('smoke').addEventListener('click', async () => {
  $('smoke').disabled = true;
  $('result').textContent = 'Загрузка AudioWorklet…';
  let context;
  try {
    context = new AudioContext();
    await context.resume();
    await context.audioWorklet.addModule('/extension/audio/normalizer-worklet.js');
    const node = new AudioWorkletNode(context, 'tab-normalizer', {
      numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2],
      channelCount: 2, channelCountMode: 'explicit',
      processorOptions: { settings: { mode: 'strong', targetDb: -18 } },
    });
    const oscillator = context.createOscillator();
    oscillator.frequency.value = 440;
    const level = context.createGain();
    const mute = context.createGain();
    mute.gain.value = 0;
    oscillator.connect(level).connect(node).connect(mute).connect(context.destination);
    let measurements = [];
    let failure;
    node.onprocessorerror = () => { failure = new Error('AudioWorklet processorerror'); };
    node.port.onmessage = ({ data }) => measurements.push(data);
    oscillator.start();
    const outputs = [];
    let maxPeak = -120;
    for (const db of [-42, -6, -30]) {
      measurements = [];
      level.gain.setValueAtTime(Math.SQRT2 * gain(db), context.currentTime);
      $('result').textContent = `Проверяем вход ${db} dBFS…`;
      await sleep(2000);
      if (failure) throw failure;
      if (!measurements.length) throw new Error('Нет данных от аудиопотока.');
      const tail = measurements.slice(-4);
      const output = tail.reduce((sum, m) => sum + m.outputDb, 0) / tail.length;
      outputs.push(output);
      maxPeak = Math.max(maxPeak, ...measurements.map(m => m.peakDb));
    }
    const spread = Math.max(...outputs) - Math.min(...outputs);
    if (spread > 2 || maxPeak > -0.99) throw new Error(`Разброс ${spread.toFixed(2)} dB, пик ${maxPeak.toFixed(2)} dBFS`);
    oscillator.stop();
    $('result').textContent = `PASS — AudioWorklet работает в браузере\nЧастота: ${context.sampleRate} Hz\nВыход: ${outputs.map(db => db.toFixed(2)).join(', ')} dBFS\nРазброс: ${spread.toFixed(3)} dB\nМаксимальный пик: ${maxPeak.toFixed(2)} dBFS`;
    document.documentElement.dataset.smoke = 'pass';
  } catch (error) {
    $('result').textContent = 'FAIL — ' + error.message;
    document.documentElement.dataset.smoke = 'fail';
  } finally {
    await context?.close();
    $('smoke').disabled = false;
  }
});

$('tone').addEventListener('click', async () => {
  if (toneContext) {
    clearInterval(toneTimer);
    await toneContext.close(); toneContext = null;
    $('tone').textContent = 'Воспроизвести тестовый тон';
    $('tone-status').textContent = 'Тон выключен.';
    return;
  }
  toneContext = new AudioContext();
  await toneContext.resume();
  const oscillator = toneContext.createOscillator();
  oscillator.frequency.value = 440;
  const level = toneContext.createGain();
  oscillator.connect(level).connect(toneContext.destination);
  let step = 0;
  const change = () => {
    const db = [-42, -30, -18, -6][step++ % 4];
    level.gain.setValueAtTime(Math.SQRT2 * gain(db), toneContext.currentTime);
    $('tone-status').textContent = `Вход: ${db} dBFS. Следующая смена через 4 секунды.`;
  };
  change(); oscillator.start();
  toneTimer = setInterval(change, 4000);
  $('tone').textContent = 'Остановить тон';
});
