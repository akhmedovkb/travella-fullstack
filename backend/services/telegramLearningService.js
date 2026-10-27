const pool = require("../db");

const PROVIDER_CAMPAIGN = "provider_bot_foundations_ru_v1";
const CLIENT_CAMPAIGN = "client_bot_foundations_ru_v1";

const CAMPAIGNS = [
  {
    code: PROVIDER_CAMPAIGN,
    title: "Бот Travella для поставщика",
    audience: "provider",
    lessons: [
      {
        delayHours: 0,
        title: "Возможности бота",
        actionKind: "provider_services",
        actionLabel: "Открыть мои услуги",
        message: "Бот помогает размещать <b>отказные и срочные предложения</b>, управлять их актуальностью и получать обращения клиентов.\n\nОбычные услуги гида и транспорта для Tour Builder настраиваются в кабинете travella.uz.",
      },
      {
        delayHours: 24,
        title: "Создание предложения",
        actionKind: "create_offer",
        actionLabel: "Создать предложение",
        message: "Выберите <b>Мои услуги → Создать услугу</b>, укажите категорию, даты, состав предложения, конечную цену и срок актуальности. Незавершённая карточка сохранится в черновиках.",
      },
      {
        delayHours: 48,
        title: "Карточка, которой доверяют",
        actionKind: "create_offer",
        actionLabel: "Продолжить создание",
        message: "Добавьте реальные фотографии, понятное название и все существенные условия. Клиент должен сразу увидеть <b>что входит, сколько стоит и до какого момента предложение актуально</b>.",
      },
      {
        delayHours: 48,
        title: "Модерация и актуальность",
        actionKind: "provider_services",
        actionLabel: "Проверить услуги",
        message: "После отправки карточка проходит модерацию. Исправления отображаются в разделе <b>На модерации</b>. Опубликованное предложение нужно вовремя подтверждать, продлевать или снимать, если оно уже недоступно.",
      },
      {
        delayHours: 72,
        title: "Обращения клиентов",
        actionKind: "requests",
        actionLabel: "Открыть заявки",
        message: "Когда клиент открывает контакты или отправляет быстрый запрос, отвечайте как можно быстрее. Уточните даты, количество туристов и пожелания, затем согласуйте дальнейшие действия напрямую.",
      },
      {
        delayHours: 72,
        title: "Управление предложениями",
        actionKind: "provider_services",
        actionLabel: "Открыть мои услуги",
        message: "Используйте разделы <b>Актуальные, Черновики, На модерации, Архив и Корзина</b>. Не создавайте дубли: существующую карточку удобнее изменить, продлить или восстановить.",
      },
      {
        delayHours: 96,
        title: "Курс завершён",
        actionKind: "learning_topics",
        actionLabel: "Все инструкции",
        message: "Вы освоили основные функции бота. Инструкции всегда доступны через кнопку <b>Обучение</b>. Хорошая карточка, актуальная цена и быстрый ответ заметно повышают шанс обращения.",
      },
    ],
  },
  {
    code: CLIENT_CAMPAIGN,
    title: "Бот Travella для клиента",
    audience: "client",
    lessons: [
      {
        delayHours: 0,
        title: "Возможности бота",
        actionKind: "search",
        actionLabel: "Найти предложение",
        message: "В боте можно находить <b>отказные туры, отели, авиабилеты, билеты на мероприятия и авторские туры</b>. Такие предложения ограничены по времени, поэтому всегда проверяйте срок актуальности.",
      },
      {
        delayHours: 24,
        title: "Поиск и карточка",
        actionKind: "search",
        actionLabel: "Открыть поиск",
        message: "Откройте <b>Найти услугу</b>, выберите категорию и изучите карточку: даты, маршрут, состав, цену, фотографии и условия поставщика.",
      },
      {
        delayHours: 48,
        title: "Контакты поставщика",
        actionKind: "search",
        actionLabel: "Выбрать предложение",
        message: "В подходящей карточке нажмите <b>Открыть контакты</b>. После открытия бот покажет телефон, Telegram или WhatsApp поставщика. До оплаты обязательно уточните актуальность и все условия.",
      },
      {
        delayHours: 72,
        title: "Быстрый запрос",
        actionKind: "requests",
        actionLabel: "Открыть заявки",
        message: "Если нужно уточнение, отправьте <b>Быстрый запрос</b>: укажите даты, количество туристов и пожелания. Поставщик получит ваши данные и сможет ответить.",
      },
      {
        delayHours: 96,
        title: "Курс завершён",
        actionKind: "learning_topics",
        actionLabel: "Все инструкции",
        message: "Основные функции освоены. Возвращайтесь в раздел <b>Обучение</b>, если понадобится подсказка. Не переводите деньги до проверки поставщика, состава предложения и условий возврата.",
      },
    ],
  },
];

