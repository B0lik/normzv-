import { sanitizeSettings } from './shared/settings.js';

const sessions = new Map();
const errors = new Map();
let commands = Promise.resolve();

async function withTimeout(promise, label) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(label)), 8000);
    })]);
  } finally { clearTimeout(timer); }
}

function getStatus(tabId) {
  const s = sessions.get(tabId);
  return { ok: true, active: !!s, autoOwned: !!s?.automatic, levels: s?.levels ?? null, error: errors.get(tabId) ?? null };
}

async function dispose(session) {
  session.node?.disconnect();
  if (session.node) session.node.port.onmessage = null;
  session.source?.disconnect();
  session.stream?.getTracks().forEach((track) => track.stop());
  if (session.context && session.context.state !== 'closed') {
    await session.context.close().catch(() => {});
  }
}

async function stop(tabId, failure, expectedSession) {
  const session = sessions.get(tabId);
  if (!session || (expectedSession && expectedSession !== session)) return;
  sessions.delete(tabId);
  if (failure) errors.set(tabId, failure);
  else errors.delete(tabId);
  await dispose(session);
  if (failure) {
    chrome.runtime.sendMessage({ target: 'background', type: 'session-ended', tabId }).catch(() => {});
  }
}

async function start({ tabId, streamId, settings, automatic }) {
  if (sessions.has(tabId)) return getStatus(tabId);
  errors.delete(tabId);
  const session = { automatic: !!automatic };
  try {
    // The stream ID expires quickly; consume it before loading the processor.
    let awaitingStream = true;
    const pendingStream = navigator.mediaDevices.getUserMedia({
      audio: {
        // Chrome's tab-capture constraints use the legacy format; do not mix in modern siblings.
        mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId },
      },
      video: false,
    }).then((stream) => {
      // A stream arriving after timeout must not keep the original tab muted.
      if (!awaitingStream) stream.getTracks().forEach((track) => track.stop());
      return stream;
    });
    try {
      session.stream = await withTimeout(pendingStream, 'Вкладка не предоставила звук вовремя. Попробуйте ещё раз.');
    } finally { awaitingStream = false; }
    const tracks = session.stream.getAudioTracks();
    if (!tracks.length) throw new Error('Вкладка не предоставила аудиопоток.');
    session.context = new AudioContext({ latencyHint: 'interactive' });
    await withTimeout(session.context.audioWorklet.addModule('audio/normalizer-worklet.js'),
      'Не удалось загрузить обработчик звука.');
    session.node = new AudioWorkletNode(session.context, 'tab-normalizer', {
      numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2],
      channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'speakers',
      processorOptions: { settings: sanitizeSettings(settings) },
    });
    session.source = session.context.createMediaStreamSource(session.stream);
    session.source.connect(session.node).connect(session.context.destination);
    await withTimeout(session.context.resume(), 'Браузер не разрешил воспроизведение. Отключите и включите обработку снова.');
    if (session.context.state !== 'running' || tracks.some((track) => track.readyState === 'ended')) {
      throw new Error('Аудиопоток завершился при запуске. Попробуйте включить снова.');
    }
    sessions.set(tabId, session);
    session.node.port.onmessage = ({ data }) => { session.levels = data; };
    session.node.onprocessorerror = () => {
      stop(tabId, 'Обработчик остановился. Исходный звук восстановлен; включите обработку снова.', session);
    };
    for (const track of tracks) {
      track.addEventListener('ended', () => {
        stop(tabId, 'Захват звука завершён. Включите обработку снова.', session);
      }, { once: true });
    }
    session.context.onstatechange = () => {
      if (session.context.state === 'suspended' || session.context.state === 'closed') {
        stop(tabId, 'Браузер остановил аудиообработку. Включите её снова.', session);
      }
    };
    return getStatus(tabId);
  } catch (error) {
    await dispose(session);
    throw new Error(`Не удалось включить нормализацию: ${error.message}`);
  }
}

async function handle(message) {
  switch (message.type) {
    case 'sessions': return { ok: true, sessions: [...sessions].map(([tabId, s]) => ({ tabId, autoOwned: s.automatic })) };
    case 'status': return getStatus(message.tabId);
    case 'start': return start(message);
    case 'stop':
      await stop(message.tabId);
      errors.delete(message.tabId);
      return getStatus(message.tabId);
    case 'settings':
      for (const session of sessions.values()) {
        session.node.port.postMessage({ type: 'settings', settings: sanitizeSettings(message.settings) });
      }
      return { ok: true };
    default: throw new Error('Неизвестная команда обработки.');
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.target !== 'offscreen' || sender.id !== chrome.runtime.id) return;
  const task = commands.then(() => handle(message));
  commands = task.catch(() => {});
  task.then(sendResponse).catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});
