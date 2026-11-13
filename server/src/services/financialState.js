import { query } from '../db.js';
import { drainPendingCharges, pendingSummary } from './salesrenderPending.js';
import {
  archiveCompanyProjects,
  salesrenderControlConfig,
  unarchiveCompanyProjects,
} from './salesrenderControl.js';

/**
 * Единое финансовое состояние клиента.
 *
 * available = balance + credit_limit (для allow_credit)
 *           = balance              (для hard_stop)
 *           = без ограничения      (для allow_debt)
 *
 * Клиент блокируется, когда available <= 0 или в пограничной зоне есть
 * неоплаченные заказы. Блокировка: пауза внутренних проектов, suspended
 * компании и архивация проектов SalesRender. Разблокировка — только после
 * полного разбора очереди и только для того, что приостановили мы.
 */

export function availableForCompany(company) {
  const mode = company?.low_balance_action || 'allow_credit';
  if (mode === 'allow_debt') return null;
  const balance = Number(company?.balance || 0);
  const limit = mode === 'allow_credit' ? Number(company?.credit_limit || 0) : 0;
  return Number((balance + limit).toFixed(2));
}

export function budgetMode(company) {
  return company?.low_balance_action || 'allow_credit';
}

async function loadCompany(companyId) {
  const rows = await query(
    `SELECT id, name, balance, credit_limit, low_balance_action, status,
            suspended_by_balance, salesrender_id
       FROM companies WHERE id = :id LIMIT 1`,
    { id: Number(companyId) },
  );
  return rows[0] || null;
}

async function loadState(companyId) {
  const rows = await query(
    `SELECT * FROM company_financial_state WHERE company_id = :id LIMIT 1`,
    { id: Number(companyId) },
  );
  return rows[0] || null;
}

async function upsertState({
  companyId,
  blocked,
  applied,
  dryRun,
  reason,
  available,
  pending,
  attempts,
  lastError,
}) {
  await query(
    `INSERT INTO company_financial_state
      (company_id, blocked_by_balance, applied, dry_run, reason, available,
       pending_count, pending_amount, attempts, last_error, blocked_at, unblocked_at)
     VALUES
      (:company_id, :blocked, :applied, :dry_run, :reason, :available,
       :pending_count, :pending_amount, :attempts, :last_error,
       :blocked_at, :unblocked_at)
     ON DUPLICATE KEY UPDATE
       blocked_by_balance = :blocked,
       applied = :applied,
       dry_run = :dry_run,
       reason = :reason,
       available = :available,
       pending_count = :pending_count,
       pending_amount = :pending_amount,
       attempts = :attempts,
       last_error = :last_error,
       blocked_at = IF(:blocked = 1, COALESCE(blocked_at, NOW()), blocked_at),
       unblocked_at = IF(:blocked = 0, NOW(), unblocked_at)`,
    {
      company_id: Number(companyId),
      blocked: blocked ? 1 : 0,
      applied: applied ? 1 : 0,
      dry_run: dryRun ? 1 : 0,
      reason: reason || null,
      available: available == null ? null : available,
      pending_count: pending.count,
      pending_amount: pending.amount,
      attempts: attempts || 0,
      last_error: lastError || null,
      blocked_at: blocked ? new Date() : null,
      unblocked_at: blocked ? null : new Date(),
    },
  );
}

async function pauseInternal(companyId) {
  await query(
    `UPDATE projects SET status = 'paused', paused_by_balance = 1
      WHERE company_id = :id AND status = 'active'`,
    { id: Number(companyId) },
  );
  await query(
    `UPDATE companies SET status = 'suspended', suspended_by_balance = 1
      WHERE id = :id AND status = 'active'`,
    { id: Number(companyId) },
  );
}

async function resumeInternal(companyId) {
  await query(
    `UPDATE projects SET status = 'active', paused_by_balance = 0
      WHERE company_id = :id AND paused_by_balance = 1 AND status = 'paused'`,
    { id: Number(companyId) },
  );
  await query(
    `UPDATE companies SET status = 'active', suspended_by_balance = 0
      WHERE id = :id AND suspended_by_balance = 1 AND status = 'suspended'`,
    { id: Number(companyId) },
  );
}

/**
 * Пересчитывает состояние клиента. В dry-run только пишет состояние и логи,
 * не меняя внутренние статусы и не вызывая мутации SalesRender.
 */
