# Исправление выхода из fullscreen / Execution packet

- **Goal:** «на те же кнопки и выход из полноэкранного режима что бы не нажимать F11 всю жизнь».
- **Existing Context:** 0.2.0 разворачивает окно через windows.update при fullscreen захваченной вкладки; выход зависит только от tabCapture.onStatusChanged. Звук обрабатывается независимо в offscreen.
- **Requirements:** повторная кнопка плеера и Escape возвращают прежнее normal/maximized окно; звук продолжается; ранее развёрнутые пользователем окна не присваиваются расширением.
- **Assumptions:** плеер использует стандартный Fullscreen API. Верхний документ получает fullscreenchange и при полноэкранном дочернем iframe. Сохраняется резервный сигнал tabCapture при недоступности инъекции.
- **Technical Plan:** добавить isolated-world наблюдатель fullscreenchange/Escape через scripting + activeTab; запускать после успешного захвата и при обновлении активной сессии. Читать актуальное DOM-состояние при capture events, чтобы задержанный fullscreen=true не развернул окно обратно. Привязывать сообщения к sender.tab, принимать только верхний frame. Проверять текущее состояние окна перед очисткой владения по bounds event.
- **Files:** fullscreen.js, fullscreen-observer.js, background.js, manifest, соответствующие тесты; README, версия и ZIP 0.2.1.
- **Ordered Tasks:** 1. регрессии выхода/задержанных событий; 2. наблюдатель и интеграция; 3. полный набор проверок, документация и архив.
- **Validation / DoD:** кнопка плеера/DOM exit и Escape восстанавливают normal/maximized, повторные и задержанные события не возвращают fullscreen, iframe отражается в родительском документе, пользовательский fullscreen сохраняется, инъекция не ломает запуск звука при отказе. Автоматические проверки проходят. Нативное окно Chrome в доступном браузере не управляется; проверку двух внешних плееров нельзя выдавать за выполненную.

API: https://developer.chrome.com/docs/extensions/reference/api/scripting и https://developer.chrome.com/docs/extensions/develop/concepts/activeTab.

## Реализация и проверка 0.2.1

- fullscreen-observer.js возвращает актуальное наличие fullscreenElement и сообщает worker об изменениях/доверенном Escape. Повторная инъекция не дублирует обработчики. Контекст после перезагрузки расширения удаляет устаревшие слушатели при отказе сообщения.
- background привязывает сигнал к sender.tab.id/frameId=0, отбрасывает подставленный tabId и любые другие команды из content context. Наблюдатель устанавливается после старта звука и повторно при событиях вкладки; отказ инъекции или управления окном не проваливает успешный аудиозапуск.
- Проверки сначала воспроизвели сбой: 3 новых сценария падали на прежнем коде. После исправления весь набор: **49/49 pass**, статическая проверка manifest/permissions/imports/syntax: **10 JS файлов OK**.
- Браузерный smoke: настоящий DOM Fullscreen API + production observer + production fullscreen manager, но Chrome windows/storage/scripting имитируются. Повторное нажатие одной кнопки: false/maximized → true/fullscreen → false/maximized. Escape: true/fullscreen → false/maximized. Cross-origin iframe localhost внутри 127.0.0.1: родитель получает true при входе и false при выходе той же кнопкой iframe. Вход во вложенный frame был выполнен force-click после визуальной проверки из-за ошибки hit-test доступного браузера; выход обычным click. Консоль: ошибок/предупреждений нет.
- Скриншот: `C:/normzv/artifacts/fullscreen-exit-smoke.png`. Для воспроизведения: `npm run demo`, затем `/demo/fullscreen-test.html`. Страницы demo не входят в ZIP расширения.
- Обычный Chrome с native windows.update + tabCapture на YouTube и brogiro в среде недоступен. Полную runtime-проверку внешних плееров не выдаём за выполненную. Пользователю нужны перезагрузка расширения, обновление вкладки с видео и повторное включение звука.
- ZIP `dist/rovny-zvuk-0.2.1.zip` проверен: 14 рабочих файлов, manifest 0.2.1 в корне, fullscreen-observer.js включён, demo/preview/tests исключены. Версия manifest/package/popup согласована. Временные браузерная вкладка и demo-сервер закрыты.

Источники DOM-поведения: [MDN fullscreenchange](https://developer.mozilla.org/en-US/docs/Web/API/Document/fullscreenchange_event), [Fullscreen Standard](https://fullscreen.spec.whatwg.org/).
