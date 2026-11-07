import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  use: {
    ...devices['Pixel 7'],
    reducedMotion: 'reduce',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'demo',
      testMatch: ['**/app.e2e.ts', '**/native-voice.e2e.ts'],
      use: { baseURL: 'http://127.0.0.1:5174' },
    },
    {
      name: 'townpass',
      testMatch: '**/townpass.e2e.ts',
      use: { baseURL: 'http://127.0.0.1:5175' },
    },
  ],
  webServer: [
    {
      command: 'pnpm dev --port 5174 --strictPort',
      url: 'http://127.0.0.1:5174',
      reuseExistingServer: false,
      env: { VITE_TOOL_SOURCE: 'demo', VITE_MODEL_ENDPOINT: '' },
    },
    {
      command: 'pnpm dev --port 5175 --strictPort',
      url: 'http://127.0.0.1:5175',
      reuseExistingServer: false,
      env: { VITE_TOOL_SOURCE: 'townpass', VITE_MODEL_ENDPOINT: '' },
    },
  ],
});
