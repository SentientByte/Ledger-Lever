/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        parchment: "#F5F0E8",
        "parchment-dark": "#EDE5D6",
        "parchment-border": "#D8CFBF",
        ink: "#1A1611",
        "ink-2": "#3D3630",
        "ink-3": "#6B6158",
        "ink-4": "#9B9088",
        "ink-5": "#C8BFB3",
        positive: "#1A5C3A",
        "positive-bg": "#EAF3EE",
        negative: "#B81C1C",
        "negative-bg": "#FAEAEA",
        navy: "#1E2D4F",
        gold: "#8B6914",
        "card-bg": "#FDFAF5",
      },
      fontFamily: {
        serif: ['"EB Garamond"', "Georgia", "serif"],
        sans: ["Inter", "system-ui", "sans-serif"],
      },
      fontSize: {
        "2xs": ["0.65rem", { lineHeight: "1rem" }],
      },
    },
  },
  plugins: [],
};
