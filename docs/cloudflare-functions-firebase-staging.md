# Cloudflare Pages Functions + Firebase staging (no VPS)

**Status:** demo-only implementation on `fix-firebase-login`. The production website, production Firebase and `main` remain unchanged. This feature **must not be used with real student accounts** until additional security review and authorization tests.

## Architecture

- Static PWA remains on the `duongtrcnhiem-test` Cloudflare Pages project.
- Cloudflare Pages Functions process `/api/auth/student/login`, `/api/auth/admin/demo` and `/api/auth/status`.
- A **separate Cloudflare D1 database** holds random-salted PBKDF2-SHA256 hashes of **demo-only** student passwords (310,000 iterations). It does **not** hold plaintext passwords.
- Only a verified staging Google Admin ID token may create/delete a synthetic demo student. Admin identity is checked cryptographically using Google's published Firebase signing keys.
- After server-side validation, the Function signs a short-lived Firebase custom token, exchanged by the browser for a Firebase Auth session. Students never receive the signing private key.
- The current Firestore staging Rules do **not** yet authorize real student result synchronization for custom-token users. Do not claim that grades/history sync or student account migration is finished.
- Existing public demo topics and previously tested Firestore probes are separate from this D1 login path.

## Step 1 — Create a D1 database

In Cloudflare Dashboard → **Storage & Databases** → **D1** → Create database:

- Suggested name: `duongtrcnhiem-auth-staging`.
- Open D1 **Console** and run the complete SQL in `serverless/d1-staging-schema.sql`.
- Do not put actual usernames/passwords in the SQL console.

## Step 2 — Bind D1 to the test Pages project

Cloudflare → Workers & Pages → Pages project **`duongtrcnhiem-test`** → Settings → Bindings (interface may label it **Runtime bindings**):

- Type: **D1 database**.
- Variable/binding name: `AUTH_DB` (must match exactly).
- Select the D1 database created in Step 1.
- Target the Pages **Production** environment of `duongtrcnhiem-test`, because this separate Pages project deploys the `fix-firebase-login` branch as its production branch. This does **not** mean Firebase or GitHub production.

## Step 3 — Add server-only Pages variables and secrets

In the same Pages project → Settings → Environment variables / **Variables and Secrets**, choose the Pages **Production** deployment environment and configure:

| Name | Type | Value |
| --- | --- | --- |
| `STAGING_AUTH_ENABLED` | variable | `true` |
| `FIREBASE_PROJECT_ID` | variable | `duongtrcnhiem-staging` |
| `FIREBASE_SERVICE_ACCOUNT_EMAIL` | secret | service-account email in **staging** Firebase/Google Cloud project |
| `FIREBASE_PRIVATE_KEY` | **secret, never plaintext build variable** | PEM `-----BEGIN PRIVATE KEY-----...` corresponding to the **staging-only service account** |

**Security:** Do not paste or upload a service-account private key into GitHub, ChatGPT, source code, screenshots, Vite environment variables (`VITE_*`), or the D1 SQL console. Create a dedicated staging service account with the minimum privileges required for Firebase custom-token signing. Protect and rotate credentials. If organization policy disables JSON private keys, stop and plan a keyless IAM signing alternative; do not weaken the restrictions.

The backend rejects requests with HTTP 503 until *all* required bindings are present, the staging project ID matches exactly, and `STAGING_AUTH_ENABLED=true`. Redeploy the Pages test project after configuring secrets/bindings.

## Step 4 — Confirm runtime readiness without credentials

Open `https://duongtrcnhiem-test.pages.dev/api/auth/status` after redeployment. Expected when ready:

```json
{"stage":"staging-only","ready":true,"login":"username-password","mode":"demo-students-only"}
```

`ready:false` means credentials/bindings are missing or disabled. This endpoint does not test your ability to sign in; Admin creation and student sign-in are separate tests.

If the page is protected by Cloudflare Access, authenticate with the **existing allowed Admin email** first. Do not open Cloudflare Access to everyone for testing.

## Step 5 — Browser demo (only after D1 configuration)

1. Open the test website as internal Admin; connect the **staging Google Admin**.
2. Open **Lưu đám mây**; scroll down to the **Cloudflare Functions** section.
3. Click **Tạo học viên DEMO có mật khẩu**. The backend creates a random `test_hv_...` username, a long random password, a salted hash in D1 and an opaque Firebase UID. Credentials are displayed once, in Admin browser memory.
4. Use a separate browser behind the same authorized Cloudflare Access boundary. Enter the generated demo username/password into the existing login form.
5. The browser calls `/api/auth/student/login` (same-origin HTTPS), obtains a **custom Firebase Auth token**, and signs into Firebase with its own UID.
6. Return to Admin browser and click **Xóa tài khoản DEMO khỏi D1**. Then sign out the demo student. Deletion **prevents new D1 password logins**, but does **not** automatically revoke an already-issued Firebase session; full session revocation is a future prerequisite for real accounts.

## Security and remaining work

- D1 credentials are server-side and demo-only. Cloudflare Pages Functions secrets never enter the Vite frontend bundle.
- Five failed username attempts within 15 minutes temporarily block additional attempts for that username. For real accounts also configure edge IP-based rate limiting / bot protection. Username throttling alone is not sufficient for production.
- Cloudflare Access currently permits only the configured Admin email. Student rollout requires a new, correctly scoped Access policy *after* the backend and Rules are validated; do not publish the site without access controls.
- The legacy internal Admin and legacy student passwords still exist in frontend demo data; this prototype does not make those passwords secure. Replace the legacy auth flow before production.
- Existing staging Firestore Rules treat Google-authenticated accounts as verified for sensitive operations. Custom student sessions still require **strict per-UID Firestore Rules**, trusted grade computation, and emulator negative tests before real attempts can be synchronized.
- Do not upload real accounts, names, units, or scores, even though the demo login is now implemented.
- Avoid assigning privileged Firebase custom claims to students.
- Never copy service-account secrets into a `.dev.vars` file that gets committed; ensure it is ignored locally.

Official resources: https://developers.cloudflare.com/pages/functions/get-started/ ; https://developers.cloudflare.com/pages/functions/bindings/ ; https://firebase.google.com/docs/auth/admin/create-custom-tokens ; https://firebase.google.com/docs/auth/web/custom-auth .
