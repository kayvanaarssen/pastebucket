import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

// Kept apart from vite.config.ts so the Laravel plugin (which wants a running
// PHP app and a manifest) never loads during unit tests.
export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: {
            '@': path.resolve(import.meta.dirname, 'resources/js'),
        },
    },
    test: {
        include: ['resources/js/**/*.test.{ts,tsx}', 'mcp/test/**/*.test.ts'],
        environment: 'node',
        testTimeout: 30_000,
    },
});
