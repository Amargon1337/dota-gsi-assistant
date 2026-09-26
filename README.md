# 🛡️ Dota 2 Realtime Cognitive Co-Pilot & Strategic Assistant (Patch 7.41f)

Комплексный соревновательный ассистент реального времени для Dota 2 с двухуровневой когнитивной архитектурой (System-1 ⇄ System-2), работающий по официальному протоколу **Valve Game State Integration (GSI)**.

> **100% VAC-Safe:** Читает только официальные исходящие HTTP-пакеты движка Source 2. Не взаимодействует с памятью процесса игры, не внедряет DLL и не нарушает правила Valve Anti-Cheat.

---

## 🏛️ Архитектура системы

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
            ┌──────────────────┴──────────────────┐
            ▼                                     ▼
       Event Engine                        Laya System-1
     (Every-Tick Plan &                  (ModernBERT-large
      Roshan Evaluation)                  Tactical Classifier)
            │                                     │
            └──────────────────┬──────────────────┘
                               ▼
                        Decision Router
                  (Priority Tiers: CRITICAL / HIGH / NORMAL)
                  (Category Cooldowns & autoCoach Gating)
                               │
                               ▼
                       Gemini Budget Manager
                   (Atomic reserveSlot: 15 RPM / 500 RPD)
                               │
                               ▼
                        Gemini System-2
                   (Gemini 2.5/3.5 Flash Lite)
                   (12s AbortController & Schema Validator)
                               │
                               ▼
                     Advisor & Outcome Tracker
                  (matchId bound, 60s horizon)
                               │
                      [WebSocket /ws]
                     (Token Authenticated)
                               ▼
                   Responsive Second Screen UI
