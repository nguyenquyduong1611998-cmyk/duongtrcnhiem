# Phase 7H — iPhone PWA offline notice (STAGING ONLY)

Date: 26 November 2026. Observed: user installed pinned Preview site as an
iPhone home-screen web app and authenticated synthetic student C successfully
on both PC and iPhone; both showed the same three topics. With Airplane Mode
and Wi-Fi off, reopening the app showed Safari's network error. Upon
reconnecting, the student session worked normally. These are manually reported
device observations, **not** server/API/quiz synchronization acceptance.

## Minimal fix being proposed in this draft PR

The optional service worker `public/phase6f-preview-sw.js` handles only an
exact same-origin GET navigation to `/` (the manifest `start_url`).
While **online**, it fetches the network response with `cache:'no-store'`,
preserving normal Cloudflare Access and app sign-in. Only when that fetch
**throws** does it return a newly constructed, static UTF-8 Vietnamese HTML
notice (HTTP 503, `Cache-Control: no-store`, restrictive CSP).

The notice:
- tells the user to reconnect and reopen the application;
- contains NO user/account/password/JWT/answers/grades, and no forms or scripts;
- is never put in CacheStorage or persistent storage;
- does not let anyone take, submit or grade an exam offline;
- does not intercept authenticated API responses or change Pages Functions,
  D1 bindings, Firebase/Auth, deployment variables, feature flags, or Production.

Static hash-named immutable assets continue following the existing
cache-only-public-assets guard. Navigation URLs with query parameters and
paths other than `/` are untouched.

## Limitations and manual acceptance

A service worker must already be **registered, active and controlling the PWA**;
on a first installation or after an iOS eviction, this cannot be guaranteed.
Cloudflare Access may require a new Internet login. The notice is deliberately
NOT an offline signed-in home screen; authenticated navigation and real exams
must remain online.

Checklist to run **only after** reviewed Staging deploy, pinned Preview host,
Access policy and explicit approval:
1. With Internet, open installed iPhone web app twice; student C signs in and
   sees three topics. Do not disclose any credentials or OTP.
2. Enable Airplane Mode and turn Wi-Fi off; fully close and reopen the PWA.
3. The preferred result is the generic Vietnamese offline notice. Safari's
   network error can still occur if the service worker is not controlling.
4. Re-enable Internet and reopen; the login state and three-topic display must
   remain correct. No HTTP submission should be attempted while offline.
5. Repeat with different synthetic users A/B only when explicitly authorized,
   to check no cached private account/grade content bleeds between sessions.

Offline Node VM tests cover a thrown navigation fetch and explicit no-cache
properties; **no iOS live acceptance has happened for this PR**. Even green CI
is not proof of iPhone behavior or Cloudflare Access compatibility.

## Scope and release gates

Base: `feature/staging-demo-quiz-pilot`, not `main`.
This PR does not enable Phase 6, apply SQL migration, restore D1 or change
production. Keep draft pending review and CI; merge/deploy only with separate
operator approval.
