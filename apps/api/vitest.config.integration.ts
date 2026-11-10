import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    setupFiles: ['./test/setup.ts'],
    globals: true,
    include: ['test/**/*.integration-spec.ts'],
    hookTimeout: 15000,
    testTimeout: 15000,
  },
});
