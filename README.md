# 🛡️ Dota 2 Realtime Cognitive Co-Pilot & Strategic Assistant (Patch 7.41f)

Комплексный соревновательный ассистент реального времени для Dota 2 с двухуровневой когнитивной архитектурой (System-1 ⇄ System-2), работающий по официальному протоколу **Valve Game State Integration (GSI)**.

> **100% VAC-Safe:** Читает только официальные исходящие HTTP-пакеты движка Source 2. Не взаимодействует с памятью процесса игры, не внедряет DLL и не нарушает правила Valve Anti-Cheat.

---

## 🏛️ Архитектура системы

Двухконтурная разделенная архитектура: непрерывный локальный тактический контур (System-1) и ручной стратегический контур (System-2):

```
                   DOTA 2 (Source 2 Client)
                              │
                     [HTTP POST /gsi]
                     (Strict Token Auth)
                              ▼
                        State Manager
                              │
                              ▼
                     Game Session Manager ──── (Atomic Reset on new matchid)
                              │
                              ▼
                         State Engine
                              │
                              ▼
                      Shared World Model
                              │
        ┌─────────────────────┴─────────────────────┐
        ▼                                           ▼
   Event Engine                               Laya System-1
 (Every-Tick Zone &                         (ModernBERT-large
  Roshan & Economy)                          Local Microservice ~35ms)
        │                                           │
        │ [Zero Gemini Calls]                       │ [100% Local Inference,
        │                                           │  NO Gemini Escalation]
        ▼                                           ▼
   Recent Events                              Tactical Action & Gank Risk
        │                                           │
        └─────────────────────┬─────────────────────┘
                              ▼
                     Dashboard / WebSocket
                   (Live Realtime Telemetry)


   ────────────────── РУЧНОЙ КОНТУР GEMINI (SYSTEM-2) ──────────────────

                     USER clicks "ASK GEMINI"
                              │
                              ▼
                AdvisorService.askManualQuestion()
                              │
                              ▼
                       Decision Router
                 (Enforces: MANUAL-ONLY policy)
                 (Debounces rapid user spam <2s)
                              │
                              ▼
                    Gemini Budget Manager
                (Atomic reserveSlot: 15 RPM / 500 RPD)
                              │
                              ▼
                        Gemini Gateway
                 (invocationType === 'manual')
                 (12s AbortController & Schema Validator)
                              │
                              ▼
                       Gemini System-2
                 (Gemini 2.5/3.5 Flash Lite API)
                              │
                              ▼
                     Updated Strategic Plan
                              │
                              ▼
                     Outcome Tracker (60s)
                              │
                              ▼
                     Dashboard / WebSocket
```

---

## 🛡️ Принципы достоверности и безопасности данных (No Hallucination)

1. **Gemini строго по ручному запросу (Manual-Only Invariant):**
   * Никакие фоновые игровые события (`hero_death`, `plan_violated`, `plan_completed`, `roshan`, `item_power_spike`) не расходуют квоту Gemini.
   * Laya System-1 анализирует оперативную обстановку локально на процессоре/видеокарте игрока каждые ~2.5 секунды с нулевыми сетевыми вызовами к Gemini.
   * Защита реализована на двух независимых рубежах:
     - **Рубеж 1 (`DecisionRouter`):** безусловно отклоняет любые не-`MANUAL` триггеры с ошибкой `Gemini is manual-only`.
     - **Рубеж 2 (`GeminiGateway`):** при любом вызове, где `invocationType !== 'manual'`, немедленно возвращает `error: 'MANUAL_ONLY'` до выполнения сетевых запросов и без списания бюджета квоты.
2. **Туман войны (Fog of War) и режим наблюдений (`observationMode`):**
   * В режиме одиночного игрока GSI передает данные исключительно о состоянии клиента вашего персонажа (`player_gsi_fow_restricted`). Движок Valve строго отсекает данные о скрытых врагах в тумане войны на уровне сервера.
   * `ObservationCollector` служит модулем телеметрии и приема наблюдений (из спектаторского GSI или симуляции); система никогда не фальсифицирует координаты невидимых врагов. Все наблюдения имеют источники (`gsi`, `mock`, `inferred`, `unknown`) и шкалу свежести (`fresh` < 15с, `stale` 15–60с, `expired` > 60с).
