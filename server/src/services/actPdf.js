import path from 'path';
import { config } from '../db.js';
import { createPdfWriter, docsDir, drawDirectorStamp, drawHeader, money } from './pdfHelpers.js';

const MONTH_NAMES = [
  'январь',
  'февраль',
  'март',
  'апрель',
  'май',
  'июнь',
  'июль',
  'август',
  'сентябрь',
  'октябрь',
  'ноябрь',
  'декабрь',
];

/** «Октябрь 2026» — для заголовка акта. */
export function actMonthTitle(periodStart) {
  const d = new Date(periodStart);
  if (Number.isNaN(d.getTime())) return '';
  const month = MONTH_NAMES[d.getMonth()] || '';
  return `${month.charAt(0).toUpperCase()}${month.slice(1)} ${d.getFullYear()}`;
}

/**
 * Основание акта.
 *
 * Для КЦ это ровно та формулировка, которая нужна клиентам: акт составлен
 * в связи с оказанием услуг по обработке заявок. Для остальных направлений
 * используем нейтральное «оказание услуг».
 */
export function actReason(direction) {
  return String(direction || '').toLowerCase() === 'kc'
    ? 'Акт составлен в связи с оказанием услуг по обработке заявок.'
    : 'Акт составлен в связи с оказанием услуг.';
}

function drawPartyBlock(doc, { left, width, title, name, unp, address }) {
  doc.font('Bold').fontSize(10).fillColor('#0b1f3a').text(title, left, doc.y, { width });
  doc.moveDown(0.15);
  doc.font('Bold').fontSize(9.5).fillColor('#111').text(name || '—', left, doc.y, { width });
  doc.font('Regular').fontSize(9).fillColor('#333');
  if (unp) doc.text(`УНП: ${unp}`, { width });
  if (address) doc.text(address, { width });
}

function drawTableHeader(doc, y, layout) {
  doc.font('Bold').fontSize(8).fillColor('#0b1f3a');
  doc.text('№', layout.noX, y, { width: layout.noW });
  doc.text('Наименование услуги / основание', layout.nameX, y, { width: layout.nameW });
  doc.text('Кол-во', layout.qtyX, y, { width: layout.qtyW, align: 'center' });
  doc.text('Ед.', layout.unitX, y, { width: layout.unitW, align: 'center' });
  doc.text('Сумма', layout.sumX, y, { width: layout.sumW, align: 'right' });
  const lineY = y + 13;
  doc.moveTo(layout.left, lineY).lineTo(layout.left + layout.width, lineY)
    .strokeColor('#93c5fd')
    .stroke();
  return lineY + 5;
}

function formatQuantity(value) {
  if (value == null || value === '') return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('ru-RU', { maximumFractionDigits: 3 });
}

