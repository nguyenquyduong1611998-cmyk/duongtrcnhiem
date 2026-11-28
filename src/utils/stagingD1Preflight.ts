// Staging-only, read-only D1 schema status client. Does not execute SQL or
// enable feature flags. The server authenticates the Firebase Google Admin.
import type {User} from 'firebase/auth';
import {BOOTSTRAPPED_ADMIN_UID,IS_FIREBASE_STAGING} from '../firebase';

export interface StagingD1PreflightReport {
  mode:'read-only-staging-preflight';
  status:'BLOCKED'|'REVIEW_MIGRATION_ONLY'|'SYNTHETIC_SCHEMA_PRESENT';
  requiresFreshBackup:true;
  needsHumanApproval:true;
  canExecuteMigrationAutomatically:false;
  deploymentAuthorized:false;
  existingRowCounts:Record<string,number>;
  synthetic:{
    exists:boolean;
    columnsValid:boolean;
    foreignKeyValid:boolean;
    constraintsValid:boolean;
    immutableTriggerPresent:boolean;
    dateIndexPresent:boolean;
    rowCount:number|null;
  };
}

export async function readStagingD1Preflight(
  user:User|null,
):Promise<StagingD1PreflightReport>{
  if(!IS_FIREBASE_STAGING||!user||
    user.uid!==BOOTSTRAPPED_ADMIN_UID)
    throw new Error('Cần đăng nhập Google Admin staging để xem tình trạng D1.');
  const response=await fetch('/api/demo-quiz/preflight',{
    method:'POST',
    headers:{
      'content-type':'application/json',
      authorization:'Bearer '+await user.getIdToken(),
    },
    body:JSON.stringify({action:'inspect'}),
    cache:'no-store',credentials:'same-origin',
  });
  if(response.status===404)
    throw new Error('Kiểm tra D1 đang tắt trên máy chủ staging.');
  if(response.status===403||response.status===401)
    throw new Error('Không có quyền Google Admin staging để kiểm tra D1.');
  if(!response.ok)
    throw new Error('Máy chủ chưa thể đối chiếu schema D1 staging.');
  const report:unknown=await response.json();
  if(!report||typeof report!=='object'||Array.isArray(report))
    throw new Error('Báo cáo D1 không hợp lệ.');
  const data=report as Record<string,unknown>;
  const synthetic=data.synthetic as Record<string,unknown>|undefined;
  const counts=data.existingRowCounts as Record<string,unknown>|undefined;
  const statuses=['BLOCKED','REVIEW_MIGRATION_ONLY','SYNTHETIC_SCHEMA_PRESENT'];
  if(data.mode!=='read-only-staging-preflight'||
    !statuses.includes(String(data.status))||
    data.requiresFreshBackup!==true||data.needsHumanApproval!==true||
    data.canExecuteMigrationAutomatically!==false||
    data.deploymentAuthorized!==false||
    !synthetic||!counts||Array.isArray(counts)||
    typeof synthetic.exists!=='boolean'||
    typeof synthetic.columnsValid!=='boolean'||
    typeof synthetic.foreignKeyValid!=='boolean'||
    typeof synthetic.constraintsValid!=='boolean'||
    typeof synthetic.immutableTriggerPresent!=='boolean'||
    typeof synthetic.dateIndexPresent!=='boolean'||
    !(synthetic.rowCount===null||
      (Number.isSafeInteger(synthetic.rowCount)&&Number(synthetic.rowCount)>=0))||
    !['demo_students','login_attempts','unit_accounts'].every(name=>
      !(name in counts)||(Number.isSafeInteger(counts[name])&&Number(counts[name])>=0)))
    throw new Error('Báo cáo D1 thiếu thông tin bắt buộc.');
  return report as StagingD1PreflightReport;
}
