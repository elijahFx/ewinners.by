# SalesRender → E-Winners

Списание с баланса компании **только при статусе «Вручено» (id = 5)**.  
В SalesRender **ничего не меняем** — только принимаем webhook.

## Тарифы

| Условие | Услуга (code) | Сумма по умолчанию |
|---|---|---|
| Нет галочек `krossejl` и `apseil` | `sr_order_base` | **3 BYN** |
| Хотя бы одна галочка (или обе) | `sr_order_upsell` | **5 BYN** |
| Клиенту подключён доп. тариф | `sr_order_delivered` | **+1.5 BYN** |

Доп. тариф `sr_order_delivered` списывается **только** если у компании есть **свой** тариф на эту услугу (глобального дефолта нет). В админке E-Winners: Тарифы → компания → услуга «Выкупленный заказ» → 1.5.

## Env

```env
SALESRENDER_API_KEY=...          # общий секрет для webhook (в заголовке X-Api-Key)
SALESRENDER_COMPANY_ID=123       # запасной вариант, если название не пришло
```

## Endpoint

```
POST /api/crm/salesrender/delivered
Header: X-Api-Key: <SALESRENDER_API_KEY>
Content-Type: application/json
```

Пример тела:

```json
{
  "orderId": "3324",
  "statusId": 5,
  "statusName": "Вручено",
  "krossejl": false,
  "apseil": true,
  "companyName": "ООО Ромашка",
  "projectId": null,
  "employeeName": "Оператор"
}
```

**Как выбирается компания для списания (по приоритету):**
1. `companyName` / `organization` / `company.name` — ищем в БД E-Winners по названию (без учёта регистра, кавычек, префиксов ООО/ИП)
2. `companyId`
3. `companyApiKey`
4. `SALESRENDER_COMPANY_ID` из `.env`

Если название не найдено → `404`. Если нашлось несколько одинаковых → `409`.

Идемпотентность: повтор по тому же `orderId` не спишет дважды (`sr-delivered-{orderId}`).

## Триггер в SalesRender (настроить вручную)

1. **Управление → Триггеры → +**
2. Событие: **Обновлён**
3. Фильтр: статус заказа == **Вручено** (id 5)  
   (желательно: текущий статус == Вручено **AND** текущий != предыдущий)
4. Действие: **Отправить вебхук**
   - URL: `https://<ваш-api>/api/crm/salesrender/delivered`
   - Заголовок `X-Api-Key: <значение SALESRENDER_API_KEY>`
   - Тело JSON: `orderId`, `statusId`, `krossejl`, `apseil`, **`companyName`** (название организации клиента — как в E-Winners)

## Важно про доступы

Логин/пароль личного кабинета SalesRender **не нужны** серверу E-Winners.  
Достаточно `SALESRENDER_API_KEY` + webhook.
