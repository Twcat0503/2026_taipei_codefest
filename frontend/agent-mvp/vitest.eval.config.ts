import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['tests/**/*.eval.ts'], testTimeout: 60000 } });
