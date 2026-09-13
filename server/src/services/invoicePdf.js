import fs from 'fs';
import path from 'path';
import PDFDocument from 'pdfkit';
import { fileURLToPath } from 'url';
import { config } from '../db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const docsDir = path.join(__dirname, '../../uploads/documents');
const fontsDir = path.join(__dirname, '../../assets/fonts');
const assetsDir = path.join(__dirname, '../../assets');
const LOGO_CANDIDATES = [
  process.env.INVOICE_LOGO_PATH,
  path.join(assetsDir, 'e-winners-logo.png'),
  path.join(assetsDir, 'e-winners-logo-baseline.jpg'),
  path.join(assetsDir, 'e-winners-logo.jpeg'),
  path.join(__dirname, '../../../ewinners.by/public/e-winners-logo.jpeg'),
].filter(Boolean);

function resolveLogo() {
  for (const file of LOGO_CANDIDATES) {
    try {
      if (fs.existsSync(file) && fs.statSync(file).size > 1000) return file;
    } catch {
      // continue
    }
  }
  return null;
}

const FONT_CANDIDATES = [
  path.join(fontsDir, 'DejaVuSans.ttf'),
  path.join(fontsDir, 'ArialUnicode.ttf'),
  '/System/Library/Fonts/Supplemental/Arial Unicode.ttf',
  '/Library/Fonts/Arial Unicode.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  '/usr/share/fonts/truetype/freefont/FreeSans.ttf',
  '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
];

const FONT_BOLD_CANDIDATES = [
  path.join(fontsDir, 'DejaVuSans-Bold.ttf'),
  path.join(fontsDir, 'ArialUnicode.ttf'),
  '/System/Library/Fonts/Supplemental/Arial Unicode.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
  '/usr/share/fonts/truetype/freefont/FreeSansBold.ttf',
  '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
];

function resolveFont(candidates) {
  for (const file of candidates) {
    try {
      if (fs.existsSync(file) && fs.statSync(file).size > 10000) return file;
    } catch {
      // continue
    }
  }
  return null;
}

export function ensureDocsDir() {
  if (!fs.existsSync(docsDir)) fs.mkdirSync(docsDir, { recursive: true });
  return docsDir;
}

function money(amount) {
  return `${Number(amount)
    .toFixed(2)
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} BYN`;
}

