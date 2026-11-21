# Создание услуг по скриншотам бронирования

В личке подтверждённого поставщика: «Мои услуги» → «Создать услугу» → «Создать по скриншоту» или `/frombooking`. Категории: отказной тур, отель, авиабилет.

## Распознавание и сводка

- До 5 изображений одной брони, JPEG/PNG/WebP, каждое до 6 МБ. Можно отправить несколько фото подряд, затем нажать «Распознать». Повторное фото с тем же Telegram file_id не добавляется.
- Только явно видимые данные. Неразборчивое остаётся пустым; частично читаемые значения и время рейса выделяются предупреждением. Для передачи в черновик значения с предупреждениями нужно проверить либо исправить. Поля, отсутствующие на скриншоте, не придумываются.
- Сводка показывает число заполненных полей, обработанных изображений и список недостающего, включая цены, состав гостей/пассажиров и срок актуальности.
- Дополнительные изображения дополняют уже распознанное. Различающиеся значения становятся конфликтами с номером скриншота; сохранение заблокировано до выбора правильного значения или ручной правки. Ручные правки имеют приоритет и не затираются последующими изображениями.
- Исправление любого поля происходит в сводке. Даты, питание, размещение, тип перелёта и логические значения проверяются. После ввода отображается обновлённая сводка. Название автоматически обновляется при изменении направления/отеля, пока пользователь не задал своё название.
- Состав туристов вводится числами отдельно, никогда не определяется по DBL или числу билетов. Билет в одну сторону не имеет обратной даты; пересадка не считается обратным рейсом.

## Дубликаты

Перед переносом в мастер и перед фактическим созданием услуги проверяются только услуги текущего поставщика: категория, даты, город, маршрут и отель. Удалённые и архивные не учитываются. Это предупреждение о похожих карточках, а не гарантия абсолютного совпадения разных написаний названий. Пользователь может открыть существующую карточку или явно создать отдельную. Изменившиеся совпадения требуют нового подтверждения. Ошибка проверки не приводит к молчаливому созданию.

## Исходные скриншоты как proof

Оригиналы не входят в публичные фото и не копируются в proof автоматически. После создания черновика появляется отдельная кнопка «Проверить скриншоты». Бот показывает каждый исходный файл в личке и предлагает прикрепить его только после подтверждения, что ФИО, даты рождения, документы, QR-коды и данные оплаты скрыты. Если данные не скрыты, пользователь должен загрузить безопасную версию отдельно. Подтверждение пользователя — ручная проверка; автоматическое удаление персональных данных не выполняется.

Исходные file_id хранятся в приватной таблице `telegram_booking_proof_sources`, привязанной к Telegram-автору и услуге, до 30 дней. Доступ проверяется через принадлежность услуги. Файлы прикрепляются только к черновику, транзакционно с одноразовой отметкой; на модерации действие запрещено. После перезапуска требуется повторный просмотр, прежнее подтверждение не действует. Само прикрепление не отправляет услугу на модерацию.

## Настройки и сохранение

Используется существующий `OPENAI_API_KEY`, необязательный `TELEGRAM_BOOKING_AI_MODEL` (по умолчанию `gpt-4.1-mini`), `store:false`. Telegram URL и токен не передаются модели. Изображения обрабатываются в памяти, лимиты размера и пикселей применяются до распознавания. Модель получает строгую схему с разрешёнными полями и идентификаторами сомнений; персональные записи, контакты, документы и цены не извлекаются.

До подтверждения сводка находится в сессии. После подтверждения используется существующее сохранение мастера в PostgreSQL; заполненные шаги пропускаются. Команды и отмена закрывают несохранённое распознавание. Proof и вложения заказов не перехватываются новым сценарием. Обычная модерация обязательна.


## Compact creation (November 2026)

Production uses the compact review flow for tours, hotels and flights. Required category fields, confirmed party, both prices and an explicit expiry choice are completed inside review. Optional conditions live under a separate menu with three-state answers; unknown is not serialized as excluded. Public photos are explicitly uploaded separately from booking screenshots. A full preview and a matching confirmation are required before saving. Adding new screenshots blocks saving until recognition completes.

Private actor-scoped checkpoints live in `telegram_booking_import_drafts` for 30 days. `/frombooking` offers continuation or a fresh start; field edits and original Telegram file identifiers survive restart. The ordinary provider wizard is stored independently and is not consumed by compact creation.

