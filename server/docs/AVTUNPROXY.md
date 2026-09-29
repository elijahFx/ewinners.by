# AvTunProxy на VPS (для MTBank Open API)

[AvTunProxy](https://avtunproxy.by/) — криптопрокси ЗАО «АВЕСТ» (СТБ 34.101.65 /
34.101.45), через который `openapi.mtbank.by` доступен по HTTPS.

Для Open API **аппаратный носитель не нужен**: API-key даёт авторизацию, а
прокси обеспечивает только белорусский TLS. Токен (AvToken/AvPass/ID-карта)
требуется лишь для выработки ЭЦП, которой Open API не пользуется.

## Что установлено на 178.172.137.114

| Компонент | Где |
|---|---|
| Программа | `/opt/avtunproxy/` (v5.10.12-r1757) |
| Сервис | `avtunproxy.service` — пользователь `avtunproxy`, автозапуск |
| Launcher | `/opt/avtunproxy/run.sh` (Xvfb `:99` + приложение) |
| Прокси | `http://127.0.0.1:10224` (используется как `MTBANK_PROXY`) |

Поставленные для этого пакеты: `libappindicator3-1`, `libgtk-3-0`, `xvfb`,
`libusb-1.0-0`, `libpcsclite1`.

## 1. Зачем Xvfb

AvTunProxy — GTK/AppIndicator-приложение с иконкой в системном трее, поэтому
требует X-дисплей, хотя наружу отдаёт только HTTP-прокси. `run.sh` поднимает
`Xvfb :99` и запускает приложение с `DISPLAY=:99`.

## 2. Патч `libavc.so` — обязательный шаг

`libavc.so` из дистрибутива помечен как требующий **исполняемого стека**
(`PT_GNU_STACK` = `RWE`). glibc 2.41+ (в Ubuntu 26.04 — 2.43) отказывается
загружать такие библиотеки:

```
error loading AVC (/opt/avtunproxy/libavc.so): Can't load module /opt/avtunproxy/libavc.so
cannot enable executable stack as shared object requires: Invalid argument
```

Штатный `execstack` в Ubuntu 26.04 не поставляется, поэтому флаг снимается
скриптом `fix-execstack.py` из этой папки:

```bash
python3 fix-execstack.py /opt/avtunproxy/libavc.so
# /opt/avtunproxy/libavc.so: GNU_STACK 0x7 -> 0x6 (original saved as .orig)
```

Оригинал остаётся рядом как `libavc.so.orig`. **При обновлении или
переустановке AvTunProxy патч нужно применить заново**, иначе сервис упадёт
в цикл рестартов.

## 3. Залипший lock-файл

AvTunProxy держит PID-файл `/tmp/avtunproxy.run`. После жёсткого kill (или
запуска из-под другого пользователя) он остаётся, и старт падает с
`Another instance of AVTUNPROXY is already running`. `run.sh` удаляет его, если
ни одного живого процесса `avtunproxy` нет.

## 4. Проверка

```bash
systemctl status avtunproxy
curl -k -sS -x http://127.0.0.1:10224 -o /dev/null -w '%{http_code}\n' https://openapi.mtbank.by/
# -> 303
```

## 5. Синхронизация платежей

- Скрипт: `/usr/local/bin/ewinners-bank-sync.sh`
- Расписание: `/etc/cron.d/ewinners-bank-sync` — каждые 2 минуты
- Лог: `/var/log/ewinners-bank-sync.log` (+ `/etc/logrotate.d/ewinners-bank-sync`)

Вызывает `POST /api/internal/bank/sync?lookbackDays=7`. Заменяет
`server/cron/mtbank_check_payments.php` со старого хостинга (там не было PHP, а
`PUBLIC_APP_URL` указывал на Netlify). Секрет читается из
`/var/www/ewinners-api/.env`: `MTBANK_CRON_SECRET`, иначе `CRM_API_KEY`.

## 6. Согласие `accountConsents`

Согласие создано и прописано в `/var/www/ewinners-api/.env`:

| Переменная | Значение |
|---|---|
| `MTBANK_CONSENT_ID` | `1ab7f9f6-9de4-4a5c8437-696e1b5d9a74` |
| `MTBANK_ACCOUNT_IBAN` | `BY84MTBK30120001093300130382` |

Создано до **2029-09-28**. Статус — **`Authorised`** (авторизовано в кабинете
по SMS 2026-09-28), синхронизация работает.

