# Перенос E-Winners на другой VPS

## 1. Что где сейчас лежит

Это не один сервер, а три независимые части:

| Часть | Где | Что переносить |
|---|---|---|
| API (Node/Express) | VPS `178.172.137.114`, Ubuntu 26.04, `/var/www/ewinners-api`, systemd `ewinners-api`, порт `127.0.0.1:5000` | код, `.env`, uploads, systemd, Nginx/SSL, cron, AvTunProxy |
| MySQL | внешний хост `by3020.hb.by` (`178.124.141.136`), база `ewinners_db` | либо оставить, либо дамп/импорт |
| Статический сайт | Plesk `176.60.210.111`, домен `ewinners.by` | не на API-VPS; при смене API обновить прокси `/api` |

Дополнительно на API-VPS:

- **AvTunProxy** — `/opt/avtunproxy`, порт `127.0.0.1:10224`, systemd `avtunproxy`; через него идут запросы в MTBank.
- **Cron банка** — `/etc/cron.d/ewinners-bank-sync` → `/usr/local/bin/ewinners-bank-sync.sh`, каждые 2 минуты.
- **Nginx** — `/etc/nginx/sites-available/ewinners-api`, SSL Let's Encrypt для `178.172.137.114.sslip.io`.
- **Uploads** — `/var/www/ewinners-api/uploads`, около 105 МБ (в основном `documents`).
- **Yandex Disk / SMTP / Telegram / SalesRender** — внешние API, нужны токены из `.env` и исходящий интернет.

## 2. Сначала принять три решения

1. **База остаётся на `by3020.hb.by` или переезжает на новый VPS?**
   - Оставить проще: новый VPS должен иметь доступ к MySQL (3306) и его IP должен быть разрешён в MySQL-пользователе/фаерволе хостинга.
   - Если хостинг не разрешает новый IP — ставим MySQL на новый VPS, делаем дамп/импорт и меняем `DB_HOST` на `127.0.0.1`.
2. **Новый адрес API**: `api.ewinners.by` (рекомендую) или новый `IP.sslip.io`.
   - Старый `178.172.137.114.sslip.io` привязан к старому IP; после переноса он не подходит.
3. **AvTunProxy переносим или оставляем на старом VPS?**
   - Перенос: копируем `/opt/avtunproxy` и сервис, проверяем MTBank; возможно, нужно добавить новый IP в белый список банка.
   - Оставить: новый API ходит в старый прокси через приватный туннель/VPN; тогда старый VPS остаётся зависимостью.

## 3. Подготовить новый VPS

Минимум:

- Ubuntu 24.04/26.04 LTS, 2 ГБ RAM, 10+ ГБ диска (сейчас занято ~4,7 ГБ).
- Node.js 22, npm, Nginx, certbot, MySQL client, `curl`, `rsync`, build-essential.
- Для AvTunProxy: Xvfb и библиотеки GTK/AppIndicator (см. `.deploy/install-avtunproxy.sh`).
- Firewall: снаружи 22/80/443; порт 5000 — только localhost.
- Исходящие: 3306 к MySQL (если БД внешняя), 443 к SalesRender/Яндексу/SMTP/Telegram, доступ к MTBank через AvTunProxy.

## 4. Бэкап и перенос файлов

На старом VPS (в согласованное окно, лучше остановив API):

```bash
# код + uploads + .env, без node_modules
tar --exclude='node_modules' --exclude='logs' \
    -czf /root/ewinners-app.tar.gz -C /var/www ewinners-api

# если БД переезжает
mysqldump --single-transaction --routines --triggers --events \
  -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" -p "$DB_NAME" \
  > /root/ewinners-db.sql

# конфиги и банковский прокси
tar -czf /root/ewinners-infra.tar.gz \
  /etc/systemd/system/ewinners-api.service \
  /etc/systemd/system/avtunproxy.service \
  /etc/nginx/sites-available/ewinners-api \
  /etc/cron.d/ewinners-bank-sync \
  /usr/local/bin/ewinners-bank-sync.sh \
  /opt/avtunproxy
```

Скопировать архивы на новый VPS по `scp`/`rsync`. `.env` содержит все секреты — передавать только по SSH, права `600`.

На новом VPS:

```bash
# распаковать в /var/www/ewinners-api
npm ci --omit=dev
# восстановить uploads и .env
# при необходимости импортировать дамп MySQL
```

Приложение само выполняет миграции при старте (`migrate.js`); отдельный шаг миграции не нужен.

## 5. Сервис, Nginx, SSL

