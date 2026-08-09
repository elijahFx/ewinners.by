# E-Winners

Монорепозиторий:

```
ewinners.by/
  ewinners.by/       # фронтенд (Vite/React) → Netlify
  server_ewinners/   # бэкенд (Express/MySQL) → хостинг
```

## Frontend

```bash
cd ewinners.by
npm install
npm run dev
```

Сборка для Netlify: `npm run build` (publish = `dist`).  
SPA-редиректы: `public/_redirects` и `netlify.toml`.

API: `VITE_API_URL` (сейчас `https://test.zkh.by`).

## Backend

```bash
cd server_ewinners
npm install
npm run migrate
npm run seed
npm start
```

Startup file на хостинге: `index.js`.
