import {bindStagingDatabaseForRequest} from '../../_shared/staging-db-binding.mjs';
import {PROJECT_ID, json} from '../../_shared/auth.mjs';

// Read-only staging diagnostics. Never expose secrets, account records or passwords.
export async function onRequestGet({request,env}) {
  env=bindStagingDatabaseForRequest(env,request);
  let d1Connected = false;
  let tablesReady = false;
  if (env?.AUTH_DB) {
    try {
      const result = await env.AUTH_DB.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('demo_students', 'login_attempts')"
      ).all();
      d1Connected = true;
      const names = new Set((result.results || []).map((row) => row.name));
      tablesReady = names.has('demo_students') && names.has('login_attempts');
    } catch {
      // No infrastructure details should leak in the public diagnostics response.
    }
  }
  const ready = tablesReady &&
    env?.STAGING_AUTH_ENABLED === 'true' &&
    env?.FIREBASE_PROJECT_ID === PROJECT_ID &&
    Boolean(env?.FIREBASE_PRIVATE_KEY && env?.FIREBASE_SERVICE_ACCOUNT_EMAIL);
  return json({
    stage: 'staging-only',
    ready,
    d1Connected,
    tablesReady,
    login: 'username-password',
    mode: 'demo-students-only',
  });
}
