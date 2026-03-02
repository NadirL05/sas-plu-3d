import type { Config } from "tailwindcss"

const config: Config = {
  darkMode: ["class"],
  theme: {
    extend: {
      colors: {
        primary: "#3c3cf6",
        "background-dark": "#101022",
        "background-light": "#f5f5f8",
      },
      backdropBlur: {
        glass: "12px",
      },
    },
  },
}

export default config
