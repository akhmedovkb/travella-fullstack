const jwt = require("jsonwebtoken"); 

const authenticate = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Нет токена. Доступ запрещен." });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // ✅ исправлено
    next();
  } catch (err) {
    return res.status(403).json({ message: "Неверный токен" });
  }
};

module.exports = authenticate;
