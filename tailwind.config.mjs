/** @type {import('tailwindcss').Config} */

// Semantic theme tokens — the RGB triplets live in src/styles/global.css per
// [data-theme]. Components use these names; themes decide the actual color.
const token = (name) => `rgb(var(--c-${name}) / <alpha-value>)`;

export default {
  content: ['./src/**/*.{astro,mdx,js,ts}'],
  theme: {
    extend: {
      colors: {
        page: token('page'),
        surface: token('surface'),
        elevated: token('elevated'),
        inset: token('inset'),
        ink: {
          DEFAULT: token('ink'),
          2: token('ink-2'),
          3: token('ink-3'),
          4: token('ink-4'),
        },
        // Hairline borders carry their alpha in the variable itself.
        line: {
          DEFAULT: 'var(--c-line)',
          2: 'var(--c-line-2)',
        },
        accent: {
          DEFAULT: token('accent'),
          2: token('accent-2'),
        },
        danger: token('danger'),
        hot: token('hot'),
        warn: token('warn'),
        ok: token('ok'),
        info: token('info'),
        viol: token('viol'),
      },
    },
  },
  plugins: [
    require('@tailwindcss/typography'),
  ],
};
