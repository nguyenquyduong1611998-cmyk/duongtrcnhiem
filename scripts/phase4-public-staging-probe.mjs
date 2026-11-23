// Phase 4J — optional unauthenticated, non-mutating staging surface probe.
// NEVER runs in CI against Cloudflare. No cookies, Firebase tokens, secrets,
// student IDs, D1 queries, migrations, or deployment operations.
// A 404 can mean either flag OFF OR route not deployed; do not infer readiness.
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {PHASE4_PINNED_STAGING_HOST,PHASE4_PILOT_PREVIEW_HOST}
  from '../functions/_shared/phase4-host-guard.mjs';

export const STAGING_HOST=PHASE4_PINNED_STAGING_HOST;
export const PREVIEW_HOST=PHASE4_PILOT_PREVIEW_HOST;
const probes=Object.freeze([
  {name:'existing_auth_status',path:'/api/auth/status',method:'GET'},
  {name:'demo_student_route',path:'/api/demo-quiz/student',method:'POST'},
  {name:'demo_admin_route',path:'/api/demo-quiz/admin',method:'POST'},
  {name:'demo_preflight_route',path:'/api/demo-quiz/preflight',method:'POST'},
]);

async function readSmallBody(response){
  const rawLength=Number(response.headers.get('content-length')||0);
  if(rawLength>4096)return null;
  if(!response.body)return null;
  const reader=response.body.getReader();
  const chunks=[];
  let length=0;
  try{
    while(true){
      const {done,value}=await reader.read();
      if(done)break;
      length+=value.byteLength;
      if(length>4096)return null;
      chunks.push(value);
    }
  }finally{reader.releaseLock();}
  const array=new Uint8Array(length);
  let offset=0;
  for(const chunk of chunks){array.set(chunk,offset);offset+=chunk.byteLength;}
  return new TextDecoder('utf-8',{fatal:true}).decode(array);
}

function categorize(route,httpStatus){
  if(httpStatus===null)return 'NO_NETWORK_RESPONSE';
  if([301,302,303,307,308,401,403].includes(httpStatus))
    return 'ACCESS_OR_AUTH_GATE_UNKNOWN';
  if(httpStatus===404)return 'OFF_OR_NOT_DEPLOYED';
  if(httpStatus===429)return 'RATE_LIMITED';
  if(httpStatus>=500)return 'SERVER_UNAVAILABLE';
  if(route==='existing_auth_status' && httpStatus===200)
    return 'STATUS_ENDPOINT_RESPONDED';
  if(route!=='existing_auth_status' && httpStatus>=200 && httpStatus<300)
    return 'UNEXPECTED_UNAUTHENTICATED_SUCCESS';
  if(route!=='existing_auth_status' && httpStatus===400)
    return 'ROUTE_MAY_BE_ENABLED_REVIEW_REQUIRED';
  return 'UNEXPECTED_RESPONSE';
}

async function one({name,path,method},transport,host){
  const url='https://'+host+path;
  const opts={
    method,
    redirect:'manual',      // never follow a Cloudflare Access login redirect
    credentials:'omit',      // no browser session, cookies or stored identity
    cache:'no-store',
    headers:{
      'cache-control':'no-store',
      ...(method==='POST'?{'content-type':'application/json'}:{}),
    },
    ...(method==='POST'?{body:'{"action":"result"}'}:{}),
    signal:AbortSignal.timeout(7000),
  };
  let response;
  try{response=await transport(url,opts);}
  catch{return {route:name,httpStatus:null,result:'NO_NETWORK_RESPONSE'};}
  if(!response||!Number.isInteger(response.status))
    return {route:name,httpStatus:null,result:'NO_NETWORK_RESPONSE'};
  const outcome={
    route:name,
    httpStatus:response.status,
    result:categorize(name,response.status),
  };
  if(name==='existing_auth_status'&&response.status===200 &&
     (response.headers.get('content-type')||'').includes('application/json')){
    try {
      const content=await readSmallBody(response);
      const data=content===null?null:JSON.parse(content);
      if(data?.stage==='staging-only'&&typeof data?.ready==='boolean'&&
         data?.mode==='demo-students-only'){
        outcome.readinessReported=data.ready;
      }
    }catch{/* No raw server response is ever included in the report. */}
  }
  return outcome;
}
export async function probePublicStaging(transport=fetch,{preview=false}={}){
  const host=preview?PREVIEW_HOST:STAGING_HOST;
  const results=[];
  for(const spec of probes)results.push(await one(spec,transport,host));
  const unsafe=results.some(r=>r.result==='UNEXPECTED_UNAUTHENTICATED_SUCCESS'
    ||r.result==='ROUTE_MAY_BE_ENABLED_REVIEW_REQUIRED');
  const allOff=results.slice(1).every(r=>r.result==='OFF_OR_NOT_DEPLOYED');
  const access=results.some(r=>r.result==='ACCESS_OR_AUTH_GATE_UNKNOWN');
  return {
    mode:'unauthenticated-public-surface-check',
    host,
    status:unsafe?'MANUAL_SECURITY_REVIEW':
      access?'ACCESS_GATE_INCONCLUSIVE':
      allOff?'NEW_APIS_OFF_OR_NOT_DEPLOYED':'UNVERIFIED',
    results,
    // Even if auth/status says "ready", it does not query D1 or check
    // Cloudflare bindings, current deployments, backups, or Firebase Rules.
    deploymentVerified:false,
    databaseVerified:false,
    backupVerified:false,
    accessPolicyVerified:false,
    approvedForActivation:false,
    note:'Only HTTP observations; a 404 does not prove the new code is deployed.',
  };
}

async function main(){
  const args=process.argv.slice(2);
  const canonical=args.length===1&&args[0]==='--allow-network';
  const preview=args.length===2&&args[0]==='--allow-network'&&args[1]==='--preview';
  if(!canonical&&!preview){
    process.stdout.write(
      'Not executed. After explicit approval, run:\n'+
      'node scripts/phase4-public-staging-probe.mjs --allow-network\n'+
      'node scripts/phase4-public-staging-probe.mjs --allow-network --preview\n'+
      'Only contacts exact allowlisted Pages test hosts; no credentials.\n',
    );
    process.exitCode=process.argv.includes('--help')?0:2;
    return;
  }
  try{
    const report=await probePublicStaging(fetch,{preview});
    process.stdout.write(JSON.stringify(report,null,2)+'\n');
    if(report.status!=='NEW_APIS_OFF_OR_NOT_DEPLOYED')
      process.exitCode=1;
  }catch{
    process.stdout.write('{"status":"UNVERIFIED","approvedForActivation":false}\n');
    process.exitCode=1;
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
  await main();
