import { defineConfig } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:4178', trace: 'retain-on-failure' },
  webServer: {
    command: 'node build',
    url: 'http://127.0.0.1:4178',
    reuseExistingServer: false,
    env: {
      HOST: '127.0.0.1',
      PORT: '4178',
      ORIGIN: 'http://127.0.0.1:4178',
      IPAROOM_BASE_URL: 'https://192.168.1.10:8443',
      IPAROOM_ADMIN_TOKEN: 'integration-test-token-32-characters',
      IPAROOM_DATA_DIR: mkdtempSync(join(tmpdir(), 'iparoom-e2e-')),
      IPAROOM_MAX_UPLOAD_BYTES: '1048576',
      BODY_SIZE_LIMIT: '2M'
    }
  }
});
