import { database as siteDatabase } from './vercel-database';
import { headers } from 'next/headers';
import type { ChatGPTUser } from '../app/chatgpt-auth';
import { authCookie,authCookieName,authorizationRequest,cookieValue,exchangeCode,GoogleAuthError,googleConfig,randomToken,safeReturnTo,tokenHash,verifyGoogleToken,type LoginFlow } from './google-oidc';

type AuthEnv={AUTH_ORIGIN?:string;GOOGLE_CLIENT_ID?:string;GOOGLE_CLIENT_SECRET?:string};
type Account={subject:string;owner_id:string;email:string;display_name:string};
type FlowRow={state_hash:string;browser_hash:string;nonce:string;verifier:string;return_to:string;link_owner_id:string|null;expires_at:number};
const variables=()=>process.env as AuthEnv;
const database=()=>siteDatabase;
const now=()=>Math.floor(Date.now()/1000);
export function isGoogleAuth(){return true;}
export function getGoogleConfig(){return googleConfig(variables(),process.env.NODE_ENV==='development');}
function redirectResponse(path:string,status=303){return new Response(null,{status,headers:{Location:path,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});}
function audit(owner:string,actor:string,action:string,detail:string){return database().prepare('INSERT INTO audit_events (id,owner_id,actor,action,entity_id,detail,timestamp) VALUES (?,?,?,?,?,?,?)').bind(crypto.randomUUID(),owner,actor,action,'authentication',detail,new Date().toISOString());}
export async function getGoogleUser():Promise<ChatGPTUser|null>{
 const config=getGoogleConfig();if(!config)return null;
 const requestHeaders=await headers(),token=cookieValue(requestHeaders.get('cookie'),authCookieName('session',config.secure));if(!/^[A-Za-z0-9_-]{43}$/.test(token))return null;
 const row=await database().prepare('SELECT a.owner_id,a.email,a.display_name FROM auth_sessions s JOIN google_accounts a ON a.subject=s.subject AND a.owner_id=s.owner_id WHERE s.token_hash=? AND s.expires_at>?').bind(await tokenHash(token),now()).first<{owner_id:string;email:string;display_name:string}>();
 return row?{userId:row.owner_id,email:row.email,displayName:row.display_name||row.email,fullName:row.display_name||null}:null;
}
export async function getLinkedAccount(owner:string){return database().prepare('SELECT subject,owner_id,email,display_name FROM google_accounts WHERE owner_id=?').bind(owner).first<Account>();}
export async function startGoogleSignIn(request:Request){
 const url=new URL(request.url);
 if(url.searchParams.get('mode')==='link')return redirectResponse('/login');
 const config=getGoogleConfig();if(!config)return redirectResponse('/login?error=setup_required');
 if(url.origin!==config.origin)return redirectResponse('/login?error=configuration');
 const result=await authorizationRequest(config,url.searchParams.get('returnTo'),null);
 const f=result.flow;await database().batch([database().prepare('DELETE FROM oauth_flows WHERE expires_at<=?').bind(now()),database().prepare('INSERT INTO oauth_flows (state_hash,browser_hash,nonce,verifier,return_to,link_owner_id,expires_at) VALUES (?,?,?,?,?,?,?)').bind(f.stateHash,f.browserHash,f.nonce,f.verifier,f.returnTo,f.linkOwnerId,f.expiresAt)]);
 const response=redirectResponse(result.url,302);response.headers.append('Set-Cookie',authCookie('flow',result.browserToken,config.secure,600));return response;
}
export async function finishGoogleSignIn(request:Request){
 const config=getGoogleConfig();if(!config)return redirectResponse('/login?error=setup_required');let returnTo='/login';
 try{
  const url=new URL(request.url);if(url.origin!==config.origin)throw new GoogleAuthError('configuration');
  const state=url.searchParams.get('state')||'',browser=cookieValue(request.headers.get('cookie'),authCookieName('flow',config.secure));
  if(!/^[A-Za-z0-9_-]{43}$/.test(state)||!/^[A-Za-z0-9_-]{43}$/.test(browser))throw new GoogleAuthError('expired_flow');
  const row=await database().prepare('DELETE FROM oauth_flows WHERE state_hash=? AND browser_hash=? AND expires_at>? RETURNING *').bind(await tokenHash(state),await tokenHash(browser),now()).first<FlowRow>();
  if(!row)throw new GoogleAuthError('expired_flow');returnTo=row.link_owner_id?'/account':'/login';
  if(url.searchParams.has('error'))throw new GoogleAuthError('cancelled');const code=url.searchParams.get('code');if(!code||code.length>4096)throw new GoogleAuthError('exchange_failed');
  const identity=await verifyGoogleToken(await exchangeCode(config,code,row.verifier),config.clientId,row.nonce);
  const existing=await database().prepare('SELECT subject,owner_id,email,display_name FROM google_accounts WHERE subject=?').bind(identity.subject).first<Account>();
  if(existing&&row.link_owner_id&&existing.owner_id!==row.link_owner_id)throw new GoogleAuthError('account_conflict');
  const owner=existing?.owner_id||row.link_owner_id||'google:'+identity.subject;
  if(row.link_owner_id){const linked=await getLinkedAccount(owner);if(linked&&linked.subject!==identity.subject)throw new GoogleAuthError('account_conflict');}
  const token=randomToken(),expires=now()+7*24*60*60;const statements:D1PreparedStatement[]=[];
  if(!existing)statements.push(database().prepare('INSERT INTO google_accounts (subject,owner_id,email,display_name,created_at) VALUES (?,?,?,?,?)').bind(identity.subject,owner,identity.email,identity.name,now()));
  else statements.push(database().prepare('UPDATE google_accounts SET email=?,display_name=? WHERE subject=? AND owner_id=?').bind(identity.email,identity.name,identity.subject,owner));
  statements.push(database().prepare('DELETE FROM auth_sessions WHERE expires_at<=?').bind(now()),database().prepare('INSERT INTO auth_sessions (token_hash,owner_id,subject,expires_at,created_at) VALUES (?,?,?,?,?)').bind(await tokenHash(token),owner,identity.subject,expires,now()),audit(owner,identity.email,row.link_owner_id?'GOOGLE_ACCOUNT_LINKED':'GOOGLE_SIGN_IN',row.link_owner_id?'Google account linked to existing workspace; ownership retained.':'Authenticated with a verified Google identity.'));
  await database().batch(statements);
  const response=redirectResponse(row.link_owner_id?'/account?linked=1':safeReturnTo(row.return_to));response.headers.append('Set-Cookie',authCookie('session',token,config.secure,7*24*60*60));response.headers.append('Set-Cookie',authCookie('flow','',config.secure,0));return response;
 }catch(error){const code=error instanceof GoogleAuthError?error.code:'unavailable';const response=redirectResponse(returnTo+'?error='+encodeURIComponent(code));response.headers.append('Set-Cookie',authCookie('flow','',config.secure,0));return response;}
}
export async function signOutGoogle(request:Request){
 const config=getGoogleConfig();if(!config)return redirectResponse('/login');
 if(request.headers.get('origin')!==config.origin)return new Response('Invalid request origin',{status:403});
 const token=cookieValue(request.headers.get('cookie'),authCookieName('session',config.secure));
 const user=await getGoogleUser();if(user&&/^[A-Za-z0-9_-]{43}$/.test(token))await database().batch([database().prepare('DELETE FROM auth_sessions WHERE token_hash=? AND owner_id=?').bind(await tokenHash(token),user.userId),audit(user.userId,user.email,'GOOGLE_SIGN_OUT','Application session revoked.')]);
 const response=redirectResponse('/login');response.headers.append('Set-Cookie',authCookie('session','',config.secure,0));return response;
}
