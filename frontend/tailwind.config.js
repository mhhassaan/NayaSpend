/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        "dark-blackberry": "#1e141e",
        blackberry: "#381d2a",
        "hyper-white": "#fcf9fb",
        "silver-frost": "#f0eaed",
        "deep-grey": "#8c8085",
        "mid-grey": "#d9d2d5",
        "lightest-grey": "#ddcbd1",
        "electric-orange": "#ff5018",
        "hot-red": "#c71e06",
        "deep-violet": "#9048c4",
        "vivid-violet": "#c4b8ff",
        "light-purple": "#ece8fd",
        bubblegum: "#ffc6d4",
        // Semantic aliases referencing the CSS custom properties in
        // styles/tokens.css -- components should prefer these over raw
        // palette names, so a future re-theme only touches tokens.css.
        "bg-page": "var(--color-bg-page)",
        "bg-surface": "var(--color-bg-surface)",
        "bg-inverse": "var(--color-bg-inverse)",
        "text-primary": "var(--color-text-primary)",
        "text-secondary": "var(--color-text-secondary)",
        "text-inverse": "var(--color-text-inverse)",
        border: "var(--color-border)",
        accent: "var(--color-accent)",
        success: "var(--color-success)",
        warning: "var(--color-warning)",
        danger: "var(--color-danger)",
      },
      fontFamily: {
        display: ["Poppins", "Verdana", "sans-serif"],
        body: ["DM Sans", "sans-serif"],
      },
      borderRadius: {
        sm: "8px",
        md: "10px",
        lg: "16px",
        xl: "24px",
      },
    },
  },
  plugins: [],
};
