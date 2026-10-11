/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// E2E_FIXTURE=1 serves the synthetic (non-book) test content instead of the private real content.
const fixture = process.env.E2E_FIXTURE === '1';

export default defineConfig({
  plugins: [react()],
  base: './',
  publicDir: fixture ? 'tests/fixtures/public' : 'public',
  build: { outDir: fixture ? 'dist-fixture' : 'dist', sourcemap: false, target: 'es2022' },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
    testTimeout: 20000
  }
});