export async function generateInvoicePdf({ number, amount, purpose, company, createdAt }) {
  ensureDocsDir();
  if (!company?.name) {
    throw new Error('Не указаны реквизиты плательщика для PDF');
  }
  const fileName = `invoice-${number.replace(/[^\w.-]+/g, '_')}.pdf`;
  const filePath = path.join(docsDir, fileName);

  const regularFont = resolveFont(FONT_CANDIDATES);
  const boldFont = resolveFont(FONT_BOLD_CANDIDATES) || regularFont;

  if (!regularFont) {
    throw new Error(
      'Не найден шрифт с кириллицей для PDF. Положите DejaVuSans.ttf в server/assets/fonts/',
    );
  }

  const issuer = config.company;
  const accountantPhone = config.company.accountantPhone || '+375 (25) 505-69-17';

  await new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 48,
      autoFirstPage: true,
      info: {
        Title: `Счёт ${number}`,
        Author: issuer.name,
      },
    });
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    doc.registerFont('Regular', regularFont);
    doc.registerFont('Bold', boldFont);

    const left = 48;
    const pageWidth = doc.page.width;
    const width = pageWidth - 96;

    // Header with logo (prefer PNG / baseline JPEG — progressive JPEG often fails in PDFKit)
    const logoPath = resolveLogo();
    if (logoPath) {
      try {
        doc.image(logoPath, left, 40, { width: 52, height: 52 });
      } catch (err) {
        console.warn('Invoice PDF logo failed:', logoPath, err.message);
      }
    } else {
      console.warn('Invoice PDF logo not found in', LOGO_CANDIDATES);
    }

    doc
      .font('Bold')
      .fontSize(11)
      .fillColor('#0b1f3a')
      .text('E-Winners', left + 64, 46, { width: width - 64 });
    doc
      .font('Regular')
      .fontSize(9)
      .fillColor('#567')
      .text('Личный кабинет · счёт на оплату', left + 64, 64, { width: width - 64 });

    doc
      .font('Bold')
      .fontSize(20)
      .fillColor('#0b1f3a')
      .text('СЧЁТ НА ОПЛАТУ', left, 110, { width });

    doc.moveDown(0.35);
    doc.font('Regular').fontSize(11).fillColor('#333');
    doc.text(`Номер: ${number}`);
    doc.text(`Дата: ${createdAt}`);
    doc.moveDown(0.8);

    // Issuer block
    doc.font('Bold').fontSize(12).fillColor('#0b1f3a').text('Получатель платежа');
    doc.moveDown(0.25);
    doc.font('Bold').fontSize(10).fillColor('#111').text(issuer.name || 'E-Winners', { width });
    doc.font('Regular').fontSize(10).fillColor('#333');
    if (issuer.activity) doc.text(issuer.activity, { width });
    if (issuer.unp) doc.text(`УНП: ${issuer.unp}`);
    if (issuer.address) doc.text(issuer.address, { width });
    if (issuer.bank) doc.text(`Банк: ${issuer.bank}`);
    else doc.text('Банк: — (уточните у менеджера E-Winners)');
    if (issuer.iban) doc.text(`IBAN: ${issuer.iban}`);
    else doc.text('IBAN: — (уточните у менеджера E-Winners)');
    if (issuer.bic) doc.text(`БИК: ${issuer.bic}`);
    else doc.text('БИК: —');
    doc.moveDown(0.8);

    // Payer
    doc.font('Bold').fontSize(12).fillColor('#0b1f3a').text('Плательщик');
    doc.moveDown(0.25);
    doc.font('Bold').fontSize(10).fillColor('#111').text(company.name || '—', { width });
    doc.font('Regular').fontSize(10).fillColor('#333');
    if (company.entity_type === 'ip') doc.text('Форма: ИП');
    if (company.unp) doc.text(`УНП: ${company.unp}`);
    if (company.legal_address) doc.text(company.legal_address, { width });
    if (company.bank_name) doc.text(`Банк: ${company.bank_name}`);
    if (company.iban) doc.text(`IBAN: ${company.iban}`);
    if (company.bic) doc.text(`БИК: ${company.bic}`);
    doc.moveDown(0.8);

    // Purpose
    doc.font('Bold').fontSize(12).fillColor('#0b1f3a').text('Назначение платежа');
    doc.moveDown(0.25);
    doc.font('Regular').fontSize(10).fillColor('#333').text(purpose || '—', { width });
    doc.moveDown(0.6);

    // Important note — высота по тексту
    const noteY = doc.y;
    const noteText =
      `Важно: в назначении платежа обязательно укажите номер счёта ${number}. ` +
      `Без номера счёта зачисление денежных средств не будет выполнено автоматически — ` +
      `потребуется связаться с бухгалтером по телефону ${accountantPhone}.`;
    doc.font('Bold').fontSize(9);
    const noteHeight = Math.max(
      68,
      doc.heightOfString(noteText, { width: width - 24, lineGap: 2 }) + 20,
    );
    doc.roundedRect(left, noteY, width, noteHeight, 8).fillAndStroke('#fff7ed', '#fdba74');
    doc
      .fillColor('#9a3412')
      .font('Bold')
      .fontSize(9)
      .text(noteText, left + 12, noteY + 10, { width: width - 24, lineGap: 2 });
    doc.y = noteY + noteHeight + 12;

    // Amount
    const boxY = doc.y;
    doc.roundedRect(left, boxY, width, 44, 8).fillAndStroke('#eff6ff', '#93c5fd');
    doc
      .fillColor('#0b1f3a')
      .font('Bold')
      .fontSize(13)
      .text(`Сумма к оплате: ${money(amount)}`, left + 14, boxY + 14, { width: width - 28 });

    doc.y = boxY + 60;
    doc
      .font('Regular')
      .fontSize(9)
      .fillColor('#666')
      .text(
        'Документ сформирован автоматически в личном кабинете E-Winners. Оплата производится банковским переводом по реквизитам получателя.',
        left,
        doc.y,
        { width },
      );

    doc.end();
    stream.on('finish', resolve);
    stream.on('error', reject);
  });

  return { filePath, fileName };
}
