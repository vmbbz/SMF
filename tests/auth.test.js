import { describe, it, expect } from '@jest/globals';
import { parseRoute } from '../src/router.js';

// ─── Router: auth-callback route ──────────────────

describe('parseRoute — auth callback', () => {
  it('detects /auth/callback as auth-callback type', () => {
    const route = parseRoute('/auth/callback');
    expect(route.type).toBe('auth-callback');
  });

  it('still detects /room/:code routes', () => {
    const route = parseRoute('/room/red-tiger-paw');
    expect(route.type).toBe('room');
    expect(route.code).toBe('red-tiger-paw');
  });

  it('returns home for /', () => {
    const route = parseRoute('/');
    expect(route.type).toBe('home');
  });

  it('returns home for /auth (no /callback)', () => {
    const route = parseRoute('/auth');
    expect(route.type).toBe('home');
  });

  it('returns home for /auth/callback/extra', () => {
    const route = parseRoute('/auth/callback/extra');
    expect(route.type).toBe('home');
  });
});

// ─── Router: multiplayer route ──────────────────

describe('parseRoute — multiplayer', () => {
  it('detects /multiplayer as multiplayer type', () => {
    const route = parseRoute('/multiplayer');
    expect(route.type).toBe('multiplayer');
  });

  it('returns home for /multiplayer/extra', () => {
    const route = parseRoute('/multiplayer/extra');
    expect(route.type).toBe('home');
  });
});

// ─── Server-managed auth session ──────────────────────────────

describe('server-managed auth session', () => {
  afterEach(() => {
    delete globalThis.fetch;
    delete globalThis.window;
  });

  it('restores an authenticated session from the server cookie endpoint', async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({ authenticated: true, user: { id: 'u1', name: 'Fighter' } }),
    });
    const { checkAuth, isLoggedIn, getUser } = await import('../src/auth.js');

    expect(await checkAuth()).toBe(true);
    expect(isLoggedIn()).toBe(true);
    expect(getUser().name).toBe('Fighter');
  });

  it('clears authenticated state when the session endpoint rejects', async () => {
    globalThis.fetch = async () => ({ ok: false });
    const { checkAuth, isLoggedIn, getUser } = await import('../src/auth.js');

    expect(await checkAuth()).toBe(false);
    expect(isLoggedIn()).toBe(false);
    expect(getUser()).toBeNull();
  });

  it('starts login through the server endpoint with a bounded return path', async () => {
    globalThis.window = { location: { href: '' } };
    const { login } = await import('../src/auth.js');

    login('/multiplayer');
    expect(globalThis.window.location.href).toBe('/api/auth/login?return_path=%2Fmultiplayer');
  });

  it('reports auth as unconfigured when the config request fails', async () => {
    globalThis.fetch = async () => { throw new Error('offline'); };
    const { getAuthConfig, isAuthConfigured } = await import('../src/auth.js');

    expect(await getAuthConfig()).toEqual({ configured: false });
    expect(await isAuthConfigured()).toBe(false);
  });

  it('keeps the legacy browser callback as a safe no-op', async () => {
    const { handleCallback } = await import('../src/auth.js');
    expect(await handleCallback()).toBeNull();
  });
});
