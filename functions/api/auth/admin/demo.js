import {bindStagingDatabaseForRequest} from '../../../_shared/staging-db-binding.mjs';
import {
  requireStaging,json,checkRequest,smallJson,verifiedGoogleAdmin,
  usernameKey,hashPassword,randomPassword,noSecrets
} from '../../../_shared/auth.mjs';

export async function onRequestPost({request,env}){
  env=bindStagingDatabaseForRequest(env,request);
  const invalid=checkRequest(request);
  if(invalid)return invalid;
  try{requireStaging(env);}catch{return noSecrets();}
  if(!await verifiedGoogleAdmin(request))return json({error:'ADMIN_AUTH_REQUIRED'},403);
  let data;
  try{data=await smallJson(request);}catch{return json({error:'INVALID_REQUEST'},400);}
  const action=data.action;
  if(action!=='create' && action!=='delete')return json({error:'INVALID_ACTION'},400);
  let phase = 'unknown';
  try{
    if(action==='create'){
      // Only synthetic username/password. Do not accept a real username or password.
      const suffix=crypto.randomUUID().replaceAll('-','').slice(0,12);
      const username='test_hv_'+suffix;
      const uid='student_'+crypto.randomUUID().replaceAll('-','');
      const password=randomPassword();
      phase='password-hash';
      const kdf=await hashPassword(password);
      phase='d1-write';
      await env.AUTH_DB.prepare(
        'INSERT INTO demo_students (username,firebase_uid,password_salt,password_hash,kdf_iterations,active,created_at) VALUES (?,?,?,?,?,1,?)'
      ).bind(username,uid,kdf.salt,kdf.hash,kdf.iterations,Math.floor(Date.now()/1000)).run();
      return json({username,password,role:'student',note:'TÀI KHOẢN GIẢ: mật khẩu chỉ hiển thị một lần'});
    }
    const username=usernameKey(data.username);
    if(!username||!username.startsWith('test_hv_'))return json({error:'INVALID_DEMO_USERNAME'},400);
    phase='d1-delete';
    await env.AUTH_DB.prepare('DELETE FROM demo_students WHERE username=?').bind(username).run();
    await env.AUTH_DB.prepare('DELETE FROM login_attempts WHERE username=?').bind(username).run();
    return json({deleted:true,username});
  }catch(error){
    // Expose only the failed subsystem; do not reveal SQL statements, secrets, tokens,
    // exception messages, or browser-supplied data.
    console.error('Staging demo provisioning failure:', phase, error?.name || 'unknown');
    const errorCode = phase === 'password-hash' ? 'PASSWORD_HASH_UNAVAILABLE' :
      phase === 'd1-write' ? 'D1_WRITE_FAILED' :
      phase === 'd1-delete' ? 'D1_DELETE_FAILED' : 'SERVER_UNAVAILABLE';
    return json({error:errorCode},503);
  }
}
