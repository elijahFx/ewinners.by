import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const SITE_URL = 'https://ewinners.by'

// Публичные страницы сайта. Кабинет и страницы аккаунта сюда не попадают:
// они закрыты в robots.txt и в поиске им делать нечего.
// Добавили новую страницу — допишите строку, sitemap соберётся сам.
const SITEMAP_PAGES = [
  { path: '/', priority: '1.0', changefreq: 'weekly' },
  { path: '/call-center', priority: '0.9', changefreq: 'monthly' },
  { path: '/hr', priority: '0.8', changefreq: 'monthly' },
  { path: '/target', priority: '0.8', changefreq: 'monthly' },
]

/**
 * Кладёт sitemap.xml в сборку, подставляя сегодняшнюю дату в lastmod.
 * Благодаря этому дату не нужно править руками — она всегда свежая.
 */
function sitemapPlugin() {
  return {
    name: 'ewinners-sitemap',
    apply: 'build',
    generateBundle() {
      // sv-SE даёт формат ГГГГ-ММ-ДД, который ждёт sitemap.
      // Часовую зону фиксируем по Минску: иначе дата зависела бы
      // от того, на какой машине запустили сборку.
      const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Minsk' })
      const urls = SITEMAP_PAGES.map((page) =>
        [
          '  <url>',
          `    <loc>${SITE_URL}${page.path}</loc>`,
          `    <lastmod>${today}</lastmod>`,
          `    <changefreq>${page.changefreq}</changefreq>`,
          `    <priority>${page.priority}</priority>`,
          '  </url>',
        ].join('\n'),
      ).join('\n')

      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`
      this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: xml })
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), sitemapPlugin()],
  server: {
    proxy: {
      '/api': {
        target: 'https://178.172.137.114.sslip.io',
        changeOrigin: true,
        secure: true,
      },
      '/socket.io': {
        target: 'https://178.172.137.114.sslip.io',
        changeOrigin: true,
        secure: true,
        ws: true,
      },
      '/uploads': {
        target: 'https://178.172.137.114.sslip.io',
        changeOrigin: true,
        secure: true,
      },
    },
  },
})