export async function generateActPdf({
  number,
  company,
  items = [],
  periodStart,
  periodEnd,
  periodLabel,
  total,
  createdAt,
  direction = 'kc',
  operationsCount = 0,
  outputPath = null,
}) {
  const fileName = `act-${String(number).replace(/[^\w.-]+/g, '_')}.pdf`;
  const filePath = outputPath || path.join(docsDir, fileName);
  const issuer = config.company;
  const isKc = String(direction || '').toLowerCase() === 'kc';

  const { doc, done } = createPdfWriter(filePath, `Акт оказанных услуг ${number}`);
  const { left, width } = drawHeader(
    doc,
    isKc ? 'Акт оказанных услуг по обработке заявок' : 'Акт оказанных услуг',
  );

  doc
    .font('Bold')
    .fontSize(18)
    .fillColor('#0b1f3a')
    .text('АКТ ОКАЗАННЫХ УСЛУГ', left, 110, { width });
  doc.moveDown(0.35);
  doc.font('Regular').fontSize(10.5).fillColor('#333');
  doc.text(`Номер: ${number}`);
  doc.text(`Дата составления: ${createdAt}`);
  if (periodLabel) doc.text(`Период оказания услуг: ${periodLabel}`);
  doc.moveDown(0.55);

  // Основание — отдельной выделенной строкой, чтобы формулировка не терялась.
  doc
    .font('Bold')
    .fontSize(10)
    .fillColor('#0b1f3a')
    .text(actReason(direction), left, doc.y, { width });
  doc.moveDown(0.65);

  drawPartyBlock(doc, {
    left,
    width,
    title: 'Исполнитель',
    name: issuer.name || 'E-Winners',
    unp: issuer.unp,
    address: issuer.address,
  });
  doc.moveDown(0.55);
  drawPartyBlock(doc, {
    left,
    width,
    title: 'Заказчик',
    name: company?.name,
    unp: company?.unp,
    address: company?.legal_address,
  });
  doc.moveDown(0.65);

  doc
    .font('Regular')
    .fontSize(9.5)
    .fillColor('#333')
    .text(
      'Исполнитель оказал, а Заказчик принял следующие услуги за указанный период:',
      left,
      doc.y,
      { width },
    );
  doc.moveDown(0.45);

  const layout = {
    left,
    width,
    noX: left,
    noW: 22,
    nameX: left + 26,
    nameW: 250,
    qtyX: left + 286,
    qtyW: 45,
    unitX: left + 336,
    unitW: 40,
    sumX: left + width - 92,
    sumW: 92,
  };

  const pageBottom = doc.page.height - 96;
  const serviceItems = items.filter((item) => item.isService !== false);
  const otherItems = items.filter((item) => item.isService === false);
  let y = doc.y;

  const drawRows = (rows) => {
    let rowIndex = 0;
    for (const item of rows) {
      const name = String(item.name || 'Услуга');
      doc.font('Regular').fontSize(8.5);
      const nameHeight = doc.heightOfString(name, { width: layout.nameW });
      const rowHeight = Math.max(17, nameHeight + 7);

      if (y + rowHeight > pageBottom) {
        doc.addPage();
        y = drawTableHeader(doc, 48, layout);
      }

      rowIndex += 1;
      doc.font('Regular').fontSize(8.5).fillColor('#333');
      doc.text(String(rowIndex), layout.noX, y + 4, { width: layout.noW });
      doc.text(name, layout.nameX, y + 4, { width: layout.nameW });
      doc.text(formatQuantity(item.quantity), layout.qtyX, y + 4, {
        width: layout.qtyW,
        align: 'center',
      });
      doc.text(item.unit || '—', layout.unitX, y + 4, {
        width: layout.unitW,
        align: 'center',
      });
      doc.text(money(item.amount), layout.sumX, y + 4, {
        width: layout.sumW,
        align: 'right',
      });

      y += rowHeight;
      doc
        .moveTo(layout.left, y)
        .lineTo(layout.left + layout.width, y)
        .strokeColor('#e2e8f0')
        .stroke();
    }
    return y;
  };

  doc.font('Bold').fontSize(9.5).fillColor('#0b1f3a').text('Оказанные услуги', left, y, {
    width,
  });
  y = drawTableHeader(doc, doc.y + 4, layout);
  if (serviceItems.length) {
    y = drawRows(serviceItems);
  } else {
    doc
      .font('Regular')
      .fontSize(9)
      .fillColor('#666')
      .text('За указанный период оказанных услуг нет.', left, y + 6, { width });
    y += 24;
  }

  if (otherItems.length) {
    if (y + 70 > pageBottom) {
      doc.addPage();
      y = 48;
    } else {
      y += 16;
    }
    doc.font('Bold').fontSize(9.5).fillColor('#0b1f3a').text('Прочие списания с баланса', left, y, {
      width,
    });
    y = drawTableHeader(doc, doc.y + 4, layout);
    y = drawRows(otherItems);
  }

  const serviceTotal = Number(
    serviceItems.reduce((sum, item) => sum + Number(item.amount || 0), 0).toFixed(2),
  );
  const totalAmount =
    total != null
      ? Number(total)
      : Number(items.reduce((sum, item) => sum + Number(item.amount || 0), 0).toFixed(2));
  const otherTotal = Number((totalAmount - serviceTotal).toFixed(2));
  const showSplit = otherItems.length > 0 && Math.abs(otherTotal) > 0.004;

  // Итоговая сумма — в рамке, как и в счёте.
  const boxHeight = showSplit ? 58 : 42;
  if (y + boxHeight + 12 > pageBottom) {
    doc.addPage();
    y = 48;
  }
  y += 10;
  doc.roundedRect(left, y, width, boxHeight, 8).fillAndStroke('#eff6ff', '#93c5fd');
  doc
    .fillColor('#0b1f3a')
    .font('Bold')
    .fontSize(11.5)
    .text(`Итого оказано услуг: ${money(serviceTotal)}`, left + 14, y + 12, {
      width: width - 28,
    });
  if (showSplit) {
    doc
      .font('Regular')
      .fontSize(10)
      .fillColor('#1f3a5f')
      .text(`Итого списано с баланса: ${money(totalAmount)}`, left + 14, y + 33, {
        width: width - 28,
      });
  }
  y += boxHeight + 12;

  if (operationsCount > 0) {
    doc
      .font('Regular')
      .fontSize(8)
      .fillColor('#6b7280')
      .text(`Операций по списанию с баланса: ${operationsCount}.`, left, y, { width });
    y += 12;
  }

  doc
    .font('Regular')
    .fontSize(8.5)
    .fillColor('#555')
    .text(
      'Сумма акта соответствует стоимости оказанных услуг за указанный период. ' +
        'Пополнения баланса и ручные корректировки в акт не включаются.',
      left,
      y,
      { width, lineGap: 1 },
    );
  doc.moveDown(0.45);
  doc.text(
    'Услуги оказаны в полном объёме, претензий по объёму и качеству оказанных услуг Заказчик не имеет.',
    left,
    doc.y,
    { width },
  );

  doc.moveDown(0.9);
  const signaturesY = doc.y;
  doc.font('Bold').fontSize(9.5).fillColor('#0b1f3a').text('Исполнитель', left, signaturesY, {
    width,
    lineBreak: false,
  });
  drawDirectorStamp(doc, { left, width, x: left, y: signaturesY + 14 });

  await done();
  return { filePath, fileName, total: totalAmount };
}
