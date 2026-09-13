import path from 'path';
import { config } from '../db.js';
import { createPdfWriter, docsDir, drawHeader, money } from './pdfHelpers.js';

export async function generateActPdf({ number, amount, purpose, company, createdAt, paidAt }) {
  const fileName = `act-${number.replace(/[^\w.-]+/g, '_')}.pdf`;
  const filePath = path.join(docsDir, fileName);
  const issuer = config.company;
  const { doc, done } = createPdfWriter(filePath, `Акт ${number}`);
  const { left, width } = drawHeader(doc, 'Акт оказанных услуг');

  doc.font('Bold').fontSize(18).fillColor('#0b1f3a').text('АКТ ОКАЗАННЫХ УСЛУГ', left, 110, { width });
  doc.moveDown(0.4);
  doc.font('Regular').fontSize(11).fillColor('#333');
  doc.text(`Номер: ${number}`);
  doc.text(`Дата составления: ${createdAt}`);
  if (paidAt) doc.text(`Дата оплаты: ${paidAt}`);
  doc.moveDown(0.8);

  doc.font('Bold').fontSize(12).fillColor('#0b1f3a').text('Исполнитель');
  doc.moveDown(0.25);
  doc.font('Bold').fontSize(10).fillColor('#111').text(issuer.name || 'E-Winners', { width });
  doc.font('Regular').fontSize(10).fillColor('#333');
  if (issuer.unp) doc.text(`УНП: ${issuer.unp}`);
  if (issuer.address) doc.text(issuer.address, { width });
  doc.moveDown(0.7);

  doc.font('Bold').fontSize(12).fillColor('#0b1f3a').text('Заказчик');
  doc.moveDown(0.25);
  doc.font('Bold').fontSize(10).fillColor('#111').text(company.name || '—', { width });
  doc.font('Regular').fontSize(10).fillColor('#333');
  if (company.unp) doc.text(`УНП: ${company.unp}`);
  if (company.legal_address) doc.text(company.legal_address, { width });
  doc.moveDown(0.7);

  doc.font('Bold').fontSize(12).fillColor('#0b1f3a').text('Предмет акта');
  doc.moveDown(0.25);
  doc
    .font('Regular')
    .fontSize(10)
    .fillColor('#333')
    .text(
      purpose ||
        `Оказание услуг по счёту ${number}. Акт подтверждает оказание услуг на сумму авансового платежа.`,
      { width },
    );
  doc.moveDown(0.8);

  const boxY = doc.y;
  doc.roundedRect(left, boxY, width, 44, 8).fillAndStroke('#eff6ff', '#93c5fd');
  doc
    .fillColor('#0b1f3a')
    .font('Bold')
    .fontSize(13)
    .text(`Сумма: ${money(amount)}`, left + 14, boxY + 14, { width: width - 28 });
  doc.y = boxY + 60;

  doc
    .font('Regular')
    .fontSize(9)
    .fillColor('#666')
    .text(
      'Стороны подтверждают, что услуги оказаны в полном объёме, претензий по количеству и качеству не имеют. Номер акта совпадает с номером счёта на оплату.',
      left,
      doc.y,
      { width },
    );

  doc.moveDown(2);
  doc.font('Regular').fontSize(10).fillColor('#333');
  doc.text('Исполнитель _________________ / _______________/', left, doc.y, { width: width / 2 - 10 });
  doc.text('Заказчик _________________ / _______________/', left + width / 2, doc.y - 12, {
    width: width / 2 - 10,
  });

  await done();
  return { filePath, fileName };
}