3. **Фактические данные Dota2ProTracker (7.41f) и Происхождение (Provenance):**
   * Все рекомендации строятся на проверенных снапшотах меты из папки `data/d2pt/*.json` со строгой фиксацией происхождения (`sourceUrl`, `fetchedAt`, `dataAgeDays`, `extractionMethod: "static_snapshot"`, `confidenceNotes`). Снапшоты старше 7 дней или другого патча маркируются как `isStale`.
   * Синтетическая генерация данных исключена: если героя нет в базе снапшотов, система честно возвращает `targetItem: null, d2ptAvailable: false, recommendationSource: 'none'`, позволяя Gemini сформировать совет из фундаментального знания патча и текущего инвентаря игрока без навязывания ложных шаблонов.
4. **Идентичность предметов (Item Identity):**
   * Разделены строгие проверки: `ownsExactItem` (точное совпадение слота/алиаса) и `satisfiesRequirement` (компонентное удовлетворение: `Manta Style` удовлетворяет `Yasha`, `Hurricane Pike` удовлетворяет `Dragon Lance`, `Abyssal Blade` удовлетворяет `Skull Basher`, `Swift Blink` удовлетворяет `Blink Dagger`).
   * Ботинки строго уникальны и не взаимозаменяемы: `Phase Boots != Power Treads`, `Tranquil != Treads`.
5. **Отказоустойчивость Gemini Gateway (Fail-Closed):**
   * При некорректном JSON или несовпадении схемы `StrategicPlan` система строго закрывается с ошибкой `INVALID_MODEL_OUTPUT`, немедленно освобождает слот в Gemini Budget Manager и **не** создает синтетический fallback-план с ложным `success: true`.
   * Если модель предлагает предмет, который уже куплен в инвентаре игрока, план бракуется с освобождением слота бюджета.
6. **Атомарный сброс сессий (GameSessionManager):**
   * Смена `matchid` в пакете GSI инициирует мгновенный полный сброс всех подсистем (`StateEngine`, `EventEngine`, `ObservationCollector`, `WorldModelStore`, `DecisionRouter`, `AdvisorService`). Никаких остаточных данных предыдущей игры.
7. **Безопасность токенов и аутентификация WebSocket:**
   * При первом запуске сервер автоматически генерирует криптографически стойкий 32-символьный hex-токен дашборда и сохраняет в `ai-config.json`.
   * WebSocket авторизуется через подпротокол HTTP-заголовков `Sec-WebSocket-Protocol: ['dota-auth', token]` или начальное сообщение `{ type: 'AUTH', token }`, исключая утечку токенов в строке запроса URL (`/ws?token=...`).
   * GSI эндпоинт `/gsi` строго валидирует токен (`dota_assistant_token_77`). Пакеты без токена отклоняются с кодом `401 Unauthorized`.
   * API ключ Google AI Studio хранится исключительно на сервере и никогда не отдается во фронтенд.
8. **Эвристическая кривая темпа фарма:**
   * Функция `calculateHeuristicNetworthCurve` явно задокументирована как авторская эвристическая кривая сравнения темпа для кор-героев, а не официальный бенчмарк Valve или D2PT.

---

## 🚀 Быстрый старт

### 1. Установка конфига в Dota 2
Конфигурационный файл с авторизационным токеном:
`C:\Program Files (x86)\Steam\steamapps\common\dota 2 beta\game\dota\cfg\gamestate_integration\gamestate_integration_assistant.cfg`

Сгенерировать или обновить конфиг автоматически:
```powershell
npm run generate-cfg
```

*(Если Dota 2 уже запущена, введите в игровую консоль `reload_gsiconfig`)*.

### 2. Сборка и запуск сервера ассистента
```powershell
cd c:\ag\dota-gsi-assistant
npm run build
npm start
```