```

---

## 🛡️ Принципы достоверности и безопасности данных (No Hallucination)

1. **Туман войны (Fog of War) и режим наблюдений (`observationMode`):**
   * В режиме одиночного игрока GSI передает данные исключительно о состоянии клиента вашего персонажа (`player_gsi_fow_restricted`). Движок Valve строго отсекает данные о скрытых врагах в тумане войны на уровне сервера.
   * `ObservationCollector` служит модулем телеметрии и приема наблюдений (из спектаторского GSI или симуляции); система никогда не фальсифицирует координаты невидимых врагов. Все наблюдения имеют источники (`gsi`, `mock`, `inferred`, `unknown`) и шкалу свежести (`fresh` < 15с, `stale` 15–60с, `expired` > 60с).
2. **Фактические данные Dota2ProTracker (7.41f) и Происхождение (Provenance):**
   * Все рекомендации строятся на проверенных снапшотах меты из папки `data/d2pt/*.json` со строгой фиксацией происхождения (`sourceUrl`, `fetchedAt`, `dataAgeDays`, `extractionMethod: "static_snapshot"`, `confidenceNotes`). Снапшоты старше 7 дней или другого патча маркируются как `isStale`.
   * Синтетическая генерация данных исключена: если героя нет в базе снапшотов, система честно возвращает `targetItem: null, d2ptAvailable: false, recommendationSource: 'none'`, позволяя Gemini System-2 сформировать совет из фундаментального знания патча и текущего инвентаря игрока без навязывания ложных шаблонов.
3. **Идентичность предметов (Item Identity):**
   * Разделены строгие проверки: `ownsExactItem` (точное совпадение слота/алиаса) и `satisfiesRequirement` (компонентное удовлетворение: `Manta Style` удовлетворяет `Yasha`, `Hurricane Pike` удовлетворяет `Dragon Lance`, `Abyssal Blade` удовлетворяет `Skull Basher`, `Swift Blink` удовлетворяет `Blink Dagger`).
   * Ботинки строго уникальны и не взаимозаменяемы: `Phase Boots != Power Treads`, `Tranquil != Treads`.
4. **Отказоустойчивость Gemini Gateway (Fail-Closed):**
   * При некорректном JSON или несовпадении схемы `StrategicPlan` система строго закрывается с ошибкой `INVALID_MODEL_OUTPUT`, немедленно освобождает слот в Gemini Budget Manager и **не** создает синтетический fallback-план с ложным `success: true`.
   * Если модель предлагает предмет, который уже куплен в инвентаре игрока, план бракуется с освобождением слота бюджета.
5. **Атомарный сброс сессий (GameSessionManager):**
   * Смена `matchid` в пакете GSI инициирует мгновенный полный сброс всех подсистем (`StateEngine`, `EventEngine`, `ObservationCollector`, `WorldModelStore`, `DecisionRouter`, `AdvisorService`). Никаких остаточных данных предыдущей игры.
6. **Безопасность токенов и аутентификация WebSocket:**
   * При первом запуске сервер автоматически генерирует криптографически стойкий 32-символьный hex-токен дашборда и сохраняет в `ai-config.json`.
   * WebSocket авторизуется через подпротокол HTTP-заголовков `Sec-WebSocket-Protocol: ['dota-auth', token]` или начальное сообщение `{ type: 'AUTH', token }`, исключая утечку токенов в строке запроса URL (`/ws?token=...`).
   * GSI эндпоинт `/gsi` строго валидирует токен (`dota_assistant_token_77`). Пакеты без токена отклоняются с кодом `401 Unauthorized`.
   * API ключ Google AI Studio хранится исключительно на сервере и никогда не отдается во фронтенд.
7. **Эвристическая кривая темпа фарма:**
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

---

## 🤖 Модели искусственного интеллекта

### Система-1: Laya (ModernBERT-large, ~35 мс)
Локальный микросервис неавторегрессионного классификатора ([convaiinnovations/laya](https://huggingface.co/convaiinnovations/laya)):
```powershell
# Запуск в отдельном окне терминала
npm run laya
```
Анализирует оперативную обстановку каждые 2.5 секунды: вычисляет калиброванный `riskScore`, определяет угрозу внезапного нападения и рекомендует моментальные тактические действия (`RETREAT`, `FARM_SAFE`, `PUSH_LANE`, `TEAMFIGHT`, `ROSHAN`). При критических аномалиях эскалирует запрос в Систему-2.

### Система-2: Google Gemini Flash Lite (Стратег)
1. Получите бесплатный API ключ на [Google AI Studio](https://aistudio.google.com/app/apikey).
2. В дашборде откройте **«🤖 AI Настройки»**, укажите ключ и выберите модель:
   * **`gemini-2.5-flash-lite`** (500 RPD — рекомендуемая быстрая модель)
   * **`gemini-3.5-flash-lite`** (экспериментальная модель)
3. **Decision Router** централизованно координирует вызовы Gemini:
   * `CRITICAL` (нарушение зоны плана, гибель героя)
   * `HIGH` (убийство/респаун Рошана, потеря ключевых вышек, эскалация от Laya)
   * `NORMAL` (завершение сборки артефакта)
   * `MANUAL` (прямой вопрос тренеру по кнопке)
4. **Gemini Budget Manager:** гарантирует атомарную резервацию слотов (15 RPM / 500 RPD) без race conditions.

---

## 🧪 Запуск тестов и демо-сценариев

### Запуск полного набора тестов (18 сценариев A–R)
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
* **K:** Приоритеты и кулдауны Decision Router
* **L:** Блокировка авто-вызовов при выключенном autoCoach
* **M:** Валидатор схемы ответов Gemini Gateway
* **N:** Детерминированное отслеживание исходов советов
* **O:** Контроль защищенности токенов и API ключей
* **P:** Точность освобождения слотов при параллельных запросах бюджета
* **Q:** Отказоустойчивость Gemini Gateway (Fail-Closed) на невалидный JSON, неполную схему и дубли предметов
* **R:** Режимы наблюдения `observationMode` и эвристическая кривая темпа фарма

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
