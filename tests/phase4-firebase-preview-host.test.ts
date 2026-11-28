// @ts-expect-error Bun's runner-only test module lacks browser TS declarations.
import {describe,test,expect} from 'bun:test';
import {shouldUseStagingFirebase,FIREBASE_TEST_PAGES_HOST}
  from '../src/utils/firebaseStagingHost';

describe('Phase 4M: Cloudflare Pages test deployments use staging Firebase only',()=>{
  test('canonical test Pages site uses staging even if Vite env is unset/wrong',()=>{
    for(const flag of [undefined,'','production','staging']){
      expect(shouldUseStagingFirebase(flag,FIREBASE_TEST_PAGES_HOST)).toBe(true);
    }
  });
  test('real shortened branch Preview alias uses staging regardless of build env',()=>{
    const preview='feature-staging-demo-quiz-pi.duongtrcnhiem-test.pages.dev';
    for(const flag of [undefined,'production','staging'])
      expect(shouldUseStagingFirebase(flag,preview)).toBe(true);
  });
  test('Cloudflare Pages hash Preview URLs of the same test project also use staging',()=>{
    expect(shouldUseStagingFirebase(undefined,
      '70871492.duongtrcnhiem-test.pages.dev')).toBe(true);
  });
  test('never match a similar-looking attacker or unrelated production host',()=>{
    for(const hostname of [
      'duongtrcnhiem-test.pages.dev.evil.example',
      'duongtrcnhiem.pages.dev',
      'another.pages.dev',
      'feature-staging-demo-quiz-pi.duongtrcnhiem.pages.dev',
      'duongtrcnhiem-test-pages-dev',
      'notduongtrcnhiem-test.pages.dev',
      '',
    ]){
      expect(shouldUseStagingFirebase(undefined,hostname)).toBe(false);
      expect(shouldUseStagingFirebase('production',hostname)).toBe(false);
    }
  });
  test('explicit staging flag works on localhost without changing production defaults',()=>{
    expect(shouldUseStagingFirebase('staging','localhost')).toBe(true);
    expect(shouldUseStagingFirebase('production','localhost')).toBe(false);
    expect(shouldUseStagingFirebase(undefined,'localhost')).toBe(false);
  });
});
