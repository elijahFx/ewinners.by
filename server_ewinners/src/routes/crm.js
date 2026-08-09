import { Router } from 'express';
import { query } from '../db.js';
import { crmAuth } from '../middleware/auth.js';
import {
  debitBalance,
  getEffectiveTariff,
  notifyCompanyUsers,
} from '../services/billing.js';

const router = Router();

router.post('/events', crmAuth, async (req, res) => {
  const payload = req.body || {};
  const eventId = String(payload.eventId || payload.crm_event_id || '').trim();

  try {
    if (!eventId) {
      await query(
        `INSERT INTO crm_event_log (event_id, payload, status, error_message)
         VALUES (NULL, :payload, 'error', 'eventId обязателен')`,
        { payload: JSON.stringify(payload) },
      );
      return res.status(400).json({ error: 'eventId обязателен' });
    }

    const dup = await query(
      `SELECT id FROM transactions WHERE crm_event_id = :event_id LIMIT 1`,
      { event_id: eventId },
    );
    if (dup.length) {
      await query(
        `INSERT INTO crm_event_log (event_id, payload, status, error_message)
         VALUES (:event_id, :payload, 'duplicate', 'Повторное событие')`,
        { event_id: eventId, payload: JSON.stringify(payload) },
      );
      return res.json({ ok: true, duplicate: true });
    }

    const companyId = Number(payload.companyId);
    const projectId = payload.projectId ? Number(payload.projectId) : null;
    const serviceCode = String(payload.serviceCode || '').trim();
    const quantity = Number(payload.quantity || 1);
    const employeeName = payload.employeeName || null;

    if (!companyId || !serviceCode || !(quantity > 0)) {
      throw new Error('companyId, serviceCode и quantity обязательны');
    }

    const companies = await query('SELECT * FROM companies WHERE id = :id', { id: companyId });
    const company = companies[0];
    if (!company) throw new Error('Компания не найдена');

    if (projectId) {
      const projects = await query(
        `SELECT * FROM projects WHERE id = :id AND company_id = :company_id`,
        { id: projectId, company_id: companyId },
      );
      const project = projects[0];
      if (!project) throw new Error('Проект не найден');
      if (project.status === 'paused' && company.low_balance_action === 'hard_stop') {
        throw new Error('Проект приостановлен из-за баланса');
      }
    }

    const services = await query('SELECT * FROM services WHERE code = :code AND is_active = 1', {
      code: serviceCode,
    });
    const service = services[0];
    if (!service) throw new Error(`Услуга ${serviceCode} не найдена`);

    const tariff = await getEffectiveTariff({
      companyId,
      projectId,
      serviceId: service.id,
    });
    if (!tariff) throw new Error('Тариф не найден');

    const unitPrice = Number(tariff.price);
    const amount = Number((unitPrice * quantity).toFixed(2));

    const result = await debitBalance({
      companyId,
      projectId,
      category: serviceCode === 'subscription' ? 'subscription' : 'crm_action',
      amount,
      serviceId: service.id,
      tariffId: tariff.id,
      quantity,
      unitPrice,
      crmEventId: eventId,
      employeeName,
      comment: payload.comment || `${service.name} × ${quantity}`,
    });

    await query(
      `INSERT INTO crm_event_log (event_id, payload, status)
       VALUES (:event_id, :payload, 'processed')`,
      { event_id: eventId, payload: JSON.stringify(payload) },
    );

    const updated = await query('SELECT balance, notify_threshold FROM companies WHERE id = :id', {
      id: companyId,
    });
    if (Number(updated[0].balance) <= Number(updated[0].notify_threshold)) {
      await notifyCompanyUsers(
        companyId,
        'Низкий баланс',
        `Текущий баланс: ${Number(updated[0].balance).toFixed(2)} BYN`,
      );
    }

    res.json({ ok: true, ...result, amount });
  } catch (err) {
    console.error(err);
    await query(
      `INSERT INTO crm_event_log (event_id, payload, status, error_message)
       VALUES (:event_id, :payload, 'error', :error_message)`,
      {
        event_id: eventId || null,
        payload: JSON.stringify(payload),
        error_message: err.message || String(err),
      },
    );
    res.status(400).json({ error: err.message || 'Ошибка обработки CRM события' });
  }
});

export default router;
