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
