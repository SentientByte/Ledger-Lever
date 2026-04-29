/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: "#0f172a",
          card: "#1e293b",
          border: "#334155",
        },
      },
    },
  },
  plugins: [],
};
