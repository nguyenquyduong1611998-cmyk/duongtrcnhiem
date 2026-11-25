// Phase 6F: only pinned Cloudflare Pages Preview can opt into this PWA.
// No application data or Firebase tokens are persisted by registration.
// Production/main, other Pages preview hosts, localhost and HTTP are OFF.
import {IS_FIREBASE_STAGING} from '../firebase';
import {isPhase5DemoPreviewHostname} from './phase5DemoTopics';

export function isPhase6fPreviewPwaEnabled(
  hostname:string,protocol:string,flag:unknown,
  staging=IS_FIREBASE_STAGING,
):boolean{
  return staging&&flag==='true'&&protocol==='https:'&&
    isPhase5DemoPreviewHostname(hostname);
}

export async function registerPhase6fPreviewPwa(flag:unknown):Promise<boolean>{
  if(typeof window==='undefined'||typeof document==='undefined'||
     typeof navigator==='undefined'||!isPhase6fPreviewPwaEnabled(
       window.location.hostname,window.location.protocol,flag,
     )||!('serviceWorker' in navigator))
    return false;
  try{
    // Linking the manifest at runtime means production builds do not advertise
    // installability unless BOTH Preview hostname and UI flag match.
    if(!document.querySelector('link[data-phase6f-preview-manifest]')){
      const link=document.createElement('link');
      link.rel='manifest';
      link.href='/phase6f-preview.webmanifest';
      link.setAttribute('data-phase6f-preview-manifest','');
      document.head.appendChild(link);
    }
    await navigator.serviceWorker.register('/phase6f-preview-sw.js',{
      scope:'/',
    });
    return true;
  }catch{
    // Registration failure never breaks authenticated exams or browser UI.
    // No cache/offline fallback for any submitted grades or POST requests.
    return false;
  }
}