Duplicate review offers opening any matching own service, creating a separate draft, or updating an own draft. Updating rechecks ownership, category, deletion and moderation state under a row lock. Published/pending services are never updated through this action. Existing proof, public photos and unrelated conditions are preserved; supplied public photos are appended. Proof reuse still requires a separate preview and explicit confirmation.


## Booking quality, pricing units and local proof privacy

Compact creation requires an explicit price basis (total/person/room; room is unavailable for flights). Both net and gross prices use that unit. `priceBasis`, a human-readable `priceFor` and the applicable `pricePerPerson` persist through new creation and draft update. Room prices are not silently treated as whole-party totals in assistant budget matching.

Review shows added/changed/removed field labels and preserved prices after recognition. Source management supports private viewing, replacement and confirmed removal. Whitelisted recognition is cached per source; removing/replacing sources rebuilds extracted fields and preserves manual corrections, commercial fields and party. Older checkpoints without source caches require recognition again. Hotel/flight date differences need explicit acknowledgement bound to current values. Invalid date order and sale windows block saving. Readiness text separates saving, proof and moderator submission.

Proof privacy checks use local Tesseract (eng/rus) and jsQR on the Travella server; images and OCR text are not sent to a third-party analysis API. Language model files may be downloaded to the temporary cache on first use. OCR values are never logged, persisted or returned; only region categories and coordinates enter the short-lived review session. Possible personal-data regions can be blacked out locally, then shown again before a fresh explicit attachment confirmation. Detection is best-effort, not a guarantee; an unavailable check is clearly labelled and requires manual review. Original flagged sources cannot be attached through the reuse button. Existing ownership, status, row-lock and single-use protections still apply.


## Preflight, recovery and proof/card correspondence

Before external booking recognition, the production flow evaluates image quality locally: image dimensions, readable text, potential edge clipping and low-detail/blur hints. Warnings offer replacement or explicit continuation. They are heuristic, not a claim that the screenshot is unusable. Failed images retain an actor-scoped error and can be retried without reprocessing successful sources. Public-photo failures also retain the pending Telegram file for retry.

One-level undo snapshots import fields, source caches and manual corrections before successful mutations. Undo rotates callback tokens and invalidates preview, duplicate and consistency acknowledgements. Undo does not reverse a saved service or an attached proof.

Duplicate update first loads the current owned editable draft and shows old/new values. Confirmation is bound to the current import fingerprint and a hash of the database row. A changed row triggers a fresh comparison; the updater also checks the version under the row lock.

The existing local proof checker compares labelled hotel, city/route and date values with the service. It returns only whitelisted field/status identifiers, never OCR text or private document values. Complementary screenshots combine, explicit differences remain visible, and missing/unclear facts remain unverified. Differences or unverified fields require a separate manual conditions acknowledgement before the final privacy/attachment confirmation. Service identity is rechecked both before attaching and inside the transaction. This does not establish document authenticity. Failed preview/redaction/attachment offers a guarded retry.


## Quick choices, one editor panel and independent bookings

Production offers party presets (one/two adults and a confirmed family selector) while retaining typed ADT+CHD+INF input. Expiry presets use Asia/Tashkent: end of today at 23:59 or exactly 24 hours from the current time. The calendar disables past dates and dates after trip start. Exact expiry date/time appears in review and preview.

The private import stores its canonical text panel message ID. Field prompts, party choices, calendar, progress and review edit that message; deleted/uneditable messages fall back to a fresh panel. Updates are serialized per actor to avoid duplicate panels during albums. Proof images and error notices remain separate when necessary.

Recognition uses high image detail and can return whitelisted independent offers from a single screenshot. Across screenshots, clearly different/disjoint identities trigger a choice. Return and connecting flight legs remain together. Nothing splits automatically: users choose separate drafts or one booking with field conflicts. Split drafts form a persisted queue and are saved one by one only after individual confirmation; commercial fields and party are not copied across offers. Whole multi-booking images are excluded from automatic proof reuse. The source image can be viewed, but each service needs its own cropped confirmation. Queued drafts remain available through /frombooking after proof work or restart.

Usability research is separate from automated checks. A local task/feedback packet is prepared for 3–5 colleagues; no participants are invited or results claimed until participants and delivery are specified by the owner.
