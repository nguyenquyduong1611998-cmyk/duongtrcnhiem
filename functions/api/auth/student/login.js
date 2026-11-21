import {
  requireStaging,json,checkRequest,smallJson,usernameKey,pbkdf2,equalSecret,
  mintFirebaseToken,GENERIC_LOGIN_ERROR, noSecrets,failSafe
} from '../../../_shared/auth.mjs';
const DUMMY_SALT='AAAAAAAAAAAAAAAAAAAAAA';
const WINDOW_SECONDS=15*60;
const MAX_FAILURES=5;

async function updateFailures(db,username,old,now){
  const recent=old && now-old.first_failed<=WINDOW_SECONDS;
  const count=recent?old.failures+1:1;
  const first=recent?old.first_failed:now;
  const locked=count>=MAX_FAILURES?now+WINDOW_SECONDS:0;
  await db.prepare(
    'INSERT INTO login_attempts (username, failures, first_failed, locked_until) VALUES (?, ?, ?, ?) '+
    'ON CONFLICT(username) DO UPDATE SET failures=excluded.failures, first_failed=excluded.first_failed, locked_until=excluded.locked_until'
  ).bind(username,count,first,locked).run();
}
export async function onRequestPost({request,env}){
  const invalid=checkRequest(request);
  if(invalid)return invalid;
  try {requireStaging(env);}catch{return noSecrets();}
  let data;
  try{data=await smallJson(request);}catch{return json({error:'INVALID_REQUEST'},400);}
  const username=usernameKey(data.username);
  const password=data.password;
  if(!username || typeof password!=='string' || password.length>128 || password.length===0)
    return json({error:GENERIC_LOGIN_ERROR},401);
  try{
    const now=Math.floor(Date.now()/1000);
    const old=await env.AUTH_DB.prepare(
      'SELECT failures, first_failed, locked_until FROM login_attempts WHERE username=?'
    ).bind(username).first();
    if(old && old.locked_until>now) return json({error:GENERIC_LOGIN_ERROR},429);
    const user=await env.AUTH_DB.prepare(
      'SELECT username, firebase_uid, password_salt, password_hash, kdf_iterations, active FROM demo_students WHERE username=?'
    ).bind(username).first();
    const hash=await pbkdf2(password,user?.password_salt||DUMMY_SALT,user?.kdf_iterations||310000);
    if(!user || user.active!==1 || !equalSecret(hash,user.password_hash)){
      await updateFailures(env.AUTH_DB,username,old,now);
      return json({error:GENERIC_LOGIN_ERROR},401);
    }
    await env.AUTH_DB.prepare('DELETE FROM login_attempts WHERE username=?').bind(username).run();
    const token=await mintFirebaseToken(env,user.firebase_uid);
    return json({customToken:token,account:{id:user.firebase_uid,username:user.username,role:'student',active:true}});
  }catch(error){
    // Do not log credentials or Firebase key material.
    console.error('Staging login backend error category:',error?.name||'unknown');
    return failSafe();
  }
}
export async function onRequest({request}){
  return json({error:'METHOD_NOT_ALLOWED'},405);
}
