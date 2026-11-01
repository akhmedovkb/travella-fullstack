const TYPES = { agent: "Турагент", tour_agent: "Турагент", guide: "Гид", transport: "Транспорт", hotel: "Отель", operator: "Туроператор", tour_operator: "Туроператор" };
const field = value => String(value ?? "").trim().slice(0, 300) || "Не указано";
function providerProfileText(provider) {
  return [
    "👤 Мой профиль",
    "",
    `🏢 Название / имя: ${field(provider.name)}`,
    `🧳 Тип: ${field(TYPES[provider.type] || provider.type)}`,
    `📍 Город / локация: ${field(provider.location)}`,
    `📞 Телефон: ${field(provider.phone)}`,
    `💬 Контакт: ${field(provider.social)}`,
    "",
    "Изменить данные можно в личном кабинете на сайте.",
  ].join("\n");
}
async function replyProviderProfile(ctx, { pool, resolveProviderId, siteUrl }) {
  if (ctx.chat?.type !== "private" || !ctx.from?.id || String(ctx.chat.id) !== String(ctx.from.id)) {
    await ctx.reply("👤 Откройте личный чат с ботом, чтобы посмотреть свой профиль.");
    return;
  }
  try {
    const providerId = await resolveProviderId(ctx.from.id, { action: "view_own_profile" });
    const result = providerId ? await pool.query(
      "SELECT name,type,location,phone,social FROM providers WHERE id=$1 LIMIT 1", [providerId]
    ) : { rows: [] };
    if (!result.rows[0]) {
      await ctx.reply("Не удалось найти привязанный профиль поставщика. Откройте /start и проверьте привязку аккаунта.");
      return;
    }
    await ctx.reply(providerProfileText(result.rows[0]), {
      disable_web_page_preview: true,
      reply_markup: { inline_keyboard: [[{ text: "✏️ Редактировать на сайте", url: `${siteUrl.replace(/\/$/, "")}/dashboard/profile` }]] },
    });
  } catch (error) {
    console.error("[tg-bot] profile lookup failed:", error?.code || "lookup_failed");
    await ctx.reply("Не удалось загрузить профиль. Попробуйте ещё раз немного позже.");
  }
}
module.exports = { providerProfileText, replyProviderProfile };
