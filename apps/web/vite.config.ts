import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  // Lets a phone on the same Wi-Fi, or a secure tunnel, open the dev server.
  server: { host: true, allowedHosts: [".trycloudflare.com", ".loca.lt", ".ngrok-free.app", ".ngrok.app"] },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "logo-mark.svg"],
      manifest: {
        name: "ConnectMe",
        short_name: "ConnectMe",
        description: "Book verified professionals, pay safely, track the job.",
        theme_color: "#2350f5",
        background_color: "#ffffff",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
    }),
  ],
});