> В таблице `companies` IBAN записан кириллическими двойниками (`BY 84 МТВК …`).
> Настоящий IBAN — латиницей: `MTBK`.

### Контракт запросов MTBank (важно)

Тело запросов валидируется по строгой JSON-схеме
(`additionalProperties: false`), поэтому **регистр и вложенность критичны**:

```jsonc
// POST /accountConsents
{ "data": { "permissions": ["ReadAccountsBasic", …], "expirationDate": "YYYY-MM-DD" }, "risk": {} }

// POST /statements/{accountId}                      — коллекция именно здесь
{ "data": { "statement": { "fromBookingDate": "YYYY-MM-DD", "toBookingDate": "YYYY-MM-DD" } }, "risk": {} }

// POST /accounts/{accountId}/transactions           — список готовится асинхронно
{ "data": { "transaction": { "fromBookingDateTime": "ISO", "toBookingDateTime": "ISO" } }, "risk": {} }
```

`risk` обязателен и должен быть **пустым объектом**.

Перечень транзакций отдаётся в два шага:

1. `POST /accounts/{id}/transactions` → `data.transaction.transactionListId`
2. `GET  /accounts/{id}/transactions/{transactionListId}` → `data.transaction[]`

**Список готовится асинхронно.** Пока он строится, GET отвечает `202` с пустым
телом. Долгий период строится ~12–20 с, поэтому опрашиваем до 90 с
(`waitForTransactionList`), забирая ответ только при `200`.

**Список пагинируется по 25 записей.** `meta.totalPages` / `meta.totalEntries`
сообщают объём: за январь–сентябрь 2026 это 643 операции на 26 страницах.
Параметр `size` банк игнорирует — всегда отдаёт 25
(`maximumEntriesAllowedPerPage: 25`), так что страницы перебираются циклом
(`?page=N&size=25`), максимум 60 страниц.

Полный запрос за 9 месяцев занимает ~30 с (12 с на подготовку + 18 с на
страницы), поэтому результат кэшируется на 60 с (`STATEMENT_TTL_MS`) — поиск и
переключение вкладок не дёргают банк повторно. Кнопка «Обновить» и синхронизация
передаёт `refresh=1` и кэш обходит.

Выписка устроена так же: `POST /statements/{accountId}` →
`GET /accounts/{id}/statements/{statementId}`.

Остаток берётся отдельным методом `GET /accounts/{accountId}/balances` →
`data.balance[]`. Банк возвращает несколько типов остатка, выбирается по
приоритету: `CLAV` (доступный) → `ITAV` → `CLBD` → `ITBD` → прочие.

Три вызова — счета, остаток и движения — независимы, поэтому выполняются
**параллельно** (`Promise.allSettled`). Если остаток не пришёл, выписка всё
равно отдаётся: поле `balance` остаётся `null`, в лог пишется предупреждение.

Что было не так в исходном коде (исправлено в
`server/src/services/mtbank.js`):

| Было | Ответ банка | Стало |
|---|---|---|
| `Data` / `Permissions` / `ExpirationDateTime`, без `risk` | `400 Элемент сформирован некорректно` | `data` / `permissions` / `expirationDate` + `risk: {}` |
| `GET /accounts/{id}/transactions?fromBookingDateTime=…` | `405 Method Not Allowed` | `POST` + `GET …/{transactionListId}` |
| `POST /accounts/{id}/statements` | `404` | `POST /statements/{accountId}` |
| Остаток в таблице всегда `0.00` | — | баланс читается из `{ balanceAmount }`, а не только `{ amount }` |
| Карточка «Остаток» — всегда `—` | — | подключён `GET /accounts/{id}/balances` |
| УНП сохранялся как `INN193761799` | — | префикс `INN`/`UNP`/`УНП` срезается |
| IBAN и название счёта не читались | — | читаются `accountDetails.identification`, `accountDescription` |
| Читалась только первая страница (25 записей) | — | перебираются все страницы (`meta.totalPages`) |
| На длинном периоде список забирался пустым | `202` | ожидание готовности до 90 с |
| Каждый поиск/вкладка заново дёргали банк | — | кэш выписки 60 с, `refresh=1` для обновления |


Схемы (доступны только через AvTunProxy):

- спецификация: `https://api-swagger.mtbank.by/JSON5DropComments/SC-MAP.v3.0.swagger.json5`
- схемы запросов: `https://api-swagger.mtbank.by/schemas/*.json`

