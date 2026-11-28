// Phase 5B: student-only list of published SYNTHETIC topic revisions.
// Feature flag defaults OFF. No SQL input from browser, no writes.
import {json} from '../../_shared/auth.mjs';
import {
  authorizePhase5PreviewRead,listPublishedSyntheticTopics,phase5DbFailureResponse,
} from '../../_shared/phase5-readonly-topics.mjs';

export async function onRequestGet(context){
  const authorized=await authorizePhase5PreviewRead(context);
  if(authorized.error)return authorized.error;
  try{
    return json({topics:await listPublishedSyntheticTopics(authorized.db)});
  }catch{
    return phase5DbFailureResponse();
  }
}
