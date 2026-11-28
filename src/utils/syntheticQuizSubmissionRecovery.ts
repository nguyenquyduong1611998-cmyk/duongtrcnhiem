// Phase 4G: resolve an ambiguous response to a DEMO quiz POST.
// Never silently retry a possibly committed submission: D1 is write-once.
// A recovered score might have been submitted from ANOTHER browser.
export class SyntheticQuizDeliveryUncertainError extends Error {
  constructor() {
    super('Không rõ máy chủ đã nhận bài DEMO hay chưa. Hãy đọc lại kết quả từ D1.');
    this.name='SyntheticQuizDeliveryUncertainError';
  }
}
export type SyntheticQuizReceipt<T> = {
  attempt:T;
  disposition:'new'|'existing'|'recovered';
};
export async function reconcileSyntheticQuizSubmission<T>(
  submit:()=>Promise<SyntheticQuizReceipt<T>>,
  readOwn:()=>Promise<T|null>,
):Promise<SyntheticQuizReceipt<T>> {
  try {
    return await submit();
  } catch(error) {
    // Unauthorized, 404, 409 with malformed result, or explicit 5xx errors
    // are NOT ambiguous deliveries. Never convert them into a success.
    if(!(error instanceof SyntheticQuizDeliveryUncertainError))
      throw error;
    // A network failure after send can mean the server already committed.
    // Read once; never POST again automatically, never claim a new grade.
    let previous:T|null=null;
    try{previous=await readOwn();}
    catch{return Promise.reject(error);}
    if(previous===null)throw error;
    return {attempt:previous,disposition:'recovered'};
  }
}
