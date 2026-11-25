// Phase 5B: student-only published SYNTHETIC topic, answer keys never exported.
import {json} from '../../../../../_shared/auth.mjs';
import {
  authorizePhase5PreviewRead,validPhase5TopicRoute,
  getPublishedSyntheticTopic,phase5DbFailureResponse,
} from '../../../../../_shared/phase5-readonly-topics.mjs';

export async function onRequestGet(context){
  const authorized=await authorizePhase5PreviewRead(context);
  if(authorized.error)return authorized.error;
  const route=validPhase5TopicRoute(
    context.params?.topicId,context.params?.revision
  );
  if(!route)return json({error:'INVALID_REQUEST'},400);
  try{
    const topic=await getPublishedSyntheticTopic(authorized.db,route);
    return topic?json({topic}):json({error:'NOT_FOUND'},404);
  }catch{
    return phase5DbFailureResponse();
  }
}
