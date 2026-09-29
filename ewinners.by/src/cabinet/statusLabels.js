export const STATUS_LABELS = {
  // documents / invoices
  published: 'Опубликован',
  ready: 'Готов',
  created: 'Создан',
  awaiting_payment: 'Ожидает оплаты',
  partially_paid: 'Частично оплачен',
  paid: 'Оплачен',
  overdue: 'Просрочен',
  cancelled: 'Отменён',
  needs_review: 'Требует проверки',
  draft: 'Черновик',
  // companies / projects / users
  active: 'Активен',
  suspended: 'Приостановлен',
  blocked: 'Заблокирован',
  invited: 'Приглашён',
  archived: 'В архиве',
  // payments
  imported: 'Импортирован',
  matched: 'Сопоставлен',
  credited: 'Зачислен',
  ignored: 'Игнорирован',
  pending: 'В ожидании',
  // roles (sometimes shown as status-like chips)
  client: 'Клиент',
  admin: 'Админ',
  accountant: 'Бухгалтер',
  manager: 'Менеджер',
  // billing types
  unit: 'За единицу',
  minute: 'За минуту',
  fixed: 'Фикс',
  subscription: 'Подписка',
}

export function statusLabel(value) {
  if (value == null || value === '') return '—'
  const key = String(value)
  return STATUS_LABELS[key] || STATUS_LABELS[key.toLowerCase()] || key
}

/** Категории операций по балансу (transactions.category). */
export const CATEGORY_LABELS = {
  bank_payment: 'Банковское поступление',
  manual_credit: 'Ручное зачисление',
  manual_debit: 'Ручное списание',
  refund: 'Возврат',
  bonus: 'Бонус',
  transfer: 'Перевод',
  crm_action: 'Списание по CRM',
  subscription: 'Абонентская плата',
  extra_service: 'Дополнительная услуга',
  recalc: 'Пересчёт',
}

export function categoryLabel(value) {
  if (value == null || value === '') return '—'
  const key = String(value)
  return CATEGORY_LABELS[key] || CATEGORY_LABELS[key.toLowerCase()] || statusLabel(key)
}
