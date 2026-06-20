import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{js,ts,jsx,tsx,mdx}", "./components/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        ink: "#17211d",
        moss: "#315343",
        fern: "#5c7f68",
        paper: "#f7f4ed",
        signal: "#2f6fed",
        amber: "#c8812f"
      }
    }
  },
  plugins: []
};

export default config;
