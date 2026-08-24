import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

const migrations = await readD1Migrations('./migrations');

export default defineConfig({
  plugins: [cloudflareTest({
    main: './src/index.ts',
    wrangler: { configPath: './wrangler.jsonc' },
    miniflare: {
      bindings: {
        ACCESS_TOKEN_SECONDS: '900',
        ADMIN_EMAIL: '',
        ADMIN_PASSWORD: '',
        INITIAL_INVITE_CODE: '',
        JWT_SECRET: 'integration-test-secret-that-is-at-least-thirty-two-characters',
        REFRESH_TOKEN_DAYS: '30',
        TEST_MIGRATIONS: JSON.stringify(migrations),
      },
    },
  })],
  test: { include: ['test/**/*.integration.test.ts'] },
});
