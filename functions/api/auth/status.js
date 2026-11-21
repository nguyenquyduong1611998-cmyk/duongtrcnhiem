import {PROJECT_ID, json} from '../../_shared/auth.mjs';
export async function onRequestGet({env}) {
  const ready=env?.STAGING_AUTH_ENABLED==='true' && env?.FIREBASE_PROJECT_ID===PROJECT_ID &&
    Boolean(env?.AUTH_DB && env?.FIREBASE_PRIVATE_KEY && env?.FIREBASE_SERVICE_ACCOUNT_EMAIL);
  return json({stage:'staging-only',ready,login:'username-password',mode:'demo-students-only'});
}
