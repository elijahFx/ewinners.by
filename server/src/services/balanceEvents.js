/**
 * События об изменении баланса.
 *
 * Отдельный модуль, чтобы billing.js не зависел от socket.io напрямую —
 * иначе получится циклический импорт. Рассылку подключает chatSocket
 * при старте сервера (setBalanceBroadcaster).
 */

let broadcaster = null;

export function setBalanceBroadcaster(fn) {
  broadcaster = typeof fn === 'function' ? fn : null;
}

/**
 * Сообщает клиентам, что баланс изменился.
 *
 * Событие — просто сигнал «перечитай данные»: сумму в нём не передаём,
 * чтобы фронт не показывал устаревшее значение, если транзакция откатится.
 */
export function emitBalanceChanged({ companyId, balanceAfter = null, reason = null } = {}) {
  if (!broadcaster || !companyId) return;
  try {
    const result = broadcaster({ companyId: Number(companyId), balanceAfter, reason });
    if (result && typeof result.then === 'function') {
      result.catch((err) => console.error('[balance] рассылка не удалась:', err.message));
    }
  } catch (err) {
    console.error('[balance] не удалось разослать событие:', err.message);
  }
}
