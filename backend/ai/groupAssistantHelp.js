const HELP = {
  ru: {
    create: 'В личном чате с ботом: «Мои услуги» → «Создать услугу». Выберите категорию, заполните поля, добавьте подтверждение и отправьте на модерацию.',
    proof: 'Подтверждение — скриншот бронирования, ваучер, билет или подтверждение поставщика, относящееся к этому предложению. Отправляйте его в личном чате с ботом. Не публикуйте документы и личные данные туристов в группе.',
    corrections: 'В личном чате: «Мои услуги» → «Нужны исправления» → откройте услугу. Исправьте замечания, отметьте их и отправьте на повторную проверку.',
    gala: 'В отказном туре или отеле нажмите «🎉 Гала-ужин». Укажите условия, дату и доплаты. В вебе этот блок есть в форме услуги. Доплата показывается отдельно от основной цены.',
    companion: 'При создании отказного тура или отеля бот спросит о попутчике перед ценой. Для существующей услуги нажмите «👥 Попутчик». Цена указывается за человека; найденного попутчика можно отметить отключением поиска.',
    profile: 'Откройте «Мой профиль» в личном чате с ботом или кабинет: https://travella.uz/dashboard/profile',
    search: 'Обратитесь ко мне по @имени или /ask@имя_бота. Например: «Ташкент — Дубай, декабрь, до 1000 USD за человека». Можно писать с опечатками и смешивать русский с узбекским. Перед поиском я подтвержу условия.',
    support: 'Помогаю искать опубликованные предложения и пользоваться Travella. Вопросы о личной услуге и документы отправляйте в личный чат с ботом → «Поддержка».',
  },
  uz: {
    create: 'Botning shaxsiy chatida: «Мои услуги» → «Создать услугу». Toifani tanlang, maydonlarni to‘ldiring, tasdiqni qo‘shing va moderatsiyaga yuboring.',
    proof: 'Tasdiq — aynan shu taklifga tegishli bron skrinshoti, vaucher, chipta yoki yetkazib beruvchi tasdig‘i. Botning shaxsiy chatiga yuboring. Guruhga hujjat va sayyohlarning shaxsiy ma’lumotlarini joylamang.',
    corrections: 'Shaxsiy chatda: «Мои услуги» → «Нужны исправления». Xizmatni oching, izohlarni tuzating, belgilab qayta tekshiruvga yuboring.',
    gala: 'Rad etilgan tur yoki mehmonxonada «🎉 Гала-ужин» tugmasini bosing. Shartlar, sana va qo‘shimcha to‘lovlarni kiriting. Veb shaklda ham shu bo‘lim bor.',
    companion: 'Tur yoki mehmonxona yaratishda bot narxdan oldin hamroh haqida so‘raydi. Tahrirlash uchun «👥 Попутчик» tugmasi bor. Narx bir kishi uchun ko‘rsatiladi; hamroh topilgach qidiruvni o‘chirish mumkin.',
    profile: 'Shaxsiy chatdagi «Мой профиль» yoki kabinetni oching: https://travella.uz/dashboard/profile',
    search: 'Menga @nom yoki /ask@bot_nomi orqali murojaat qiling. Masalan: «Toshkent — Dubay, dekabr, bir kishiga 1000 USD gacha». Qidiruvdan oldin shartlarni tasdiqlayman.',
    support: 'Travella takliflarini topish va platformadan foydalanishga yordam beraman. Shaxsiy xizmat yoki hujjatlar uchun botning shaxsiy chatidagi «Поддержка» bo‘limiga yozing.',
  },
  en: {
    create: 'In the bot’s private chat: «Мои услуги» → «Создать услугу». Choose a category, complete the fields, attach booking evidence and submit for moderation.',
    proof: 'Evidence is a booking screenshot, voucher, ticket or supplier confirmation for this exact offer. Send it privately to the bot. Do not share documents or travellers’ personal data in the group.',
    corrections: 'In private: «Мои услуги» → «Нужны исправления». Open the service, fix and check the requested changes, then resubmit for review.',
    gala: 'Open a refused tour or hotel and press «🎉 Гала-ужин». Set the terms, date and supplements. The web editor also has this section. Supplements are displayed separately.',
    companion: 'During tour or hotel creation, the bot asks about companions before the price. Use «👥 Попутчик» to edit an existing offer. Prices are per person; turn the search off once a companion is found.',
    profile: 'Open «Мой профиль» in the private bot chat or https://travella.uz/dashboard/profile',
    search: 'Mention my @username or use /ask@bot_username. For example: “Tashkent to Dubai in December, up to USD 1,000 per person”. I confirm the filters before searching.',
    support: 'I help find published Travella offers and explain the platform. For private services or documents, use «Поддержка» in the bot’s private chat.',
  },
};
module.exports = { groupAssistantHelp: (language, topic) => (HELP[language] || HELP.ru)[topic] || HELP.ru.support };
