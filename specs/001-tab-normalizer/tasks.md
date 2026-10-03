# Tasks

## Phase 1: Foundation
- [X] T001 Создать extension/manifest.json и extension/shared/settings.js.
- [X] T002 Реализовать extension/audio/normalizer-core.js и normalizer-worklet.js.

## Phase 2: US1 — Выравнивание
- [X] T003 [US1] Реализовать extension/offscreen.js и offscreen.html с локальной обработкой нескольких вкладок.
- [X] T004 [US1] Реализовать extension/background.js с пользовательским захватом и badge.
- [X] T005 [US1] Проверить tests/dsp.test.js: сходимость громкости, пики, тишина, стерео, настройки.

## Phase 3: US2 — Управление жизненным циклом
- [X] T006 [US2] Проверить ошибки старта, повторные команды, закрытие вкладки, остановку потока и сон worker в tests/background.test.js.

## Phase 4: US3 — Интерфейс
- [X] T007 [US3] Создать extension/popup.html, popup.css, popup.js: русские настройки, сохранение, состояние и уровни.

## Phase 5: Delivery
- [X] T008 Создать demo/ с тестом реального AudioWorklet и резких изменений громкости.
- [X] T009 Проверить manifest, синтаксис, тесты и доступный браузерный runtime; записать результаты в validation.md.
- [X] T010 Создать README.md, package.json и архив расширения; проверить состав.
- [X] T011 Converge: сопоставить реализацию с AC1–AC6, документировать границы фактически выполненной проверки.
