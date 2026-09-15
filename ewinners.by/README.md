# E-Winners

Монорепозиторий:

```
ewinners.by/
  ewinners.by/   # фронтенд (Vite/React)
  server/        # бэкенд (Express/MySQL + Socket.io)
```

## Frontend

```bash
cd ewinners.by
npm install
npm run dev
```

Сборка: `npm run build` (publish = `dist`).  
SPA-редиректы: `public/_redirects` и `netlify.toml`.

API: `VITE_API_URL` (сейчас `https://test.zkh.by`).

## Backend

```bash
cd server
npm install
npm run migrate
npm run seed
npm start
```

Startup file на хостинге: `index.js`.

### Чат

- Клиент: `/cabinet/chat` — переписка с поддержкой
- Админ/бухгалтер: `/cabinet/admin/chat` — все чаты клиентов
- Realtime: Socket.io (`/socket.io`), вложения в `/uploads/chat`
- На Plesk/Passenger включите поддержку WebSocket (иначе останется long-polling)