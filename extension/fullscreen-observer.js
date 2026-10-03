// Runs only in the top document's isolated extension world after capture starts.
// The completion value lets the worker check current state instead of trusting
// a potentially delayed tabCapture notification.
(() => {
  const key = '__rovnyZvukFullscreenObserver';
  if (!globalThis[key]) {
    const notify = (fullscreen) => {
      try {
        chrome.runtime.sendMessage({ target: 'background', type: 'player-fullscreen', fullscreen })
          .catch(dispose);
      } catch { dispose(); } // Extension reloaded; the old content context is invalid.
    };
    const changed = () => notify(Boolean(document.fullscreenElement));
    const escaped = (event) => {
      if (event.key !== 'Escape' || event.repeat || !event.isTrusted) return;
      // Preserve the site's handlers; do not cancel or stop the key event.
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      notify(false);
    };
    function dispose() {
      document.removeEventListener('fullscreenchange', changed);
      document.removeEventListener('keydown', escaped, true);
      delete globalThis[key];
    }
    document.addEventListener('fullscreenchange', changed);
    document.addEventListener('keydown', escaped, true);
    globalThis[key] = { dispose };
  }
  return Boolean(document.fullscreenElement);
})();
