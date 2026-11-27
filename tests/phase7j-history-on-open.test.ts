// @ts-expect-error Bun test runtime module isn't included in browser declarations.
import {test,expect} from 'bun:test';
import {readFileSync} from 'node:fs';
import {
  Phase7HistoryReadGate,phase7HistoryIdentity,
} from '../src/utils/phase7HistoryReadGate';

const A='student_'+'a'.repeat(32);
const B='student_'+'b'.repeat(32);

test('same student refresh keeps only most recent D1 history response',()=>{
  const gate=new Phase7HistoryReadGate();
  gate.setIdentity('student',A);
  const older=gate.begin('student',A);
  const latest=gate.begin('student',A);
  expect(gate.isCurrent('student',A,older)).toBe(false);
  expect(gate.isCurrent('student',A,latest)).toBe(true);
  gate.invalidate();
  expect(gate.isCurrent('student',A,latest)).toBe(false);
});

test('late PC results cannot appear after A to B or student to Admin switch',async()=>{
  const gate=new Phase7HistoryReadGate();
  const oldRequest=gate.begin('student',A);
  let finish!:()=>void;
  const delayed=new Promise<void>(resolve=>{finish=resolve;});
  let shown=false;
  const pending=delayed.then(()=>{
    if(gate.isCurrent('student',A,oldRequest))shown=true;
  });

  gate.setIdentity('student',B);
  const newRequest=gate.begin('student',B);
  finish();
  await pending;
  expect(shown).toBe(false);
  expect(gate.isCurrent('student',B,newRequest)).toBe(true);
  expect(gate.isCurrent('student',A,oldRequest)).toBe(false);

  gate.setIdentity('admin','SYNTHETIC_GOOGLE_ADMIN');
  expect(gate.isCurrent('student',B,newRequest)).toBe(false);
  expect(phase7HistoryIdentity('admin','SYNTHETIC_GOOGLE_ADMIN'))
    .not.toBe(phase7HistoryIdentity('student',B));
});

test('unmount cancels in-flight reads; a fresh screen requires new request',()=>{
  const gate=new Phase7HistoryReadGate();
  const old=gate.begin('student',A);
  gate.invalidate();
  expect(gate.isCurrent('student',A,old)).toBe(false);
  const fresh=gate.begin('student',A);
  expect(gate.isCurrent('student',A,fresh)).toBe(true);
});

test('Phase 6 history UI makes one read on opening, no polling or durable score cache',()=>{
  const panel=readFileSync('src/components/Phase6ResultsPanel.tsx','utf8');
  expect(panel).toContain("if(user)void run(0);");
  expect(panel).toContain("gateRef.current.invalidate()");
  expect(panel).toContain("loadedIdentity===identityKey?page:null");
  expect(panel).toContain("loadedIdentity===identityKey?summary:null");
  expect(panel).not.toContain("setInterval(");
  expect(panel).not.toContain("localStorage.");
  expect(panel).not.toContain("sessionStorage.");
  expect(panel).not.toContain("indexedDB.");
});
