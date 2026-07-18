import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Pague Menos — vermelho institucional (cor primária)
        brand: {
          50: "#fff1f3",
          100: "#ffe0e5",
          200: "#ffc2cc",
          300: "#ff94a5",
          400: "#ff5872",
          500: "#ff2342",
          600: "#ed0a2e",
          700: "#c70425",
          800: "#a30823",
          900: "#870d23",
        },
        // Pague Menos — azul institucional (cor secundária / wordmark)
        azul: {
          50: "#ededff",
          100: "#dcdcff",
          200: "#bfbfff",
          300: "#9494ff",
          400: "#5a5aff",
          500: "#2323e0",
          600: "#0000be",
          700: "#00009e",
          800: "#050585",
          900: "#0a0a6b",
        },
      },
      fontFamily: {
        sans: ["ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "Arial", "sans-serif"],
      },
    },
  },
  plugins: [],
};
export default config;