export async function reconcileCompanyState(companyId, { source = 'balance' } = {}) {
  const id = Number(companyId);
  if (!id) return null;
  const company = await loadCompany(id);
  if (!company) return null;

  const pending = await pendingSummary(id);
  const available = availableForCompany(company);
  const state = await loadState(id);
  const cfg = salesrenderControlConfig();
  const dryRun = cfg.dryRun;

  const shouldBlock = pending.count > 0 || (available != null && available <= 0);
  const wasBlocked = Boolean(state?.blocked_by_balance || state?.applied);
  const attempts = Number(state?.attempts || 0);

  if (shouldBlock) {
    let archive = null;
    if (!dryRun) {
      await pauseInternal(id);
      archive = await archiveCompanyProjects(id, { dryRun: false });
    } else {
      archive = await archiveCompanyProjects(id, { dryRun: true });
    }
    const applied = !dryRun && Boolean(archive?.ok);
    const lastError = archive?.error || null;
    await upsertState({
      companyId: id,
      blocked: true,
      applied,
      dryRun,
      reason: pending.count > 0 ? 'pending' : budgetMode(company) === 'hard_stop' ? 'hard_stop' : 'overdraft',
      available,
      pending,
      attempts: lastError ? attempts + 1 : 0,
      lastError,
    });
    if (!wasBlocked || lastError) {
      console.log(
        `[financial-state] company ${id}: blocked=${dryRun ? 'dry-run' : 'applied'} available=${available} pending=${pending.count}/${pending.amount} ${lastError || ''}`,
      );
    }
    return { companyId: id, blocked: true, dryRun, available, pending, archive };
  }

  if (wasBlocked) {
    // Если проект уже был архивирован в боевом режиме, dry-run не должен
    // «забыть» об этом: иначе состояние скажет «разблокирован», а проект
    // останется архивным навсегда.
    if (dryRun && Number(state?.applied) === 1) {
      console.log(
        `[financial-state] company ${id}: dry-run, но проект уже архивирован боевым режимом — оставляю blocked`,
      );
      return { companyId: id, blocked: true, dryRun, available, pending, unarchive: null };
    }

    const unarchive = await unarchiveCompanyProjects(id, { dryRun });
    if (!dryRun && unarchive?.ok === false) {
      // Не снимаем внутреннюю блокировку и не теряем applied: следующий тик
      // повторит разархивацию, пока SalesRender не подтвердит успех.
      await upsertState({
        companyId: id,
        blocked: true,
        applied: true,
        dryRun: false,
        reason: 'unarchive_error',
        available,
        pending,
        attempts: attempts + 1,
        lastError: unarchive.error || 'Не удалось разархивировать проект SalesRender',
      });
      console.warn(
        `[financial-state] company ${id}: не удалось разархивировать, повторю позже: ${unarchive?.error || ''}`,
      );
      return { companyId: id, blocked: true, dryRun, available, pending, unarchive };
    }

    if (!dryRun) await resumeInternal(id);
    await upsertState({
      companyId: id,
      blocked: false,
      applied: false,
      dryRun,
      reason: null,
      available,
      pending,
      attempts: unarchive?.error ? attempts + 1 : 0,
      lastError: unarchive?.error || null,
    });
    console.log(
      `[financial-state] company ${id}: unblocked=${dryRun ? 'dry-run' : 'applied'} available=${available} ${unarchive?.error || ''}`,
    );
    return { companyId: id, blocked: false, dryRun, available, pending, unarchive };
  }

  return { companyId: id, blocked: false, dryRun, available, pending };
}

const running = new Set();
const queued = new Set();

/** Ставит пересчёт в очередь, не задерживая ответ вебхука/кассы. */
export function scheduleCompanyReconcile(companyId) {
  const id = Number(companyId);
  if (!id) return;
  if (running.has(id)) {
    queued.add(id);
    return;
  }
  running.add(id);
  setImmediate(async () => {
    try {
      await reconcileCompanyState(id);
    } catch (err) {
      console.error('[financial-state] ошибка пересчёта:', err.message);
    } finally {
      running.delete(id);
      if (queued.delete(id)) scheduleCompanyReconcile(id);
    }
  });
}

