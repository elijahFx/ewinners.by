import fs from 'fs';
import path from 'path';
import PDFDocument from 'pdfkit';
import { fileURLToPath } from 'url';
import { config } from '../db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const docsDir = path.join(__dirname, '../../uploads/documents');
const fontsDir = path.join(__dirname, '../../assets/fonts');
const assetsDir = path.join(__dirname, '../../assets');

const LOGO_CANDIDATES = [
  process.env.INVOICE_LOGO_PATH,
  path.join(assetsDir, 'e-winners-logo.png'),
  path.join(assetsDir, 'e-winners-logo-baseline.jpg'),
  path.join(assetsDir, 'e-winners-logo.jpeg'),
].filter(Boolean);

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

function resolvePath(candidates, minSize = 1000) {
  for (const file of candidates) {
    try {
      if (fs.existsSync(file) && fs.statSync(file).size > minSize) return file;
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

export function money(amount) {
  return `${Number(amount)
    .toFixed(2)
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} BYN`;
}

export function resolveFonts() {
  const regularFont = resolvePath(FONT_CANDIDATES, 10000);
  const boldFont = resolvePath(FONT_BOLD_CANDIDATES, 10000) || regularFont;
  if (!regularFont) {
    throw new Error('Не найден шрифт с кириллицей для PDF');
  }
  return { regularFont, boldFont };
}

export function drawLogo(doc, left = 48) {
  const logoPath = resolvePath(LOGO_CANDIDATES, 1000);
  if (!logoPath) return;
  try {
    doc.image(logoPath, left, 40, { width: 52, height: 52 });
  } catch (err) {
    console.warn('PDF logo failed:', err.message);
  }
}

export function createPdfWriter(filePath, title) {
  ensureDocsDir();
  const { regularFont, boldFont } = resolveFonts();
  const doc = new PDFDocument({
    size: 'A4',
    margin: 48,
    autoFirstPage: true,
    info: { Title: title, Author: config.company.name },
  });
  const stream = fs.createWriteStream(filePath);
  doc.pipe(stream);
  doc.registerFont('Regular', regularFont);
  doc.registerFont('Bold', boldFont);
  return {
    doc,
    done: () =>
      new Promise((resolve, reject) => {
        stream.on('finish', resolve);
        stream.on('error', reject);
        doc.end();
      }),
  };
}

export function drawHeader(doc, subtitle) {
  const left = 48;
  const width = doc.page.width - 96;
  drawLogo(doc, left);
  doc.font('Bold').fontSize(11).fillColor('#0b1f3a').text('E-Winners', left + 64, 46, { width: width - 64 });
  doc.font('Regular').fontSize(9).fillColor('#567').text(subtitle, left + 64, 64, { width: width - 64 });
  return { left, width };
}

const STAMP_CANDIDATES = [
  process.env.COMPANY_STAMP_PATH,
  path.join(assetsDir, 'stamp-signature.png'),
  path.join(__dirname, '../../../ewinners.by/public/stamp-signature.png'),
].filter(Boolean);

export function resolveStampPath() {
  return resolvePath(STAMP_CANDIDATES, 1000);
}

/**
 * Compact director block: title + stamp/signature + name on one page.
 * Scales the stamp down to fit remaining space instead of spilling to page 2.
 * Layout:  «Директор»  then stamp with FIO to the right of it.
 */
export function drawDirectorStamp(doc, { left, width, x = null, y = null } = {}) {
  const stampPath = resolveStampPath();
  const directorTitle = config.company.directorTitle || 'Директор';
  const directorName = config.company.directorName || 'Кастевич Владислав Павлович';
  const blockLeft = x != null ? x : left;
  const blockWidth = Math.max(200, Math.min(width, doc.page.width - blockLeft - 48));
  let cursorY = y != null ? y : doc.y;

  const bottom = doc.page.height - 32;
  const titleH = 12;
  let stampW = 92;
  let stampH = 80;
  const minStampH = 48;
  const gapAfterTitle = 2;
  const needed = titleH + gapAfterTitle + stampH;
  const available = bottom - cursorY;

  if (available < needed) {
    if (available >= titleH + gapAfterTitle + minStampH) {
      const scale = (available - titleH - gapAfterTitle) / stampH;
      stampH = Math.max(minStampH, Math.floor(stampH * scale));
      stampW = Math.max(56, Math.floor(stampW * scale));
    } else if (available < 40) {
      // Almost no room — only then start a new page
      doc.addPage();
      cursorY = 48;
    } else {
      stampH = Math.max(minStampH, available - titleH - gapAfterTitle - 2);
      stampW = Math.max(56, Math.round(stampH * (92 / 80)));
    }
  }

  // Absolute positioning so PDFKit text flow cannot auto-create page 2
  doc
    .font('Bold')
    .fontSize(10)
    .fillColor('#0b1f3a')
    .text(directorTitle, blockLeft, cursorY, {
      width: blockWidth,
      lineBreak: false,
      height: titleH,
    });

  const stampY = cursorY + titleH + gapAfterTitle;

  if (stampPath) {
    try {
      doc.image(stampPath, blockLeft, stampY, {
        fit: [stampW, stampH],
        align: 'left',
        valign: 'top',
      });
    } catch (err) {
      console.warn('PDF stamp failed:', err.message);
    }
  }

  const nameX = blockLeft + stampW + 8;
  const nameW = Math.max(100, blockWidth - stampW - 8);
  const nameY = stampY + Math.max(0, stampH * 0.42 - 6);
  doc
    .font('Regular')
    .fontSize(10)
    .fillColor('#111')
    .text(directorName, nameX, nameY, {
      width: nameW,
      lineBreak: false,
      height: 14,
    });

  const endY = stampY + stampH + 2;
  doc.y = endY;
  return endY;
}
