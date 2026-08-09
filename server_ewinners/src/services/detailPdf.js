import path from 'path';
import { config } from '../db.js';
import { createPdfWriter, docsDir, drawHeader, money } from './pdfHelpers.js';

export async function generateDetailPdf({ number, company, items, periodLabel, createdAt }) {
  const fileName = `detail-${number.replace(/[^\w.-]+/g, '_')}.pdf`;
  const filePath = path.join(docsDir, fileName);
  const issuer = config.company;
  const { doc, done } = createPdfWriter(filePath, `Детализация ${number}`);
  const { left, width } = drawHeader(doc, 'Детализация оказанных услуг');

  doc.font('Bold').fontSize(18).fillColor('#0b1f3a').text('ДЕТАЛИЗАЦИЯ УСЛУГ', left, 110, { width });
  doc.moveDown(0.35);
  doc.font('Regular').fontSize(11).fillColor('#333');
  doc.text(`Номер: ${number}`);
  doc.text(`Дата: ${createdAt}`);
  if (periodLabel) doc.text(`Период: ${periodLabel}`);
  doc.text(`Клиент: ${company.name || '—'}`);
  if (company.unp) doc.text(`УНП: ${company.unp}`);
  doc.moveDown(0.8);

  const colDate = left;
  const colService = left + 70;
  const colQty = left + width - 170;
  const colSum = left + width - 90;
  let y = doc.y;

  doc.font('Bold').fontSize(9).fillColor('#0b1f3a');
  doc.text('Дата', colDate, y, { width: 65 });
  doc.text('Услуга / комментарий', colService, y, { width: width - 180 });
  doc.text('Кол-во', colQty, y, { width: 50 });
  doc.text('Сумма', colSum, y, { width: 80, align: 'right' });
  y += 16;
  doc.moveTo(left, y).lineTo(left + width, y).strokeColor('#93c5fd').stroke();
  y += 8;

  let total = 0;
  doc.font('Regular').fontSize(9).fillColor('#333');
  for (const item of items) {
    if (y > 760) {
      doc.addPage();
      y = 48;
    }
    const amount = Number(item.amount || 0);
    total += amount;
    const title = item.service_name || item.comment || item.category || 'Операция';
    doc.text(item.date || '—', colDate, y, { width: 65 });
    doc.text(String(title).slice(0, 70), colService, y, { width: width - 180 });
    doc.text(item.quantity != null ? String(item.quantity) : '—', colQty, y, { width: 50 });
    doc.text(money(amount), colSum, y, { width: 80, align: 'right' });
    y += 16;
  }

  y += 8;
  doc.moveTo(left, y).lineTo(left + width, y).strokeColor('#93c5fd').stroke();
  y += 12;
  doc.font('Bold').fontSize(11).fillColor('#0b1f3a').text(`Итого: ${money(total)}`, left, y, {
    width,
    align: 'right',
  });

  y += 28;
  doc
    .font('Regular')
    .fontSize(9)
    .fillColor('#666')
    .text(
      `Документ сформирован автоматически в личном кабинете E-Winners (${issuer.name || 'E-Winners'}).`,
      left,
      y,
      { width },
    );

  await done();
  return { filePath, fileName, total };
}