function campaignCodeForRole(role) {
  return role === "provider" ? PROVIDER_CAMPAIGN : CLIENT_CAMPAIGN;
}

async function ensureTelegramLearningSchema(db = pool) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS telegram_learning_campaigns (
      id BIGSERIAL PRIMARY KEY, code VARCHAR(80) NOT NULL UNIQUE, title TEXT NOT NULL,
      audience VARCHAR(16) NOT NULL, status VARCHAR(16) NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS telegram_learning_lessons (
      id BIGSERIAL PRIMARY KEY, campaign_id BIGINT NOT NULL REFERENCES telegram_learning_campaigns(id) ON DELETE CASCADE,
      position INTEGER NOT NULL, delay_hours INTEGER NOT NULL DEFAULT 24, title TEXT NOT NULL,
      message_html TEXT NOT NULL, action_kind VARCHAR(40), action_label TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(campaign_id, position)
    );
    CREATE TABLE IF NOT EXISTS telegram_learning_enrollments (
      id BIGSERIAL PRIMARY KEY, campaign_id BIGINT NOT NULL REFERENCES telegram_learning_campaigns(id) ON DELETE CASCADE,
      user_role VARCHAR(16) NOT NULL, user_id BIGINT NOT NULL, chat_id TEXT NOT NULL,
      next_lesson_position INTEGER NOT NULL DEFAULT 1, next_send_at TIMESTAMPTZ,
      status VARCHAR(16) NOT NULL DEFAULT 'active', snoozed_until TIMESTAMPTZ, last_sent_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(campaign_id, user_role, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_telegram_learning_enrollments_due
      ON telegram_learning_enrollments(status, next_send_at) WHERE status = 'active';
    CREATE INDEX IF NOT EXISTS idx_telegram_learning_enrollments_chat
      ON telegram_learning_enrollments(chat_id, user_role);
    CREATE TABLE IF NOT EXISTS telegram_learning_deliveries (
      id BIGSERIAL PRIMARY KEY, enrollment_id BIGINT NOT NULL REFERENCES telegram_learning_enrollments(id) ON DELETE CASCADE,
      lesson_id BIGINT NOT NULL REFERENCES telegram_learning_lessons(id) ON DELETE CASCADE,
      status VARCHAR(16) NOT NULL DEFAULT 'pending', source VARCHAR(16) NOT NULL DEFAULT 'scheduled',
      telegram_message_id BIGINT, error TEXT, sent_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(enrollment_id, lesson_id)
    );
  `);

  for (const campaign of CAMPAIGNS) {
    const result = await db.query(
      `INSERT INTO telegram_learning_campaigns (code, title, audience, status)
       VALUES ($1, $2, $3, 'active')
       ON CONFLICT (code) DO UPDATE SET title = EXCLUDED.title, audience = EXCLUDED.audience, updated_at = NOW()
       RETURNING id`,
      [campaign.code, campaign.title, campaign.audience]
    );
    const campaignId = result.rows[0].id;
    for (let index = 0; index < campaign.lessons.length; index += 1) {
      const lesson = campaign.lessons[index];
      await db.query(
        `INSERT INTO telegram_learning_lessons
           (campaign_id, position, delay_hours, title, message_html, action_kind, action_label)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (campaign_id, position) DO UPDATE SET
           delay_hours = EXCLUDED.delay_hours, title = EXCLUDED.title,
           message_html = EXCLUDED.message_html, action_kind = EXCLUDED.action_kind,
           action_label = EXCLUDED.action_label, updated_at = NOW()`,
        [campaignId, index + 1, lesson.delayHours, lesson.title, lesson.message, lesson.actionKind, lesson.actionLabel]
      );
    }
  }
}

async function ensureEnrollment({ role, userId, chatId, db = pool }) {
  const code = campaignCodeForRole(role);
  const result = await db.query(
    `INSERT INTO telegram_learning_enrollments
       (campaign_id, user_role, user_id, chat_id, next_lesson_position, next_send_at, status)
     SELECT id, $2, $3, $4, 1, NOW(), 'active'
       FROM telegram_learning_campaigns WHERE code = $1 AND status = 'active'
     ON CONFLICT (campaign_id, user_role, user_id) DO UPDATE
       SET chat_id = EXCLUDED.chat_id, updated_at = NOW()
     RETURNING *`,
    [code, role, userId, String(chatId)]
  );
  return result.rows[0] || null;
}

async function resolveUser(role, chatId, db = pool) {
  if (role === "provider") {
    const result = await db.query(
      `SELECT id FROM providers
       WHERE $1 = ANY(ARRAY[
         telegram_refused_chat_id::text, telegram_chat_id::text,
         tg_chat_id::text, telegram_web_chat_id::text
       ]) LIMIT 1`,
      [String(chatId)]
    );
    return result.rows[0] || null;
  }
  const result = await db.query(
    `SELECT id FROM clients WHERE telegram_chat_id::text = $1 LIMIT 1`,
    [String(chatId)]
  );
  return result.rows[0] || null;
}

async function getOrCreateEnrollment(role, chatId, db = pool) {
  const user = await resolveUser(role, chatId, db);
  if (!user) return null;
  return ensureEnrollment({ role, userId: user.id, chatId, db });
}

async function getEnrollmentWithLesson(role, chatId, db = pool) {
  const enrollment = await getOrCreateEnrollment(role, chatId, db);
  if (!enrollment) return null;
  const result = await db.query(
    `SELECT e.*, c.title AS campaign_title, l.id AS lesson_id, l.position,
            l.title AS lesson_title, l.message_html, l.action_kind, l.action_label,
            (SELECT COUNT(*)::int FROM telegram_learning_lessons x WHERE x.campaign_id = e.campaign_id) AS lesson_count
       FROM telegram_learning_enrollments e
       JOIN telegram_learning_campaigns c ON c.id = e.campaign_id
       LEFT JOIN telegram_learning_lessons l
         ON l.campaign_id = e.campaign_id AND l.position = e.next_lesson_position
      WHERE e.id = $1`,
    [enrollment.id]
  );
  return result.rows[0] || null;
}

async function setEnrollmentStatus(role, chatId, status, db = pool) {
  const allowed = new Set(["active", "paused", "unsubscribed"]);
  if (!allowed.has(status)) throw new Error("Invalid learning status");
  const enrollment = await getOrCreateEnrollment(role, chatId, db);
  if (!enrollment) return null;
  const result = await db.query(
    `UPDATE telegram_learning_enrollments
        SET status = $2,
            next_send_at = CASE WHEN $2 = 'active' THEN NOW() ELSE next_send_at END,
            snoozed_until = NULL, updated_at = NOW()
      WHERE id = $1 RETURNING *`,
    [enrollment.id, status]
  );
  return result.rows[0] || null;
}

async function snoozeEnrollment(role, chatId, hours = 24, db = pool) {
  const enrollment = await getOrCreateEnrollment(role, chatId, db);
  if (!enrollment) return null;
  const result = await db.query(
    `UPDATE telegram_learning_enrollments
        SET status = 'active', snoozed_until = NOW() + ($2 * INTERVAL '1 hour'),
            next_send_at = NOW() + ($2 * INTERVAL '1 hour'), updated_at = NOW()
      WHERE id = $1 RETURNING *`,
    [enrollment.id, Math.max(1, Number(hours) || 24)]
  );
  return result.rows[0] || null;
}

async function restartEnrollment(role, chatId, db = pool) {
  const enrollment = await getOrCreateEnrollment(role, chatId, db);
  if (!enrollment) return null;
  await db.query(`DELETE FROM telegram_learning_deliveries WHERE enrollment_id = $1`, [enrollment.id]);
  const result = await db.query(
    `UPDATE telegram_learning_enrollments
        SET next_lesson_position = 1, next_send_at = NOW(), status = 'active',
            snoozed_until = NULL, last_sent_at = NULL, completed_at = NULL, updated_at = NOW()
      WHERE id = $1 RETURNING *`,
    [enrollment.id]
  );
  return result.rows[0] || null;
}

function formatLesson(row) {
  if (!row?.lesson_id) return null;
  return (
    `🎓 <b>Урок ${row.position} из ${row.lesson_count}: ${row.lesson_title}</b>\n\n` +
    `${row.message_html}\n\n` +
    "Следующий урок можно открыть сразу или получить позже автоматически."
  );
}

function actionCallback(kind) {
  const map = {
    provider_services: "prov_services:list",
    create_offer: "prov_services:create",
    search: "learning:search",
    requests: "learning:requests",
    learning_topics: "learning:topics",
  };
  return map[kind] || "learning:topics";
}

function lessonKeyboard(row) {
  const keyboard = [];
  if (row?.action_label) {
    keyboard.push([{ text: row.action_label, callback_data: actionCallback(row.action_kind) }]);
  }
  keyboard.push([
    { text: "Следующий урок", callback_data: "learning:next" },
    { text: "Напомнить завтра", callback_data: "learning:later" },
  ]);
  keyboard.push([{ text: "Отключить обучение", callback_data: "learning:unsubscribe" }]);
  return { inline_keyboard: keyboard };
}

async function completeCurrentLesson(enrollmentId, lessonId, source = "manual", db = pool) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO telegram_learning_deliveries (enrollment_id, lesson_id, status, source, sent_at)
       VALUES ($1, $2, 'sent', $3, NOW())
       ON CONFLICT (enrollment_id, lesson_id) DO UPDATE
         SET status = 'sent', source = EXCLUDED.source, sent_at = NOW(), error = NULL, updated_at = NOW()`,
      [enrollmentId, lessonId, source]
    );
    const result = await client.query(
      `UPDATE telegram_learning_enrollments e
          SET next_lesson_position = next_lesson_position + 1,
              last_sent_at = NOW(), snoozed_until = NULL,
              next_send_at = NOW() + COALESCE((
                SELECT delay_hours * INTERVAL '1 hour'
                  FROM telegram_learning_lessons l
                 WHERE l.campaign_id = e.campaign_id AND l.position = e.next_lesson_position + 1
              ), INTERVAL '0 hour'),
              status = CASE WHEN EXISTS (
                SELECT 1 FROM telegram_learning_lessons l
                 WHERE l.campaign_id = e.campaign_id AND l.position = e.next_lesson_position + 1
              ) THEN 'active' ELSE 'completed' END,
              completed_at = CASE WHEN EXISTS (
                SELECT 1 FROM telegram_learning_lessons l
                 WHERE l.campaign_id = e.campaign_id AND l.position = e.next_lesson_position + 1
              ) THEN NULL ELSE NOW() END,
              updated_at = NOW()
        WHERE e.id = $1 RETURNING *`,
      [enrollmentId]
    );
    await client.query("COMMIT");
    return result.rows[0] || null;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  CAMPAIGNS,
  ensureTelegramLearningSchema,
  ensureEnrollment,
  getOrCreateEnrollment,
  getEnrollmentWithLesson,
  setEnrollmentStatus,
  snoozeEnrollment,
  restartEnrollment,
  completeCurrentLesson,
  formatLesson,
  lessonKeyboard,
};

