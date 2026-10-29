import type { Config } from "tailwindcss";
import { connectmePreset } from "@connectme/ui-tokens";

export default {
  presets: [connectmePreset as Partial<Config>],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
} satisfies Config;
