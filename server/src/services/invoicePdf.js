import fs from 'fs';
import path from 'path';
import PDFDocument from 'pdfkit';
import { fileURLToPath } from 'url';
import { config } from '../db.js';
import { drawDirectorStamp } from './pdfHelpers.js';

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

export async function generateInvoicePdf({ number, amount, purpose, company, createdAt, iban, bank }) {
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

  // Счёт направления: у HR, Digital и КЦ разные расчётные счета
  const issuer = {
    ...config.company,
    ...(iban ? { iban: String(iban).replace(/\s+/g, '') } : {}),
    ...(bank ? { bank } : {}),
  };

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
    doc.moveDown(0.55);

    // Issuer block
    doc.font('Bold').fontSize(11).fillColor('#0b1f3a').text('Получатель платежа');
    doc.moveDown(0.2);
    doc.font('Bold').fontSize(10).fillColor('#111').text(issuer.name || 'E-Winners', { width });
    doc.font('Regular').fontSize(10).fillColor('#333');
    if (issuer.activity) doc.text(issuer.activity, { width });
    if (issuer.unp) doc.text(`УНП: ${issuer.unp}`);
    if (issuer.address) doc.text(issuer.address, { width });
    if (issuer.bank) doc.text(`Банк: ${issuer.bank}`);
    if (issuer.iban) doc.text(`IBAN: ${issuer.iban}`);
    if (issuer.bic) doc.text(`БИК: ${issuer.bic}`);
    doc.moveDown(0.55);

    // Payer
    doc.font('Bold').fontSize(11).fillColor('#0b1f3a').text('Плательщик');
    doc.moveDown(0.2);
    doc.font('Bold').fontSize(10).fillColor('#111').text(company.name || '—', { width });
    doc.font('Regular').fontSize(10).fillColor('#333');
    if (company.entity_type === 'ip') doc.text('Форма: ИП');
    if (company.unp) doc.text(`УНП: ${company.unp}`);
    if (company.legal_address) doc.text(company.legal_address, { width });
    if (company.bank_name) doc.text(`Банк: ${company.bank_name}`);
    if (company.iban) doc.text(`IBAN: ${company.iban}`);
    if (company.bic) doc.text(`БИК: ${company.bic}`);
    doc.moveDown(0.55);

    // Purpose
    doc.font('Bold').fontSize(11).fillColor('#0b1f3a').text('Назначение платежа');
    doc.moveDown(0.2);
    doc.font('Regular').fontSize(9.5).fillColor('#333').text(purpose || '—', { width, lineGap: 1 });
    doc.moveDown(0.45);

    // Amount
    const boxY = doc.y;
    doc.roundedRect(left, boxY, width, 38, 8).fillAndStroke('#eff6ff', '#93c5fd');
    doc
      .fillColor('#0b1f3a')
      .font('Bold')
      .fontSize(12)
      .text(`Сумма к оплате: ${money(amount)}`, left + 14, boxY + 11, { width: width - 28 });

    doc.y = boxY + 46;
    doc
      .font('Regular')
      .fontSize(8)
      .fillColor('#666')
      .text(
        'Документ сформирован автоматически в личном кабинете E-Winners. Оплата производится банковским переводом по реквизитам получателя.',
        left,
        doc.y,
        { width },
      );

    doc.moveDown(0.7);
    drawDirectorStamp(doc, { left, width, y: doc.y });

    doc.end();
    stream.on('finish', resolve);
    stream.on('error', reject);
  });

  return { filePath, fileName };
}