/**
 * После изменения баланса: при зачислении сначала разбираем пограничную зону,
 * затем пересчитываем состояние. Для списания — только пересчёт.
 */
export async function afterBalanceChange(companyId, { credit = false } = {}) {
  if (credit) {
    try {
      const result = await drainPendingCharges(companyId);
      if (result.charged) {
        console.log(
          `[financial-state] company ${companyId}: из пограничной зоны списано ${result.charged} на ${result.amount} BYN`,
        );
      }
    } catch (err) {
      console.error('[financial-state] очередь не разобрана:', err.message);
    }
  }
  scheduleCompanyReconcile(companyId);
}

/** Быстрая проверка для внутреннего CRM API. */
export async function isCompanyBlocked(companyId) {
  const company = await loadCompany(companyId);
  if (!company) return { blocked: true, reason: 'company_not_found' };
  const pending = await pendingSummary(companyId);
  const available = availableForCompany(company);
  const blocked = pending.count > 0 || (available != null && available <= 0);
  return {
    blocked,
    reason: pending.count > 0 ? 'pending' : budgetMode(company),
    available,
    pending,
    company,
  };
}

export async function getCompanyFinancialState(companyId) {
  const company = await loadCompany(companyId);
  if (!company) return null;
  const [state, pending] = await Promise.all([loadState(companyId), pendingSummary(companyId)]);
  return {
    company,
    state,
    pending,
    available: availableForCompany(company),
    dryRun: salesrenderControlConfig().dryRun,
  };
}

export async function listBlockedCompanies() {
  const rows = await query(
    `SELECT s.*, c.name AS company_name, c.balance AS company_balance,
            c.credit_limit AS company_credit_limit, c.low_balance_action
       FROM company_financial_state s
       JOIN companies c ON c.id = s.company_id
      WHERE s.blocked_by_balance = 1
      ORDER BY s.available ASC, s.company_id`,
  );
  return rows;
}

export async function listProjectStates(companyId = null) {
  const params = {};
  let where = 'WHERE 1 = 1';
  if (companyId) {
    where += ' AND p.company_id = :company_id';
    params.company_id = Number(companyId);
  }
  return query(
    `SELECT p.*, c.name AS company_name
       FROM salesrender_project_state p
       JOIN companies c ON c.id = p.company_id
       ${where}
      ORDER BY p.company_id, p.salesrender_project_id`,
    params,
  );
}

let syncTimer = null;
let syncRunning = false;

/**
 * Периодический пересчёт: ловит клиентов, которые ушли в минус, и проекты,
 * которые не удалось архивировать/разархивировать из-за сбоя SalesRender.
 */
export function scheduleFinancialStateSync() {
  if (syncTimer) return syncTimer;
  const tick = async () => {
    if (syncRunning) return;
    syncRunning = true;
    try {
      const rows = await query(
        `SELECT DISTINCT c.id
           FROM companies c
           LEFT JOIN company_financial_state s ON s.company_id = c.id
          WHERE EXISTS (
                  SELECT 1 FROM salesrender_pending_charges pc
                   WHERE pc.company_id = c.id AND pc.status = 'pending'
                )
             OR s.blocked_by_balance = 1
             OR s.applied = 1
             OR (s.company_id IS NOT NULL AND s.last_error IS NOT NULL)
             OR (c.low_balance_action = 'hard_stop' AND c.balance <= 0)
             OR (c.low_balance_action = 'allow_credit' AND c.balance + c.credit_limit <= 0)`,
      );
      for (const row of rows) {
        const company = await loadCompany(row.id);
        if (!company) continue;
        const pending = await pendingSummary(row.id);
        const available = availableForCompany(company);
        if (pending.count > 0 && available != null && available > 0) {
          await drainPendingCharges(row.id);
        }
        await reconcileCompanyState(row.id, { source: 'scheduler' });
      }
    } catch (err) {
      console.error('[financial-state] синхронизация не удалась:', err.message);
    } finally {
      syncRunning = false;
    }
  };
  syncTimer = setInterval(tick, 2 * 60 * 1000);
  syncTimer.unref?.();
  setTimeout(tick, 5_000).unref?.();
  console.log(
    `[financial-state] планировщик состояния запущен (${salesrenderControlConfig().dryRun ? 'dry-run' : 'боевой режим'})`,
  );
  return syncTimer;
}
