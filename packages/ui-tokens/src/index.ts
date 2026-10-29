/** Brand tokens shared by web (Tailwind) and mobile (React Native). */
export const colors = {
  white: "#FFFFFF",       // primary / background
  brand: "#2350F5",       // secondary: buttons, links, logo
  lime: "#C8F05A",        // tertiary: highlights, logo pill. Never as text on white.
  ink: "#0B1020",         // body text, and text on lime
  muted: "#5B6275",
  surface: "#F4F6FB",
  line: "#E3E7F0",
  danger: "#D92D20",
  success: "#12805C",
} as const;

export const fonts = {
  sans: ["Poppins", "ui-sans-serif", "system-ui", "sans-serif"],
} as const;

export const radii = { card: 16, button: 999 } as const;

/** Tailwind preset (used by apps/web). */
export const connectmePreset = {
  theme: {
    extend: {
      colors: {
        brand: { DEFAULT: colors.brand, 50: "#EEF2FF", 600: "#1B3FD0" },
        lime: { DEFAULT: colors.lime },
        ink: colors.ink,
        muted: colors.muted,
        surface: colors.surface,
        line: colors.line,
        danger: colors.danger,
        success: colors.success,
      },
      fontFamily: { sans: [...fonts.sans] },
      borderRadius: { card: "16px" },
    },
  },
};
