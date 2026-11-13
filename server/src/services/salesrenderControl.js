import { query } from '../db.js';

/**
 * Управление проектами SalesRender.
 *
 * Архивация проекта — единственный доступный способ запретить создание новых
 * заказов (AddOrderInput → ERR_ORDER_PROJECT_ARCHIVED). Существующие заказы
 * остаются доступными, поэтому их списания идут в пограничную зону.
 *
 * По умолчанию включён dry-run: состояние считается и пишется в БД, но реальные
 * проекты не архивируются. Боевой режим — SALESRENDER_CONTROL_DRY_RUN=0.
 */

function env(name, fallback = '') {
  return String(process.env[name] || fallback).trim();
}

function cidFromToken(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    return payload?.cid ? String(payload.cid) : null;
  } catch {
    return null;
  }
}

export function salesrenderControlConfig() {
  const token = env('SALESRENDER_API_KEY');
  const cid = cidFromToken(token);
  const dryRun = env('SALESRENDER_CONTROL_DRY_RUN', '1') !== '0';
  return {
    token,
    cid,
    dryRun,
    configured: Boolean(token && cid),
    apiBase: cid ? `https://de.backend.salesrender.com/companies/${cid}/CRM` : null,
  };
}

async function graphql(queryText, variables = {}) {
  const cfg = salesrenderControlConfig();
  if (!cfg.configured) throw new Error('SalesRender API не настроен');
  const res = await fetch(cfg.apiBase, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: queryText, variables }),
    signal: AbortSignal.timeout(20_000),
  });
  const data = await res.json().catch(() => ({}));
  if (data.errors?.length) {
    const first = data.errors[0];
    const err = new Error(`SalesRender: ${first.message || 'ошибка API'}`);
    err.code = first.extensions?.code || null;
    throw err;
  }
  if (!res.ok) throw new Error(`SalesRender HTTP ${res.status}`);
  return data.data;
}

function validProjectId(value) {
  const id = String(value ?? '').trim();
  return /^\d+$/.test(id) && id !== '0' ? id : null;
}

