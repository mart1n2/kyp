/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,mdx,js,ts}'],
  plugins: [
    require('@tailwindcss/typography'),
  ],
  theme: {
    extend: {
      colors: {
        risk: {
          critical: '#dc2626',
          high: '#ea580c',
          medium: '#ca8a04',
          low: '#16a34a',
        },
        admin: {
          eoa: '#dc2626',
          multisig: '#16a34a',
          governance: '#2563eb',
        },
      },
    },
  },
};
