const pool = require("../db");

const searchListings = async (req, res) => {
  const {
    category,
    startDate,
    endDate,
    location,
    adults,
    children,
    infants,
    providerType,
    filters = {} // 👈 Вложенные фильтры из поля details
  } = req.body;

  try {
    const conditions = [];
    const values = [];
    let index = 1;

    // Фильтрация по категории услуги
    if (category) {
      conditions.push(`services.category = $${index}`);
      values.push(category);
      index++;
    }

    // Фильтрация по типу поставщика
    if (providerType) {
      conditions.push(`providers.type = $${index}`);
      values.push(providerType);
      index++;
    }

    // Фильтрация по дате: не включать если дата уже занята
    if (startDate && endDate) {
      conditions.push(`
        NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(services.availability) AS a
          WHERE a::DATE BETWEEN $${index}::DATE AND $${index + 1}::DATE
        )
      `);
      values.push(startDate, endDate);
      index += 2;
    }

    // Фильтрация по локации
    if (location) {
      conditions.push(`providers.location ILIKE $${index}`);
      values.push(`%${location}%`);
      index++;
    }

    // Доп. фильтры по details
    const direction = filters.details?.directionCountry;
    const city = filters.details?.directionTo;

    if (direction) {
      conditions.push(`services.details->>'directionCountry' ILIKE $${index}`);
      values.push(`%${direction}%`);
      index++;
    }

    if (city) {
      conditions.push(`services.details->>'directionTo' ILIKE $${index}`);
      values.push(`%${city}%`);
      index++;
    }

    const whereClause = conditions.length > 0 ? "WHERE " + conditions.join(" AND ") : "";

    const query = `
      SELECT services.*, providers.name AS provider_name, providers.type AS provider_type
      FROM services
      JOIN providers ON services.provider_id = providers.id
      ${whereClause}
      ORDER BY services.created_at DESC
    `;

    const results = await pool.query(query, values);

    res.json(results.rows);
  } catch (err) {
    console.error("Ошибка при поиске объявлений:", err);
    res.status(500).json({ message: "Ошибка сервера" });
  }
};

module.exports = { searchListings };