- Скопировать `ewinners-api.service`; при желании заменить `User=root` на отдельного пользователя (тогда `chown` на код/uploads и `.env`).
- Скопировать Nginx-конфиг, поменять `server_name` на новый домен/IP, настроить прокси на `127.0.0.1:5000`, WebSocket-заголовки и таймауты 300s для PDF.
- Выпустить сертификат: `certbot --nginx -d api.ewinners.by` (или новый sslip).
- Запустить `ewinners-api`, проверить `curl http://127.0.0.1:5000/api/health`.

## 6. AvTunProxy и MTBank

- Перенести `/opt/avtunproxy` (включая `.config`/`.cache`), создать пользователя `avtunproxy`, установить зависимости, скопировать `avtunproxy.service`, запустить.
- Проверить, что порт `127.0.0.1:10224` слушается и MTBank отвечает (например, остаток по счёту).
- **Самое важное:** если MTBank ограничивает доступ по IP, добавить новый публичный IP VPS в белый список банка. Иначе банковские запросы будут падать, хотя API будет работать.
- Если оставляете AvTunProxy на старом VPS — не открывайте 10224 в интернет; используйте SSH-туннель/VPN, а в `.env` нового API задайте `MTBANK_PROXY` на туннель.

## 7. Cron банка

- Скопировать `/usr/local/bin/ewinners-bank-sync.sh` и `/etc/cron.d/ewinners-bank-sync`.
- Скрипт дергает локальный API каждые 2 минуты.
- **На старом VPS cron обязательно отключить** после переключения: два синка будут одновременно размечать оплаты.

## 8. Что обновить снаружи

1. **Plesk/статический сайт `ewinners.by`** — прокси `/api` (и WebSocket) должен смотреть на новый API `https://api.ewinners.by` или новый IP. У нас нет доступа к `176.60.210.111` — это делается в панели Plesk.
2. **SalesRender webhook** — если он настроен на старый API/sslip, указать новый URL (`https://ewinners.by/api/crm/salesrender/delivered` или новый API).
3. **MTBank** — белый список IP/согласия, если требуется.
4. **`PUBLIC_APP_URL`** в `.env` — сейчас там `https://ewinners.netlify.app`; поставить актуальный сайт (`https://ewinners.by`).
5. **DNS/SSL** — новый API-домен и сертификат.
6. **Yandex Disk / SMTP / Telegram** — проверить исходящий доступ; токены уже в `.env`.

## 9. Переключение и проверка

Порядок:

1. Остановить старый API (или режим обслуживания).
2. Сделать финальный дамп БД и `rsync` uploads.
3. Запустить новый API, проверить health.
4. Переключить Plesk-прокси `/api`, SalesRender webhook, при необходимости MTBank IP.
5. Отключить старый cron банка, старый AvTunProxy/API.
6. Проверить:
   - вход в кабинет и роли HR/админ;
   - направление HR/Digital, счета и акты;
   - банковские остатки/операции;
   - создание счёта и PDF;
   - загрузку файлов;
   - вебхук SalesRender (тестовый заказ/повторный вебхук);
   - почту/Telegram;
   - cron банка и Yandex-бэкап.

Старый VPS не удалять 1–2 недели — это rollback. При проблеме вернуть Plesk-прокси/вебхук на старый API.

## 10. Подводные камни именно этого проекта

- **AvTunProxy** — не обычный HTTP-прокси, а GTK-приложение под Xvfb; просто скопировать бинарник мало, нужны зависимости и `.config`; плюс IP-белый список MTBank.
- **Внешняя MySQL** — новый VPS может не получить доступ; проверять grant/фаервол хостинга заранее.
- **Два bank sync** — легко получить двойное размечание оплат; старый cron выключить.
- **Plesk-прокси** — без обновления `/api` фронтенд будет ходить на старый API, даже если новый уже работает.
- **Сервис под root** — сейчас так; при переносе можно оставить, но лучше отдельный пользователь и права на uploads.
- **Секреты** — `.env` содержит MySQL, JWT, MTBank, SalesRender, Yandex, SMTP, Telegram; передавать только защищённым каналом.

## 11. Что нужно от вас, чтобы я подготовил перенос

- IP/SSH нового VPS и ОС.
- Решение: БД остаётся на `by3020.hb.by` или переезжает.
- Новый адрес API (`api.ewinners.by` или новый IP).
- Есть ли доступ к Plesk `ewinners.by` для правки `/api`-прокси.
- Можно ли добавить новый IP в MTBank/обновить белый список.

После этого можно собрать migration-архив, подготовить скрипт установки и провести переключение с окном простоя.
