// Phase 5B staging-only read API projects published DEMO questions via this allowlist.
// The HTTP route is OFF by default and never authorized for production content.
// Never use SELECT * or spread a database row into a browser response.
// The correct answer and grading explanation remain SERVER ONLY.
const ID=/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/;

function safeText(v,max) {
  return typeof v==='string' && v.length>0 && v.length<=max;
}

export function projectPublishedTopic(version,questionRows) {
  if(!version||version.state!=='published'||
    !ID.test(version.topic_id||'')||
    !Number.isSafeInteger(version.revision)||version.revision<1||
    !safeText(version.code,40)||!safeText(version.title,250)||
    typeof version.description!=='string'||version.description.length>2000||
    !Number.isSafeInteger(version.time_limit_seconds)||
    version.time_limit_seconds<60||version.time_limit_seconds>14400)
    throw new Error('PHASE5_TOPIC_NOT_PUBLISHABLE');
  if(!Array.isArray(questionRows)||
    questionRows.length<1||questionRows.length>500)
    throw new Error('PHASE5_QUESTIONS_INVALID');

  const seenIds=new Set(),seenOrders=new Set();
  const questions=questionRows.map(q=>{
    if(!q||q.topic_id!==version.topic_id||
      q.revision!==version.revision||!ID.test(q.question_id||'')||
      !Number.isSafeInteger(q.order_index)||q.order_index<1||
      q.order_index>500||!safeText(q.question_text,4000)||
      !safeText(q.option_a,1000)||!safeText(q.option_b,1000)||
      !safeText(q.option_c,1000)||!safeText(q.option_d,1000)||
      seenIds.has(q.question_id)||seenOrders.has(q.order_index))
      throw new Error('PHASE5_QUESTIONS_INVALID');
    seenIds.add(q.question_id);seenOrders.add(q.order_index);
    return {
      id:q.question_id,
      orderIndex:q.order_index,
      text:q.question_text,
      options:[q.option_a,q.option_b,q.option_c,q.option_d],
    };
  }).sort((a,b)=>a.orderIndex-b.orderIndex);

  return {
    topicId:version.topic_id,
    revision:version.revision,
    code:version.code,
    title:version.title,
    description:version.description,
    timeLimitSeconds:version.time_limit_seconds,
    questions,
  };
}
