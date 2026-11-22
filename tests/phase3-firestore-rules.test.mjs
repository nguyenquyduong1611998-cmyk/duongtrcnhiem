// PHASE 3D: Firestore Emulator only. All identities, documents and
// scores here are synthetic. Nothing connects to a live Firebase project.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  assertFails,assertSucceeds,initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,doc,deleteDoc,getDoc,getDocs,setDoc,updateDoc,
} from 'firebase/firestore';

const projectId='demo-phase3-session-guard';
const UID_A='student_'+'a'.repeat(32);
const UID_B='student_'+'b'.repeat(32);
const time=1800000000;
const custom=(version=4,authTime=time+100)=>({
  firebase:{sign_in_provider:'custom'},
  unitStudent:true,unitAuthVersion:version,auth_time:authTime,
});
const probeData=uid=>({
  ownerUid:uid,marker:'SYNTHETIC_ONLY',resultType:'PHASE3_REVOKE_PROBE',score:7,
});
const config={
  projectId,
  firestore:{
    rules:readFileSync(new URL('../firestore.phase3.pilot.rules',import.meta.url),'utf8'),
    host:'127.0.0.1',port:8089,
  },
};

test('revoked synthetic student cannot bypass Firestore Rules with a still-valid token',async()=>{
  const env=await initializeTestEnvironment(config);
  try{
    const seed=async(active,authVersion,revokeAfterSeconds)=>{
      await env.withSecurityRulesDisabled(async(context)=>{
        const db=context.firestore();
        await setDoc(doc(db,'pilot_session_states',UID_A),{
          active,authVersion,revokeAfterSeconds,
        });
        await setDoc(doc(db,'pilot_session_states',UID_B),{
          active:true,authVersion:4,revokeAfterSeconds:time,
        });
      });
    };
    await seed(true,4,time);
    const a=env.authenticatedContext(UID_A,custom());
    const b=env.authenticatedContext(UID_B,custom());
    const aDb=a.firestore(),bDb=b.firestore();
    const aProbe=doc(aDb,'pilot_session_probes',UID_A);
    const bProbe=doc(bDb,'pilot_session_probes',UID_B);

    // Correct owner A can create/read its own fake data; B its own.
    await assertSucceeds(setDoc(aProbe,probeData(UID_A)));
    await assertSucceeds(getDoc(aProbe));
    await assertSucceeds(setDoc(bProbe,probeData(UID_B)));
    await assertSucceeds(getDoc(bProbe));

    // B must not read, rewrite or delete A's records.
    await assertFails(getDoc(doc(bDb,'pilot_session_probes',UID_A)));
    await assertFails(deleteDoc(doc(bDb,'pilot_session_probes',UID_A)));
    await assertFails(setDoc(doc(bDb,'pilot_session_probes',UID_A),probeData(UID_A)));
    // Nor can the student overwrite even its own result.
    await assertFails(updateDoc(aProbe,{score:10}));
    await assertFails(getDocs(collection(aDb,'pilot_session_probes')));

    // The status registry is never writable OR readable by student clients.
    await assertFails(getDoc(doc(aDb,'pilot_session_states',UID_A)));
    await assertFails(setDoc(doc(aDb,'pilot_session_states',UID_A),{
      active:true,authVersion:4,revokeAfterSeconds:0,
    }));

    const anon=env.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(anon,'pilot_session_probes',UID_A)));
    await assertFails(setDoc(doc(anon,'pilot_session_probes',UID_A),probeData(UID_A)));

    // Google Admin does not receive a student identity for pilot probes.
    const googleAdmin=env.authenticatedContext('synthetic-admin',{
      firebase:{sign_in_provider:'google.com'},
    }).firestore();
    await assertFails(getDoc(doc(googleAdmin,'pilot_session_probes',UID_A)));

    // Incorrect claims and tokens cannot inherit a student session.
    for(const [label,claims] of [
      ['non-student-claim',{...custom(),unitStudent:false}],
      ['stale-version',{...custom(),unitAuthVersion:3}],
      ['string-version',{...custom(),unitAuthVersion:'4'}],
      ['revoked-auth-time',{...custom(),auth_time:time}],
      ['google-provider',{...custom(),firebase:{sign_in_provider:'google.com'}}],
      ['no-provider',{auth_time:time+100,unitStudent:true,unitAuthVersion:4}],
      ['missing-student-claim',{...custom(),unitStudent:undefined}],
    ]){
      const client=env.authenticatedContext(UID_A,claims).firestore();
      try {
        await assertFails(getDoc(doc(client,'pilot_session_probes',UID_A)));
      } catch (error) {
        throw new Error('Unexpectedly authorized invalid simulated claim: '+label,{cause:error});
      }
    }
    const unknown=env.authenticatedContext('student_'+'c'.repeat(32),custom()).firestore();
    await assertFails(getDoc(doc(unknown,'pilot_session_probes','student_'+'c'.repeat(32))));

    // Server disables A while the client keeps its old token.
    await seed(false,5,time+101);
    await assertFails(getDoc(aProbe));
    await assertFails(deleteDoc(aProbe));
    // B is unaffected and can read its own fixed result.
    await assertSucceeds(getDoc(bProbe));
    // Even a forged "new" version cannot re-enable a disabled record.
    const newerA=env.authenticatedContext(UID_A,custom(5,time+200)).firestore();
    await assertFails(getDoc(doc(newerA,'pilot_session_probes',UID_A)));

    // Re-enable with a new version and revoke cutoff: stale A token still denied.
    await seed(true,5,time+101);
    await assertFails(getDoc(aProbe));
    const tooOld=env.authenticatedContext(UID_A,custom(5,time+101)).firestore();
    await assertFails(getDoc(doc(tooOld,'pilot_session_probes',UID_A)));
    const fresh=env.authenticatedContext(UID_A,custom(5,time+200)).firestore();
    await assertSucceeds(getDoc(doc(fresh,'pilot_session_probes',UID_A)));

    // Irreversible fixed marker/scope: cannot write real grades or unknown fields.
    await assertFails(setDoc(doc(fresh,'pilot_session_probes','student_'+'d'.repeat(32)),
      probeData(UID_A)));
    await assertFails(setDoc(doc(fresh,'pilot_session_probes',UID_A),{
      ...probeData(UID_A),score:10,
    }));
    await assertFails(setDoc(doc(fresh,'pilot_session_probes',UID_A),{
      ...probeData(UID_A),password:'do-not-store',
    }));
    await assertFails(getDoc(doc(fresh,'attempts','real-attempt')));
    await assertFails(getDoc(doc(fresh,'account_directory','account1')));
    await assertSucceeds(deleteDoc(doc(fresh,'pilot_session_probes',UID_A)));
  } finally {
    await env.cleanup();
  }
});
