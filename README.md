# Редактор SMS-форматов Zenmoney

Редактор существующих PR в [zenmoney/sms-formats](https://github.com/zenmoney/sms-formats) и его форках: локальные черновики, проверки, AI-промпт и импорт ответа. Репозиторий также содержит Telegram-бот распознавания SMS.

## Запуск

Используйте Bun из [.bun-version](.bun-version).

```bash
bun install --frozen-lockfile
cp .env.example .env
bun run dev
```

Откройте адрес Vite и выберите PR. Для записи укажите GitHub-токен в настройках; нужны права на PR. Черновики сохраняются локально. `VITE_*` доступны браузеру: серверные секреты туда не помещайте.

[Разработка, контент и бот](docs/development.md) · [Термины](GLOSSARY.md) · [Архитектурные решения](docs/adr/)
