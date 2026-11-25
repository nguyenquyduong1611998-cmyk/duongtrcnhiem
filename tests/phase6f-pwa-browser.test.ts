// @ts-expect-error Bun test runtime modules are not browser declarations.
import {describe,test,expect,mock,beforeEach,afterAll} from 'bun:test';
// No real service worker, credentials, Cloudflare or browser is contacted.
mock.module('../src/firebase',()=>({IS_FIREBASE_STAGING:true}));
const pwa=await import('../src/utils/phase6fPreviewPwa');
const HOST='feature-staging-demo-quiz-pi.duongtrcnhiem-test.pages.dev';
const oldWindow=Object.getOwnPropertyDescriptor(globalThis,'window');
const oldDocument=Object.getOwnPropertyDescriptor(globalThis,'document');
const oldNavigator=Object.getOwnPropertyDescriptor(globalThis,'navigator');
let registrations:Array<{script:string;options:RegistrationOptions}>;
let links:Array<{rel:string;href:string;attrs:Record<string,string>}>;
function setup(host=HOST,protocol='https:',withServiceWorker=true){
  registrations=[];
  links=[];
  const document={
    head:{appendChild(link:unknown){links.push(link as typeof links[number]);}},
    querySelector:()=>links.find(x=>Object.hasOwn(x.attrs,'data-phase6f-preview-manifest'))??null,
    createElement:()=>({
      rel:'',href:'',attrs:{} as Record<string,string>,
      setAttribute(name:string,value:string){this.attrs[name]=value;},
    }),
  };
  const browser={location:{hostname:host,protocol}};
  const navigator=withServiceWorker?{
    serviceWorker:{
      register:mock(async(script:string,options:RegistrationOptions)=>{
        registrations.push({script,options});return {};
      }),
    },
  }:{};
  for(const [key,value] of [
    ['window',browser],['document',document],['navigator',navigator],
  ] as const)
    Object.defineProperty(globalThis,key,{configurable:true,value});
}
beforeEach(()=>setup());
afterAll(()=>{
  for(const [key,previous] of [
    ['window',oldWindow],['document',oldDocument],['navigator',oldNavigator],
  ] as const){
    if(previous)Object.defineProperty(globalThis,key,previous);
    else Reflect.deleteProperty(globalThis,key);
  }
});
describe('Phase6F PWA Preview-only independent opt-in',()=>{
  test('exact pinned HTTPS Preview and true flag can install manifest and SW',async()=>{
    expect(pwa.isPhase6fPreviewPwaEnabled(HOST,'https:','true')).toBe(true);
    expect(await pwa.registerPhase6fPreviewPwa('true')).toBe(true);
    expect(links).toHaveLength(1);
    expect(links[0].rel).toBe('manifest');
    expect(links[0].href).toBe('/phase6f-preview.webmanifest');
    expect(registrations).toEqual([{
      script:'/phase6f-preview-sw.js',options:{scope:'/'},
    }]);
    expect(await pwa.registerPhase6fPreviewPwa('true')).toBe(true);
    expect(links).toHaveLength(1,'no duplicate manifest elements');
    expect(registrations).toHaveLength(2,'repeat registration is harmless');
  });
  test('default OFF, production, foreign Preview, localhost and HTTP never register',async()=>{
    for(const host of [
      HOST+'.attacker.example','duongtrcnhiem.pages.dev',
      'duongtrcnhiem-test.pages.dev','feature-other.duongtrcnhiem-test.pages.dev',
      'localhost',
    ]){
      setup(host);
      expect(await pwa.registerPhase6fPreviewPwa('true')).toBe(false);
      expect(links).toHaveLength(0);
      expect(registrations).toHaveLength(0);
    }
    setup(HOST,'http:');
    expect(await pwa.registerPhase6fPreviewPwa('true')).toBe(false);
    setup(HOST);
    for(const flag of [undefined,null,false,'false','TRUE','1']){
      expect(await pwa.registerPhase6fPreviewPwa(flag)).toBe(false);
      expect(pwa.isPhase6fPreviewPwaEnabled(HOST,'https:',flag)).toBe(false);
    }
    expect(links).toHaveLength(0);
    expect(registrations).toHaveLength(0);
    expect(pwa.isPhase6fPreviewPwaEnabled(HOST,'https:','true',false))
      .toBe(false);
  });
  test('missing serviceWorker and registration errors fail safely',async()=>{
    setup(HOST,'https:',false);
    expect(await pwa.registerPhase6fPreviewPwa('true')).toBe(false);
    expect(links).toHaveLength(0);
    setup();
    const navigator={serviceWorker:{
      register:mock(async()=>{throw new Error('private device error');}),
    }};
    Object.defineProperty(globalThis,'navigator',{configurable:true,value:navigator});
    expect(await pwa.registerPhase6fPreviewPwa('true')).toBe(false);
  });
});
