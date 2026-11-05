import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
    testTimeout: 60000,
    hookTimeout: 120000,
    fileParallelism: false,
    env: { NODE_ENV: 'test', SCHEDULER_ENABLED: 'false', EXPOSE_OTP: 'true' },
  },
});
