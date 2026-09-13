const loadConfig = () => require('@/src/config').appConfig;

describe('appConfig', () => {
  const originalEnv = { ...process.env };
  const originalDev = (globalThis as { __DEV__?: boolean }).__DEV__;

  const asReleaseBundle = () => {
    (globalThis as { __DEV__?: boolean }).__DEV__ = false;
  };

  beforeEach(() => {
    jest.resetModules();
    delete process.env.EXPO_PUBLIC_API_URL;
    delete process.env.EXPO_PUBLIC_WEB_ORIGIN;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    (globalThis as { __DEV__?: boolean }).__DEV__ = originalDev;
  });

  it('stops a release build that was never told its API host, instead of shipping one that talks to localhost', () => {
    asReleaseBundle();

    expect(loadConfig).toThrow(/EXPO_PUBLIC_API_URL/u);
  });

  it('stops it even when the profile set no EXPO_PUBLIC_APP_ENV either, which is how the mistake actually arrives', () => {
    asReleaseBundle();
    delete process.env.EXPO_PUBLIC_APP_ENV;

    expect(loadConfig).toThrow(/EXPO_PUBLIC_API_URL/u);
  });

  it('keeps the localhost fallback while developing, so a developer needs no env file', () => {
    expect(loadConfig().apiBaseUrl).toBe('http://127.0.0.1:8000');
  });

  it('accepts a release build that names both hosts, and trims their trailing slashes', () => {
    asReleaseBundle();
    process.env.EXPO_PUBLIC_API_URL = 'https://api.example.test/';
    process.env.EXPO_PUBLIC_WEB_ORIGIN = 'https://example.test/';

    const config = loadConfig();
    expect(config.apiBaseUrl).toBe('https://api.example.test');
    expect(config.webOrigin).toBe('https://example.test');
  });

  it('stops a release build pointed at an API over plain HTTP, where every sign-in would cross the network in the clear', () => {
    asReleaseBundle();
    process.env.EXPO_PUBLIC_WEB_ORIGIN = 'https://example.test';
    for (const address of ['http://aimz-alb-123.eu-west-1.elb.amazonaws.com', 'http://192.168.1.20:8000', 'ftp://api.example.test']) {
      jest.resetModules();
      process.env.EXPO_PUBLIC_API_URL = address;
      expect(loadConfig).toThrow(/HTTPS/u);
    }
  });

  it('still lets a release bundle talk to loopback, which never leaves the machine', () => {
    asReleaseBundle();
    process.env.EXPO_PUBLIC_API_URL = 'http://127.0.0.1:8000';
    process.env.EXPO_PUBLIC_WEB_ORIGIN = 'https://example.test';

    expect(loadConfig().apiBaseUrl).toBe('http://127.0.0.1:8000');
  });

  it('leaves a development build free to use a LAN address for a physical phone', () => {
    process.env.EXPO_PUBLIC_API_URL = 'http://192.168.1.20:8000';

    expect(loadConfig().apiBaseUrl).toBe('http://192.168.1.20:8000');
  });
});
