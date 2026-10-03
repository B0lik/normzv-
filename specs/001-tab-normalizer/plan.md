# Execution packet / План

## Goal
Создать устанавливаемое расширение Chrome, уменьшающее разброс громкости звука вкладки.

## Existing Context
Новый проект в C:\normzv; исходного кода и тестов нет. Spec Kit инициализирован. Node 24 доступен. Проверены официальные документы Chrome tabCapture/offscreen и Web Audio через Context7.

## Requirements / Assumptions
Источник требований: spec.md. Ручной захват после действия пользователя, локальная обработка, сильный режим по умолчанию. Без внешних библиотек и без сервера.

## Technical Plan
- extension/manifest.json: MV3, activeTab, tabCapture, offscreen, storage; без host_permissions.
- background.js: только координация, создание offscreen, получение одноразового stream ID, обработка ошибок и badge. Источник истины о сессиях — offscreen, переживающий сон service worker.
- offscreen.js: MediaStream → AudioWorkletNode → destination; отдельная сессия для каждой вкладки, корректное закрытие потоков и AudioContext.
- audio/normalizer-core.js: связанный по стерео RMS AGC, разные времена уменьшения/увеличения gain, ограничение усиления, защита от разгона шума в тишине, 5 ms lookahead peak limiter. Это sample-peak/RMS DSP, без обещания LUFS/true-peak стандарта.
- audio/normalizer-worklet.js: обработка на аудиопотоке и редкая телеметрия через MessagePort.
- popup: русский интерфейс, три режима, громкость, вход/выход/gain, включение и остановка.
- tests/: Node test runner для DSP и координации с замоканными Chrome API; demo/: реальный Web Audio smoke без разрешений расширения и тестовая страница с разной громкостью.

## Ordered Tasks
См. tasks.md. Сначала DSP и контракт настроек, затем жизненный цикл, интерфейс, проверки, упаковка и инструкция.

## Validation / Definition of Done
Автоматические тесты DSP и жизненного цикла, статическая проверка manifest/путей/синтаксиса, браузерный smoke AudioWorklet при доступном браузере. Проверка реального tabCapture на внешних плеерах выполняется вручную при загрузке расширения; непроверенные условия явно документируются. Готовая папка extension и ZIP для распаковки; не заявлять публикацию или гарантированную совместимость всех плееров.

## Research
- https://developer.chrome.com/docs/extensions/how-to/web-platform/screen-capture
- https://developer.chrome.com/docs/extensions/reference/api/tabCapture
- https://webaudio.github.io/web-audio-api/

Chrome 116 позволяет получать stream ID в service worker и использовать его в offscreen. Захват отключает обычный вывод вкладки, поэтому обязателен вывод обработанного потока в AudioContext.destination. USER_MEDIA используется для фонового документа. Не нужен доступ к микрофону или DOM страниц.
