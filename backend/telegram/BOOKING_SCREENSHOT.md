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
