import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';
import { readFileSync } from 'node:fs';
export default defineConfig({
  plugins: [sveltekit()],
  server: {
    ...(process.env.IPAROOM_TLS_CERT && process.env.IPAROOM_TLS_KEY
      ? {
          https: {
            cert: readFileSync(process.env.IPAROOM_TLS_CERT),
            key: readFileSync(process.env.IPAROOM_TLS_KEY)
          }
        }
      : {}),
    allowedHosts: process.env.IPAROOM_HOSTNAME ? [process.env.IPAROOM_HOSTNAME] : undefined
  },
  test: { include: ['tests/**/*.test.ts'] }
});
