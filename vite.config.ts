// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  // Static files for the site root: https://checkout.restoredelivered.com/
  // Upload the contents of aws-upload to the bucket root.
  nitro: false,
  vite: {
    environments: {
      client: {
        build: {
          outDir: "aws-upload",
          emptyOutDir: true,
        },
      },
    },
  },
  tanstackStart: {
    server: { entry: "server" },
    router: {
      basepath: "/",
    },
    prerender: {
      enabled: true,
      crawlLinks: false,
      autoStaticPathsDiscovery: false,
    },
    pages: [
      { path: "/", prerender: { enabled: true } },
      { path: "/checkout", prerender: { enabled: true } },
    ],
  },
});
