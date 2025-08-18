# Security Policy

- Репозиторий приватный. 2FA обязательно.
- Пуш в main запрещён — только через PR, минимум 1 review.
- Секреты только в Vercel/Railway ENV. В Git хранится только `.env.example`.
- Любая утечка секретов: немедленная ротация и уведомление.
- High/Critical уязвимости блокируют мердж (audit CI).
- Раздельные окружения Prod/Preview/Dev. Бэкапы БД перед миграциями.
- Контакты: security@travella.uz
