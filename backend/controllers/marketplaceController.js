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
    providerType // 👈 новый параметр: 'guide', 'transport', 'agent', 'hotel'
  } = req.body;

  try {
    const results = await pool.query(
      `SELECT services.*, providers.name AS provider_name, providers.type AS provider_type
       FROM services
       JOIN providers ON services.provider_id = providers.id
       WHERE services.category = $1
         AND providers.type = $5
         AND ($2::DATE IS NULL OR NOT EXISTS (
              SELECT 1 FROM jsonb_array_elements_text(services.availability) AS a
              WHERE a::DATE BETWEEN $2::DATE AND $3::DATE
            ))
         AND providers.location ILIKE $4`,
      [category, startDate, endDate, `%${location}%`, providerType]
    );

    res.json(results.rows);
  } catch (err) {
    console.error("Ошибка при поиске объявлений:", err);
    res.status(500).json({ message: "Ошибка сервера" });
  }
};

const direction = filters.details?.directionCountry;
const city = filters.details?.directionTo;

if (direction) conditions.push(`details->>'directionCountry' ILIKE $X`);
if (city) conditions.push(`details->>'directionTo' ILIKE $Y`);

module.exports = { searchListings };
