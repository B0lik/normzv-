# Feature Brief / Execution packet — Volume controls 0.3.0

## Goal / Requirements
Запрос пользователя: «еще хочу добавить войс мастер вот такой … перекачай все его функции в мое расширение и объясни что и для чего надо». Скриншот и указанная карточка Volume Master служат описанием поведения. Реализуем функции в текущем «Ровный звук».

## Existing Context
MV3 0.2.1, Chrome 116+, tabCapture → offscreen → AudioWorklet; RMS-нормализация и lookahead limiter −1 dBFS. Автоподключение все/выбранные сайты, корректный вход/выход fullscreen. Пользователь подтвердил работу. GitHub: B0lik/normzv-, main. 49 тестов.

## Scope / User Flows
- Ползунок и число 0–600% для текущей вкладки; mute/unmute с сохранением уровня; сброс к 100%.
- Smart Volume: переключатель существующей нормализации. Выключение оставляет ручное усиление/EQ и ограничитель пиков.
- Эквалайзер Default/Voice/Bass и ручные 10 полос ±12 dB.
- Светлая/тёмная тема с сохранением.
- Команды Alt+Up/Down (±10%), Alt+M (mute), Alt+Shift+V (popup); пользователь меняет назначения в Chrome. Reset-команда доступна для назначения без пятого suggested shortcut.
- Память громкости, Smart Volume и EQ для сайтов; переключатель запоминания и забывание текущего сайта. Mute хранится только до закрытия вкладки.
- Список звучащих/обрабатываемых вкладок и переключение на них.
- Краткие пояснения в UI и отдельная русская инструкция о назначении каждой функции.
- Новая версия, проверки, ZIP, обновление существующего GitHub.

Не входят бренд/код стороннего расширения, его реклама, мультиязычная локализация карточки магазина, публикация Chrome Web Store и разделение речи/музыки нейросетью.

## Assumptions / Technical Constraints
Smart Volume включена, громкость 100%, EQ Default по умолчанию; существующий результат нормализации сохраняется. Volume/EQ/mute/Smart Volume независимы по вкладкам; режим силы и targetDb существующей нормализации остаются общими. Сайты задаются hostname, лимит памяти 100 сайтов. Theme глобальна. 100% означает отсутствие дополнительного усиления, а не отключение всех эффектов. При 600% итог ограничен запасом сигнала/лимитером; громкость плеера 0 не восстановить. Смена эффектов не перезапускает захват и не ломает fullscreen. Разрешения остаются прежними; commands объявляются в manifest. Доступ к каждой новой вкладке по-прежнему требует вызова расширения.

## Technical Plan / Ordered Tasks / Files
1. shared/audio-controls.js: санитаризация, пресеты и shortcuts; audio-controls.js: local/session preferences и память сайтов.
2. Core: ручное усиление после AGC перед limiter, mute/0%, обход AGC; audio/equalizer.js: сглаженные BiquadFilterNode перед worklet; offscreen: настройки конкретной сессии и очистка.
3. background: команды, настройки вкладок, темы/память, список и переключение звучащих вкладок, восстановление по сайту при навигации. Сериализация существующей очередью.
4. Popup: новые основные элементы, сведения о назначениях клавиш, EQ и темы; существующее авто и fullscreen сохраняются.
5. Meaningful tests: независимость вкладок, память/отключение памяти/смена сайта, shortcuts/clamps/mute, 6× gain/headroom/limiter, AGC bypass, EQ cleanup и обновления без recapture. Browser UI + реальный Web Audio EQ/worklet smoke.
6. 0.3.0: README, guide, validation, ZIP; commit/push GitHub и проверка remote SHA.

## Failure Cases / Definition of Done
Некорректные числа не повреждают сигнал. 0%/mute действительно тишина; mute снимается прежним уровнем. Изменение одной вкладки не меняет другие. Ошибка старта не показывает ложный ON; настройки можно повторить. Keyboard conflict отображается фактическим getAll shortcut, а не обещанием. Все проверки проходят; реальные tabCapture/commands внешних плееров в обычном Chrome не выдаются за проверенные в доступном IAB.

## Sources
- https://chromewebstore.google.com/detail/volume-master-%E2%80%93-volume-bo/ofhcpjnedbemoknknjpdcbhfielakpbk — 4.5.3, перечень функций и сочетания.
- https://developer.chrome.com/docs/extensions/reference/api/commands — supported keys, четыре suggested shortcuts, getAll.
- https://webaudio.github.io/web-audio-api — BiquadFilterNode и AudioParam.

## Result / Convergence
Все пункты реализации выполнены: независимые аудионастройки, EQ, Smart Volume bypass, темы/память, commands и список вкладок. 62 теста и статическая проверка прошли. Браузерные Web Audio и UI проверки описаны в [validation.md](validation.md); руководство — [volume-controls.md](../../docs/volume-controls.md). Архив 0.3.0 проверен: 17 файлов расширения, manifest в корне, пять commands. Исходники подготовлены для обновления main существующего GitHub-репозитория.
