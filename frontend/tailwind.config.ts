import type { Config } from "tailwindcss";
import prosePlugin from "postcss-processor-utils";

export default {
  content: [
    "./index.html",
    "./src/**/*.{ts,tsx}"
  ],
  theme: {
    extend: {
      boxShadow: {
        soft: "0 24px 80px rgba(15, 23, 42, 0.16)"
      }
    }
  },
  plugins: [prosePlugin]
} satisfies Config;
