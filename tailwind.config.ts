import type { Config } from "tailwindcss";

/**
 * As cores vêm dos tokens do design system Pague Menos (variáveis CSS em
 * app/globals.css). Os utilitários do Tailwind só apontam para elas, assim
 * `bg-primaria` ou `text-ink-2` seguem o tema claro/escuro sozinhos.
 */
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  darkMode: ["selector", '[data-theme="escuro"]'],
  theme: {
    extend: {
      colors: {
        azul: "var(--azul)",
        primaria: { DEFAULT: "var(--primaria)", hover: "var(--primaria-hover)" },
        "texto-marca": "var(--texto-marca)",
        "sobre-azul": "var(--sobre-azul)",
        coral: { DEFAULT: "var(--coral)", texto: "var(--coral-texto)", tint: "var(--coral-tint)" },
        ambar: { DEFAULT: "var(--ambar)", texto: "var(--ambar-texto)", tint: "var(--ambar-tint)" },
        verde: { DEFAULT: "var(--verde)", tint: "var(--verde-tint)" },
        ink: { DEFAULT: "var(--ink)", 2: "var(--ink-2)", 3: "var(--ink-3)" },
        papel: { DEFAULT: "var(--papel)", 2: "var(--papel-2)" },
        fundo: "var(--fundo)",
        linha: { DEFAULT: "var(--linha)", hover: "var(--linha-hover)" },
      },
      borderRadius: { pgm: "var(--raio)", slide: "var(--raio-slide)" },
      boxShadow: { 1: "var(--sombra-1)", 2: "var(--sombra-2)" },
      fontFamily: {
        sans: ['"Montserrat"', '"Segoe UI"', "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
export default config;
