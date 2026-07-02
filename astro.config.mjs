import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://www.kyp.one',
  base: '/',
  integrations: [tailwind(), mdx(), sitemap()],
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
