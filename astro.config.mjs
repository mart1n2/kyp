import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://www.kyp.one',
  base: '/',
  // The database index moved from /protocols up to /. Astro emits a
  // meta-refresh page for static output, which is all GitHub Pages can serve.
  // Individual /protocols/<slug> pages are unaffected.
  redirects: { '/protocols': '/' },
  integrations: [
    tailwind(),
    mdx(),
    sitemap({
      // /notes/* are noindex redirect stubs pointing at mart1n.xyz. Listing them
      // in the sitemap would ask crawlers to index pages that tell them not to.
      filter: page => !new URL(page).pathname.startsWith('/notes/'),
    }),
  ],
  markdown: {
    shikiConfig: {
      // Both palettes are emitted as CSS variables; global.css activates
      // one per [data-theme] so code blocks follow the site theme.
      themes: { light: 'github-light', dark: 'github-dark' },
      defaultColor: false,
    },
  },
  vite: {
    build: {
      rollupOptions: {
        external: ['/pagefind/pagefind.js'],
      },
    },
  },
});