export async function projectIdsForCompany(companyId) {
  const rows = await query(
    `SELECT salesrender_id AS id FROM companies WHERE id = :id
     UNION
     SELECT salesrender_id AS id FROM company_salesrender_projects WHERE company_id = :id`,
    { id: Number(companyId) },
  );
  const out = [];
  const seen = new Set();
  for (const row of rows) {
    const id = validProjectId(row.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export async function fetchProjectStates(ids) {
  const projectIds = [...new Set(ids.map(validProjectId).filter(Boolean))];
  if (!projectIds.length) return new Map();
  const data = await graphql(
    `query ProjectStates($ids: [ID!]) {
       projectsFetcher(
         filters: { include: { ids: $ids } }
         pagination: { pageNumber: 1, pageSize: 100 }
       ) {
         projects { id archived }
         pageInfo { itemsCount }
       }
     }`,
    { ids: projectIds },
  );
  const map = new Map();
  for (const project of data?.projectsFetcher?.projects || []) {
    map.set(String(project.id), Boolean(project.archived));
  }
  return map;
}

async function setProjectArchived(projectId, archived) {
  return graphql(
    `mutation SetProjectArchived($input: UpdateProjectInput!) {
       projectMutation {
         updateProject(input: $input) { id archived }
       }
     }`,
    { input: { id: String(projectId), archived: Boolean(archived) } },
  );
}

async function upsertProjectState({
  companyId,
  projectId,
  archivedByUs = null,
  archivedAt = false,
  unarchivedAt = false,
  error = null,
}) {
  await query(
    `INSERT INTO salesrender_project_state
      (company_id, salesrender_project_id, archived_by_us, archived_at, unarchived_at, attempts, last_error)
     VALUES
      (:company_id, :project_id, :archived_by_us, :archived_at, :unarchived_at, 0, :last_error)
     ON DUPLICATE KEY UPDATE
       archived_by_us = IF(:archived_by_us_set, :archived_by_us, archived_by_us),
       archived_at = IF(:archived_at_set, NOW(), archived_at),
       unarchived_at = IF(:unarchived_at_set, NOW(), unarchived_at),
       attempts = IF(:last_error IS NULL, 0, attempts + 1),
       last_error = :last_error`,
    {
      company_id: Number(companyId),
      project_id: String(projectId),
      archived_by_us: archivedByUs === null ? 0 : archivedByUs ? 1 : 0,
      archived_by_us_set: archivedByUs === null ? 0 : 1,
      archived_at: archivedAt ? new Date() : null,
      archived_at_set: archivedAt ? 1 : 0,
      unarchived_at: unarchivedAt ? new Date() : null,
      unarchived_at_set: unarchivedAt ? 1 : 0,
      last_error: error,
    },
  );
}

/** Архивирует все SalesRender-проекты клиента. Возвращает отчёт для состояния. */
const dryRunLogged = new Set();

export async function archiveCompanyProjects(companyId, { dryRun = null } = {}) {
  const cfg = salesrenderControlConfig();
  const isDryRun = dryRun === null ? cfg.dryRun : Boolean(dryRun);
  if (!cfg.configured) {
    return { ok: false, dryRun: isDryRun, attempted: 0, archived: 0, failed: 0, missing: 0, error: 'SalesRender API не настроен' };
  }

  const ids = await projectIdsForCompany(companyId);
  if (!ids.length) {
    return { ok: true, dryRun: isDryRun, attempted: 0, archived: 0, failed: 0, missing: 0, error: null };
  }

  let states;
  try {
    states = await fetchProjectStates(ids);
  } catch (err) {
    return { ok: false, dryRun: isDryRun, attempted: 0, archived: 0, failed: 0, missing: 0, error: err.message };
  }

  let archived = 0;
  let failed = 0;
  let missing = 0;
  const errors = [];

  for (const id of ids) {
    if (!states.has(id)) {
      missing += 1;
      await upsertProjectState({ companyId, projectId: id, error: 'Проект SalesRender не найден' });
      continue;
    }
    if (states.get(id) === true) {
      // Проект уже архивирован. Если ранее наша попытка архивации упала
      // (например, CRM применил мутацию, но ответ потерялся), считаем архив
      // своим — иначе при разблокировке он останется архивным навсегда.
      const existing = await query(
        `SELECT archived_by_us, attempts FROM salesrender_project_state
          WHERE company_id = :company_id AND salesrender_project_id = :project_id
          LIMIT 1`,
        { company_id: Number(companyId), project_id: String(id) },
      );
      const row = existing[0];
      const assumeOurs =
        row && Number(row.archived_by_us) !== 1 && Number(row.attempts || 0) > 0;
      if (assumeOurs) {
        console.log(
          `[salesrender-control] проект ${id} уже архивирован после неудачной попытки — считаю архив нашим (company ${companyId})`,
        );
      }
      await upsertProjectState({
        companyId,
        projectId: id,
        archivedByUs: assumeOurs ? true : null,
        archivedAt: assumeOurs,
        error: null,
      });
      continue;
    }
    if (isDryRun) {
      const key = `${companyId}:${id}`;
      if (!dryRunLogged.has(key)) {
        console.log(`[salesrender-control] dry-run: архивировал бы проект ${id} (company ${companyId})`);
        dryRunLogged.add(key);
      }
      continue;
    }
    try {
      await setProjectArchived(id, true);
      archived += 1;
      await upsertProjectState({ companyId, projectId: id, archivedByUs: true, archivedAt: true, error: null });
      console.log(`[salesrender-control] проект ${id} архивирован (company ${companyId})`);
    } catch (err) {
      failed += 1;
      errors.push(`${id}: ${err.message}`);
      await upsertProjectState({ companyId, projectId: id, error: err.message });
      console.warn(`[salesrender-control] не удалось архивировать ${id}:`, err.message);
    }
  }

  return {
    ok: failed === 0 && missing === 0,
    dryRun: isDryRun,
    attempted: ids.length,
    archived,
    failed,
    missing,
    error: errors.length ? errors.join('; ') : missing ? 'Часть проектов не найдена' : null,
  };
}

/** Разархивирует только те проекты, которые архивировали мы. */
export async function unarchiveCompanyProjects(companyId, { dryRun = null } = {}) {
  const cfg = salesrenderControlConfig();
  const isDryRun = dryRun === null ? cfg.dryRun : Boolean(dryRun);
  if (!cfg.configured) {
    return { ok: false, dryRun: isDryRun, attempted: 0, unarchived: 0, failed: 0, error: 'SalesRender API не настроен' };
  }

  const rows = await query(
    `SELECT salesrender_project_id FROM salesrender_project_state
      WHERE company_id = :company_id AND archived_by_us = 1`,
    { company_id: Number(companyId) },
  );
  const ids = rows.map((row) => validProjectId(row.salesrender_project_id)).filter(Boolean);
  if (!ids.length) {
    return { ok: true, dryRun: isDryRun, attempted: 0, unarchived: 0, failed: 0, error: null };
  }

  let states;
  try {
    states = await fetchProjectStates(ids);
  } catch (err) {
    return { ok: false, dryRun: isDryRun, attempted: ids.length, unarchived: 0, failed: ids.length, error: err.message };
  }

  let unarchived = 0;
  let failed = 0;
  const errors = [];
  for (const id of ids) {
    if (states.get(id) === false) {
      // Уже разархивирован — просто снимаем нашу отметку.
      await upsertProjectState({ companyId, projectId: id, archivedByUs: false, unarchivedAt: true, error: null });
      continue;
    }
    if (isDryRun) {
      console.log(`[salesrender-control] dry-run: разархивировал бы проект ${id} (company ${companyId})`);
      continue;
    }
    try {
      await setProjectArchived(id, false);
      unarchived += 1;
      await upsertProjectState({ companyId, projectId: id, archivedByUs: false, unarchivedAt: true, error: null });
      console.log(`[salesrender-control] проект ${id} разархивирован (company ${companyId})`);
    } catch (err) {
      failed += 1;
      errors.push(`${id}: ${err.message}`);
      await upsertProjectState({ companyId, projectId: id, error: err.message });
      console.warn(`[salesrender-control] не удалось разархивировать ${id}:`, err.message);
    }
  }

  return {
    ok: failed === 0,
    dryRun: isDryRun,
    attempted: ids.length,
    unarchived,
    failed,
    error: errors.length ? errors.join('; ') : null,
  };
}
