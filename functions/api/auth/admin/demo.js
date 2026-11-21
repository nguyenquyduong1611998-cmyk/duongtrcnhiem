import {
  requireStaging,json,checkRequest,smallJson,verifiedGoogleAdmin,
  usernameKey,hashPassword,randomPassword,noSecrets,failSafe
} from '../../../_shared/auth.mjs';

export async function onRequestPost({request,env}){
  const invalid=checkRequest(request);
  if(invalid)return invalid;
  try{requireStaging(env);}catch{return noSecrets();}
  if(!await verifiedGoogleAdmin(request))return json({error:'ADMIN_AUTH_REQUIRED'},403);
  let data;
  try{data=await smallJson(request);}catch{return json({error:'INVALID_REQUEST'},400);}
  const action=data.action;
  if(action!=='create' && action!=='delete')return json({error:'INVALID_ACTION'},400);
  try{
    if(action==='create'){
      // Only synthetic username/password. Do not accept a real username or password.
      const suffix=crypto.randomUUID().replaceAll('-','').slice(0,12);
      const username='test_hv_'+suffix;
      const uid='student_'+crypto.randomUUID().replaceAll('-','');
      const password=randomPassword();
      const kdf=await hashPassword(password);
      await env.AUTH_DB.prepare(
        'INSERT INTO demo_students (username,firebase_uid,password_salt,password_hash,kdf_iterations,active,created_at) VALUES (?,?,?,?,?,1,?)'
      ).bind(username,uid,kdf.salt,kdf.hash,kdf.iterations,Math.floor(Date.now()/1000)).run();
      return json({username,password,role:'student',note:'TÀI KHOẢN GIẢ: mật khẩu chỉ hiển thị một lần'});
    }
    const username=usernameKey(data.username);
    if(!username||!username.startsWith('test_hv_'))return json({error:'INVALID_DEMO_USERNAME'},400);
    await env.AUTH_DB.prepare('DELETE FROM demo_students WHERE username=?').bind(username).run();
    await env.AUTH_DB.prepare('DELETE FROM login_attempts WHERE username=?').bind(username).run();
    return json({deleted:true,username});
  }catch(error){
    console.error('Staging demo provisioning category:',error?.name||'unknown');
    return failSafe();
  }
}