### 3. Открытие второго экрана (Дашборда)
* **На основном ПК:** [http://localhost:3000](http://localhost:3000)
* **На смартфоне / планшете в локальной сети:** откройте локальный IP адрес вашего ПК (например, `http://192.168.1.50:3000`).
* Токен доступа: автоматически генерируется в `ai-config.json` при первом запуске (также отображается в консоли сервера и вводится в модальном окне дашборда).

### 1-Click запуск с Рабочего стола (Все сервисы сразу)
Дважды кликните по ярлыку **«Dota 2 AI Assistant»** на Рабочем столе (или запустите `start_assistant.bat`). Скрипт автоматически:
1. Освобождает порты 3000 и 8000.
2. Проверяет сборку `npm run build`.
3. Запускает нейросеть **Laya System-1** (`laya_service.py`).
4. Запускает агент компьютерного зрения **Vision Service** (`vision_service.py`).
5. Открывает дашборд [http://localhost:3000](http://localhost:3000) в браузере.
6. При закрытии окна корректно останавливает все дочерние фоновые процессы.

Для остановки также можно использовать `stop_assistant.bat`.

---

## 🤖 Модели искусственного интеллекта

### Система-1: Laya (ModernBERT-large, ~35 мс)
Локальный микросервис неавторегрессионного классификатора ([convaiinnovations/laya](https://huggingface.co/convaiinnovations/laya)):
```powershell
# Запуск в отдельном окне терминала
npm run laya
```
Анализирует оперативную обстановку каждые ~2.5 секунды: вычисляет калиброванный `riskScore`, определяет угрозу внезапного нападения и рекомендует моментальные тактические действия (`RETREAT`, `FARM_SAFE`, `PUSH_LANE`, `TEAMFIGHT`, `ROSHAN`). Работает 100% автономно и **никогда** не расходует квоту Gemini.

### 👁️ Компьютерное зрение: Vision Agent (100% VAC-Safe)
Фоновый модуль видеоаналитики (`vision_service.py`):
1. **0% VAC-риск:** Читает экран через Windows Desktop Duplication / `ImageGrab` без инъекций в `dota2.exe` и без чтения памяти процесса.
2. **Top Bar Scan:** Автоматически распознает 5 вражеских героев на стадии драфта и в матче по шаблонам иконок из базы 127 героев (`POST /api/enemies/setup` и `POST /api/vision/draft`).
3. **Minimap Tracking:** Анализирует миникарту (3–4 FPS, нагрузка на CPU < 1.5%), находит иконки и цветные маркеры противников, математически проецирует пиксельные координаты $(u, v)$ в мировые единицы движка Source 2 $(X, Y) \in [-8200, 8200]$ и передает в `ObservationCollector` (`source: 'cv'`).
4. **Fog & Missing Memory:** При исчезновении врага в тумане сохраняет последнюю известную позицию (`FRESH` < 15с $\to$ `STALE` 15–45с $\to$ `EXPIRED` > 45с) и передает в Laya для расчета угрозы ганга.

```powershell
# Запуск тестов Computer Vision
python -m unittest tests/test_vision_service.py
```

### Система-2: Google Gemini Flash Lite (Стратег — Strictly Manual)
1. Получите бесплатный API ключ на [Google AI Studio](https://aistudio.google.com/app/apikey).
2. В дашборде откройте **«🤖 AI Настройки»**, укажите ключ и выберите модель:
   * **`gemini-2.5-flash-lite`** (500 RPD — рекомендуемая быстрая модель)
   * **`gemini-3.5-flash-lite`** (экспериментальная модель)
3. Gemini вызывается исключительно по явной кнопке пользователя **«⚡ Спросить совет Gemini / Обновить план»** или через форму свободного вопроса тренеру.
4. **Gemini Budget Manager:** гарантирует атомарную резервацию слотов (15 RPM / 500 RPD) без race conditions.

---

## 🧪 Запуск тестов и демо-сценариев

### Запуск полного набора тестов (31 сценарий A–AE)
```powershell
npm test
```
Тестовый набор покрывает:
* **A:** Классификация зон карты (принадлежность, тип, риск)
* **B:** Парсер целостности вышек
* **C:** Жизненный цикл Рошана (`alive` ➔ `dead` ➔ `alive`)
* **D:** Честная мета D2PT патча 7.41f и фиксация Provenance
* **E:** Идентичность предметов: `ownsExactItem` vs `satisfiesRequirement`
* **F:** Атомарный бюджетный менеджер Gemini (reserveSlot / releaseReservation)
* **G:** Свежесть наблюдений (`fresh`, `stale`, `expired`)
* **H:** Атомарный сброс всех компонентов при смене матча
* **I:** Строгая типизация `getRawState()`
* **J:** Непрерывная проверка плана на каждом тике
* **K:** Инвариант Decision Router: отклонение всех не-MANUAL триггеров (`Gemini is manual-only`)
* **L:** Прием ручных триггеров и дебаунс повторных кликов (< 2 сек)
* **M:** Валидатор схемы ответов Gemini Gateway
* **N:** Детерминированное отслеживание исходов советов
* **O:** Контроль защищенности токенов и API ключей
* **P:** Точность освобождения слотов при параллельных запросах бюджета
* **Q:** Отказоустойчивость Gemini Gateway (Fail-Closed) на невалидный JSON, неполную схему и фиксация биллинга квоты при HTTP 200
* **R:** Режимы наблюдения `observationMode` и эвристическая кривая темпа фарма
* **S:** Инвариант Gemini Gateway: мгновенное отклонение не-ручных вызовов (`MANUAL_ONLY`) до HTTP и бюджета
* **T:** Инвариант фонового пайплайна: критический риск Laya и игровые события дают 0 вызовов Gemini
* **U:** Высоконагруженная автономность: 100 последовательных инференсов Laya дают ровно 0 запросов к Gemini
* **V:** Ручной пайплайн: успешное формирование плана через `AdvisorService.askManualQuestion()`
* **W:** Прием наблюдений Computer Vision (`source: 'cv'`), классификация зон карты и тайминг затухания свежести (`fresh` ➔ `stale` ➔ `expired`)
* **X:** Поддержка гибридного режима `hybrid_gsi_cv` и драфта через Draft Vision (`visionDraft`)
* **Y:** Прием вражеских героев драфта в память и отслеживание перемещений в StateEngine
* **Z:** Инъекция спайков предметов угрозы (Blink, Orchid) и уровней со Scoreboard Vision
* **AA:** Анонимные контакты миникарты (`anonymousContacts`) без ложного присвоения личностей неизвестным точкам
* **AB:** Эпистемическая честность: `null` вышек и `'unknown'` статус Рошана при отсутствии данных в пакете GSI
* **AC:** Защита от рассинхронизации времени пакетов (Out-of-Order Clock) и иерархия доверия к источникам данных
* **AD:** Честная экономика: `null` стоимости для неизвестных предметов и валидация свежести снапшотов D2PT (`d2pt_fresh` vs `d2pt_stale`)
* **AE:** Безопасный парсинг хостов CORS по `new URL().hostname` с блокировкой инъекций поддоменов (`192.168.x.x.attacker.com`)

---

## 👁️ Computer Vision Agent (100% VAC-Safe)

Автономный видеоагент реального времени, захватывающий область миникарты и экрана драфта через стандартные API ОС (без чтения памяти `dota2.exe`):
```powershell
# Установка зависимостей
pip install mss numpy requests pillow

# Запуск агента детекции миникарты
python scripts/dota_vision_agent.py
```
* Передает фактические координаты видимых врагов с миникарты в сервер ассистента (`POST /api/vision/sighting`).
* Обновляет статус наблюдения в `hybrid_gsi_cv`.
* Дает модели Laya System-1 реальные факты: сколько врагов на карте видно, кто пропал, и откуда ожидать ганка.

### Запуск симулятора матча по сценариям
```powershell
# Запуск демо со сценарием внезапного ганка Sven и Lion
npm run mock -- --scenario=gank

# Другие доступные сценарии:
npm run mock -- --scenario=death       # Гибель героя и выкуп
npm run mock -- --scenario=roshan      # Битва за Рошана и тайминги
npm run mock -- --scenario=violation   # Нарушение безопасной зоны
npm run mock -- --scenario=completion  # Завершение сборки слота
```

---

## 📄 Лицензия
MIT License. Разработано для соревновательной аналитики и обучения в Dota 2.
