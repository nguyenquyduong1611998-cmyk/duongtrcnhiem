// Phase 3I: read-only, aggregated health check for synthetic D1 outbox.
// It returns counts and severity only; no UIDs, credentials, tokens or rows.
// No polling, cron or production notification is installed.
const MAX_AGE_SECONDS=300;
const MAX_ATTEMPTS=5;

export async function summarizePilotRevocationQueue(db, options={}) {
  if(!db?.prepare) throw new Error('OUTBOX_DB_REQUIRED');
  const now=options.now??Math.floor(Date.now()/1000);
  if(!Number.isSafeInteger(now)||now<=MAX_AGE_SECONDS)
    throw new Error('INVALID_MONITOR_CLOCK');
  const row=await db.prepare(
    'SELECT COUNT(*) AS total, '+
    "COALESCE(SUM(CASE WHEN state='pending' THEN 1 ELSE 0 END),0) AS pending, "+
    "COALESCE(SUM(CASE WHEN state='processing' THEN 1 ELSE 0 END),0) AS processing, "+
    "COALESCE(SUM(CASE WHEN state='delivered' THEN 1 ELSE 0 END),0) AS delivered, "+
    "COALESCE(SUM(CASE WHEN state<>'delivered' AND created_at<=? THEN 1 ELSE 0 END),0) AS stale, "+
    "COALESCE(SUM(CASE WHEN state<>'delivered' AND attempts>=? THEN 1 ELSE 0 END),0) AS repeatFailures, "+
    "COALESCE(SUM(CASE WHEN state='processing' AND lease_until<=? THEN 1 ELSE 0 END),0) AS expiredLeases, "+
    "COALESCE(SUM(CASE WHEN state='pending' AND next_attempt_at<=? THEN 1 ELSE 0 END),0) AS due, "+
    "MIN(CASE WHEN state<>'delivered' THEN created_at END) AS oldestUnresolvedAt "+
    'FROM student_auth_mirror_outbox'
  ).bind(now-MAX_AGE_SECONDS,MAX_ATTEMPTS,now,now).first();
  if(!row)throw new Error('OUTBOX_MONITOR_UNAVAILABLE');

  const fields=['total','pending','processing','delivered','stale',
    'repeatFailures','expiredLeases','due'];
  for(const name of fields) {
    if(!Number.isSafeInteger(row[name])||row[name]<0||
       row[name]>1000000000)throw new Error('INVALID_OUTBOX_COUNTER');
  }
  if(row.pending+row.processing+row.delivered!==row.total ||
     row.due>row.pending||row.expiredLeases>row.processing ||
     row.stale>row.pending+row.processing ||
     row.repeatFailures>row.pending+row.processing)
    throw new Error('INCONSISTENT_OUTBOX_COUNTER');

  const unresolved=row.pending+row.processing;
  const timestamp=row.oldestUnresolvedAt;
  if((unresolved===0&&timestamp!==null) ||
     (unresolved>0&&(!Number.isSafeInteger(timestamp) ||
       timestamp<=0||timestamp>now)))
    throw new Error('INVALID_OUTBOX_AGE');
  const oldestAgeSeconds=unresolved===0?null:now-timestamp;
  // "critical" means an operator must investigate; "attention" means
  // the drain is not caught up. Never claim direct Firestore access is
  // revoked just because all queue items were delivered.
  const severity=row.stale||row.repeatFailures||row.expiredLeases?
    'critical':unresolved?'attention':'clear';

  return {
    mode:'synthetic-revocation-monitor',
    severity,
    unresolved,
    pending:row.pending,
    processing:row.processing,
    delivered:row.delivered,
    due:row.due,
    stale:row.stale,
    repeatFailures:row.repeatFailures,
    expiredLeases:row.expiredLeases,
    oldestAgeSeconds,
    maxAgeSeconds:MAX_AGE_SECONDS,
    maxAttempts:MAX_ATTEMPTS,
    firebaseAccessConfirmedBlocked:false,
  };
}
