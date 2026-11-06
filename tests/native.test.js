import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isNativeApp, shareBase, PUBLIC_APP_URL } from '../src/services/native.js';

const browser = { location: { origin: 'https://johnyang0323.github.io', pathname: '/named_nothing/' } };
const app = { location: { origin: 'https://localhost', pathname: '/' }, Capacitor: { isNativePlatform: () => true } };

test('detects the Android/iOS app', () => {
  assert.equal(isNativeApp(browser), false);
  assert.equal(isNativeApp(app), true);
  assert.equal(isNativeApp(undefined), false);
  assert.equal(isNativeApp({ Capacitor: { isNativePlatform: () => { throw new Error('x'); } } }), false);
});

test('links shared from the app point at the public site, not localhost', () => {
  assert.equal(shareBase(browser), 'https://johnyang0323.github.io/named_nothing/');
  assert.equal(shareBase(app), PUBLIC_APP_URL);
  assert.ok(!shareBase(app).includes('localhost'));
});
