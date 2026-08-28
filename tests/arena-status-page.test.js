import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { API_ROUTES } from '../src/api-endpoints.js';
import { formatArenaCount, formatArenaTime } from '../src/arena-status-page.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(__dirname, '../index.html'), 'utf-8');
const dockerfile = readFileSync(resolve(__dirname, '../Dockerfile'), 'utf-8');

describe('Public Arena Status evidence page', () => {
  test('is linked from Help and has a direct public shell', () => {
    expect(html).toContain('id="btn-help-arena-status"');
    expect(html).toContain('LIVE ARENA STATUS →');
    expect(html).toContain('id="arena-status-page"');
    expect(html).toContain('ARENA STATUS');
    expect(html).toContain('ALCHEMY YELLOWSTONE STREAM');
    expect(html).toContain('id="arena-stream-status"');
  });

  test('separates responses, server rounds, shares, wallets, and onchain evidence', () => {
    expect(html).toContain('API decisions returned; not fights or unique people.');
    expect(html).toContain('Only multiplayer rounds finalized by the server game loop.');
    expect(html).toContain('Generated cards, not confirmed social impressions.');
    expect(html).toContain('Wallet sessions are not paying users.');
    expect(html).toContain('Gameplay events are never labeled onchain volume.');
    expect(html).toContain('These observations are not labeled trades, USD volume, revenue, or unique users');
  });

  test('states the privacy and reward boundaries', () => {
    expect(html).toContain('Wallet addresses, player names, room codes, session tokens, and authentication challenges never appear here.');
    expect(html).toContain('These counters do not create leaderboard points or reward eligibility.');
    expect(html).toContain('Unavailable durable evidence is shown as not available, not zero.');
  });

  test('uses the centralized native-safe API route', () => {
    expect(API_ROUTES.ARENA_STATUS).toBe('/api/arena/status');
  });

  test('ships all telemetry dependencies in the production container', () => {
    expect(dockerfile).toContain('COPY arena_telemetry.py .');
    expect(dockerfile).toContain('COPY alchemy_stream.py .');
    expect(dockerfile).toContain('COPY yellowstone_proto/ yellowstone_proto/');
    expect(dockerfile).toContain('COPY competition.py .');
    expect(dockerfile).toContain('COPY economy.py .');
  });

  test('formats absent counters as unavailable instead of zero', () => {
    expect(formatArenaCount(null)).toBe('NOT AVAILABLE');
    expect(formatArenaCount(undefined)).toBe('NOT AVAILABLE');
    expect(formatArenaCount(0)).toBe('0');
    expect(formatArenaCount(1234)).toBe('1,234');
  });

  test('does not invent invalid timestamps', () => {
    expect(formatArenaTime(null)).toBe('NOT RECORDED');
    expect(formatArenaTime('not-a-date')).toBe('NOT RECORDED');
  });
});
