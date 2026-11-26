import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        canvas: 'rgb(var(--canvas) / <alpha-value>)',
        surface: 'rgb(var(--surface) / <alpha-value>)',
        ink: 'rgb(var(--ink) / <alpha-value>)',
        deep: 'rgb(var(--deep) / <alpha-value>)',
        secondary: 'rgb(var(--secondary) / <alpha-value>)',
        muted: 'rgb(var(--muted) / <alpha-value>)',
        line: 'rgb(var(--line) / <alpha-value>)',
        edge: 'rgb(var(--edge) / <alpha-value>)',
        soft: 'rgb(var(--soft) / <alpha-value>)',
        accent: 'rgb(var(--accent) / <alpha-value>)',
        pressed: 'rgb(var(--pressed) / <alpha-value>)',
        selection: 'rgb(var(--selection) / <alpha-value>)',
        positive: 'rgb(var(--positive) / <alpha-value>)',
        go: 'rgb(var(--go) / <alpha-value>)',
        received: 'rgb(var(--received) / <alpha-value>)',
        warning: 'rgb(var(--warning) / <alpha-value>)',
        attention: 'rgb(var(--attention) / <alpha-value>)',
        danger: 'rgb(var(--danger) / <alpha-value>)',
        damage: 'rgb(var(--damage) / <alpha-value>)',
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'Poppins', 'sans-serif'],
        mono: ['var(--font-mono)', 'IBM Plex Mono', 'monospace'],
      },
      borderRadius: { control: '12px', card: '16px', panel: '20px' },
      boxShadow: {
        rest: '0 4px 20px rgb(8 31 68 / 0.07)',
        raised: '0 8px 28px rgb(8 31 68 / 0.12)',
        overlay: '0 12px 36px rgb(8 31 68 / 0.16)',
        dialog: '0 24px 64px rgb(8 31 68 / 0.22)',
      },
    },
  },
  plugins: [],
};
export default config;
