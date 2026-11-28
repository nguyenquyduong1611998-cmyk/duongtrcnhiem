// Phase 7I: only retain unsubmitted answer selections in memory when the
// authenticated server returns the *same immutable* Phase 6 DEMO session.
// Never persist answers, keys or tokens to localStorage, IndexedDB or SW caches.
import type {Phase6ExamState} from './phase6StudentExam';

export function retainPhase6LocalSelections(
  previous:Phase6ExamState|null,
  next:Phase6ExamState,
  selections:Readonly<Record<string,number>>,
):Record<string,number>{
  const a=previous?.session,b=next.session;
  if(!a||!b||previous?.result||next.result||
     a.sessionId!==b.sessionId||a.topicId!==b.topicId||
     a.revision!==b.revision||a.startedAt!==b.startedAt||
     a.expiresAt!==b.expiresAt||
     a.timeLimitSeconds!==b.timeLimitSeconds||
     a.questionCount!==b.questionCount||
     b.serverNow>b.expiresAt||
     !previous?.topic||!next.topic||
     previous.topic.title!==next.topic.title||
     previous.topic.questions.length!==next.topic.questions.length)
    return {};

  // Even an unchanged session ID is not enough if its published question
  // representation changed; never apply old selections to other options.
  for(let i=0;i<next.topic.questions.length;i++){
    const old=previous.topic.questions[i],fresh=next.topic.questions[i];
    if(old.id!==fresh.id||old.orderIndex!==fresh.orderIndex||
       old.text!==fresh.text||old.options.length!==fresh.options.length||
       old.options.some((option,index)=>option!==fresh.options[index]))
      return {};
  }

  const retained:Record<string,number>={};
  for(const question of next.topic.questions){
    const selected=selections[question.id];
    if(Number.isSafeInteger(selected)&&selected>=0&&selected<question.options.length)
      retained[question.id]=selected;
  }
  return retained;
}
