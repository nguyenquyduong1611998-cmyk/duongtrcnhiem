// Phase 7A: authenticated Admin-only read-only D1 Preview schema inventory.
// Never submits an arbitrary SQL query, DB identifier, student UID or password.
import type {User} from 'firebase/auth';
import {BOOTSTRAPPED_ADMIN_UID,IS_FIREBASE_STAGING} from '../firebase';
import {isPhase5DemoPreviewHostname} from './phase5DemoTopics';

const ENDPOINT='/api/phase7/preflight';
const STAGES=['baseline','phase6b','phase6c','phase6a','phase6d'] as const;
const STATES=[
  'ABSENT','SCHEMA_CANDIDATE','BLOCKED_INCOMPLETE_OR_MISMATCHED',
] as const;
const STATUS=[
  'BLOCKED_BASELINE_MISSING_OR_MISMATCHED',
  'BLOCKED_PARTIAL_OR_UNEXPECTED_ORDER',
  'MIGRATION_REVIEW_REQUIRED',
  'SCHEMA_CANDIDATE_REVIEW_ONLY',
] as const;
type StageName=typeof STAGES[number];
type StageStatus=typeof STATES[number];
type OverallStatus=typeof STATUS[number];

export interface Phase7PreviewSchemaReport {
  mode:'phase7a-preview-d1-schema-preflight';
  status:OverallStatus;
  stages:Record<StageName,StageStatus>;
  migrationOrder:('phase6b'|'phase6c'|'phase6a'|'phase6d')[];
  targetDatabaseIdentityVerified:false;
  freshBackupVerified:false;
  liveRestoreVerified:false;
  schemaOnlyChecks:true;
  migrationsExecuted:false;
  deployAuthorized:false;
}
export function isPhase7PreviewPreflightUiEnabled(host:string,flag:unknown):boolean{
  return IS_FIREBASE_STAGING&&flag==='true'&&isPhase5DemoPreviewHostname(host);
}
function record(x:unknown):Record<string,unknown>{
  if(!x||typeof x!=='object'||Array.isArray(x))
    throw new Error('Dữ liệu kiểm tra D1 không hợp lệ.');
  return x as Record<string,unknown>;
}
export async function readPhase7PreviewSchema(user:User|null):
Promise<Phase7PreviewSchemaReport>{
  if(!IS_FIREBASE_STAGING||typeof window==='undefined'||
     !isPhase5DemoPreviewHostname(window.location.hostname)||
     !user||user.uid!==BOOTSTRAPPED_ADMIN_UID)
    throw new Error('Chỉ Google Admin staging trên đúng Preview được kiểm tra D1.');
  const token=await user.getIdToken();
  if(!token)throw new Error('Phiên đăng nhập Admin chưa sẵn sàng.');
  let response:Response;
  try{
    response=await fetch(ENDPOINT,{
      method:'POST',
      headers:{authorization:'Bearer '+token,'content-type':'application/json'},
      body:JSON.stringify({action:'inspect'}),
      credentials:'same-origin',cache:'no-store',redirect:'error',
    });
  }catch{
    throw new Error('Không thể kết nối Preview D1. Chưa xác nhận trạng thái schema.');
  }
  if(response.status===401||response.status===403)
    throw new Error('Google Admin không có quyền kiểm tra schema.');
  if(response.status===404)
    throw new Error('API kiểm tra Phase 7A chưa được bật trên Preview.');
  if(!response.ok)
    throw new Error('Kiểm tra schema D1 chưa thành công; không thực hiện migration.');
  const raw=record(await response.json().catch(()=>null));
  if(raw.mode!=='phase7a-preview-d1-schema-preflight'||
     !STATUS.includes(raw.status as OverallStatus)||
     raw.targetDatabaseIdentityVerified!==false||
     raw.freshBackupVerified!==false||raw.liveRestoreVerified!==false||
     raw.schemaOnlyChecks!==true||raw.migrationsExecuted!==false||
     raw.deployAuthorized!==false)
    throw new Error('Kết quả kiểm tra D1 không đáng tin cậy.');
  const parts=record(raw.stages);
  if(Object.keys(parts).sort().join(',')!==[...STAGES].sort().join(',')||
     !STAGES.every(name=>STATES.includes(parts[name] as StageStatus)))
    throw new Error('Danh sách cấu trúc Phase 6 không hợp lệ.');
  if(!Array.isArray(raw.migrationOrder)||
     raw.migrationOrder.join(',')!=='phase6b,phase6c,phase6a,phase6d')
    throw new Error('Thứ tự migration Phase 6 không hợp lệ.');
  return {
    mode:'phase7a-preview-d1-schema-preflight',
    status:raw.status as OverallStatus,
    stages:Object.fromEntries(STAGES.map(name=>[name,parts[name]])) as
      Record<StageName,StageStatus>,
    migrationOrder:['phase6b','phase6c','phase6a','phase6d'],
    targetDatabaseIdentityVerified:false,
    freshBackupVerified:false,
    liveRestoreVerified:false,
    schemaOnlyChecks:true,migrationsExecuted:false,deployAuthorized:false,
  };
}
