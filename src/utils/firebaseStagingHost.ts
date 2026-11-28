// Client-only Firebase environment selection. A test Cloudflare Pages
// deployment must never initialize the REAL Firebase project just because
// the Vite build omitted VITE_FIREBASE_ENV=staging.
//
// This check does not grant any API access. DEMO endpoints use their own
// exact-host allowlist, staging server flags and verified Firebase sessions.
export const FIREBASE_TEST_PAGES_HOST='duongtrcnhiem-test.pages.dev';

export function shouldUseStagingFirebase(
  viteFlag:string|undefined,
  hostname:string,
):boolean{
  const actualHostname=hostname.toLowerCase();
  const belongsToTestPagesProject=
    actualHostname===FIREBASE_TEST_PAGES_HOST ||
    actualHostname.endsWith('.'+FIREBASE_TEST_PAGES_HOST);
  return belongsToTestPagesProject || viteFlag==='staging';
}
