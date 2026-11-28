// Phase 7J: guard read-only DEMO D1 history UI against late responses.
// No persisted data, scores, JWTs, account lookup or network access here.
export type Phase7HistoryRole='student'|'admin';

export function phase7HistoryIdentity(role:Phase7HistoryRole,uid:string|null):string {
  return role+':'+(uid??'');
}

export class Phase7HistoryReadGate {
  private key='';
  private generation=0;

  setIdentity(role:Phase7HistoryRole,uid:string|null):void {
    const next=phase7HistoryIdentity(role,uid);
    if(this.key!==next){
      this.key=next;
      this.generation++;
    }
  }

  begin(role:Phase7HistoryRole,uid:string|null):number {
    this.setIdentity(role,uid);
    return ++this.generation;
  }

  isCurrent(role:Phase7HistoryRole,uid:string|null,generation:number):boolean {
    return this.key===phase7HistoryIdentity(role,uid)&&
      this.generation===generation;
  }

  invalidate():void {
    this.generation++;
  }
}
