import { base64url, createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

export type GoogleConfig={clientId:string;clientSecret:string;origin:string;secure:boolean;callbackUrl:string};
export type GoogleIdentity={subject:string;email:string;name:string};
export type LoginFlow={stateHash:string;browserHash:string;nonce:string;verifier:string;returnTo:string;linkOwnerId:string|null;expiresAt:number};
export class GoogleAuthError extends Error{constructor(public code:string){super(code);}}
const googleKeys=createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'),{timeoutDuration:5000});
export function googleConfig(values:Record<string,unknown>,development=false):GoogleConfig|null{
 const clientId=typeof values.GOOGLE_CLIENT_ID==='string'?values.GOOGLE_CLIENT_ID.trim():'';
 const clientSecret=typeof values.GOOGLE_CLIENT_SECRET==='string'?values.GOOGLE_CLIENT_SECRET.trim():'';
 const originValue=typeof values.AUTH_ORIGIN==='string'?values.AUTH_ORIGIN.trim():'';
 if(!clientId||!clientSecret||!originValue)return null;
 if(!/^[a-zA-Z0-9._-]+\.apps\.googleusercontent\.com$/.test(clientId))return null;
 try{const origin=new URL(originValue);const loopback=['localhost','127.0.0.1','[::1]'].includes(origin.hostname);
  if(origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash||(origin.protocol!=='https:'&&!(development&&loopback&&origin.protocol==='http:')))return null;
  return {clientId,clientSecret,origin:origin.origin,secure:origin.protocol==='https:',callbackUrl:origin.origin+'/auth/google/callback'};
 }catch{return null;}
}
export function safeReturnTo(value:unknown){if(typeof value!=='string'||!value.startsWith('/')||value.startsWith('//')||value.includes('\\')||/[\r\n]/.test(value))return '/workspace';try{const url=new URL(value,'https://idvera.local');if(url.origin!=='https://idvera.local'||/^\/(auth(?:\/|$)|login(?:\/|$)|signin-with-chatgpt|signout-with-chatgpt|callback)/.test(url.pathname))return '/workspace';return url.pathname+url.search+url.hash;}catch{return '/workspace';}}
export function randomToken(){return base64url.encode(crypto.getRandomValues(new Uint8Array(32)));}
export async function tokenHash(value:string){return base64url.encode(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))));}
export function equalToken(a:string,b:string){if(a.length!==b.length)return false;let result=0;for(let i=0;i<a.length;i++)result|=a.charCodeAt(i)^b.charCodeAt(i);return result===0;}
export function authCookieName(kind:'session'|'flow',secure:boolean){return (secure?'__Host-':'')+'idvera_'+kind;}
export function cookieValue(header:string|null,name:string){if(!header)return '';for(const part of header.split(';')){const at=part.indexOf('=');if(at>=0&&part.slice(0,at).trim()===name)return part.slice(at+1).trim();}return '';}
export function authCookie(kind:'session'|'flow',token:string,secure:boolean,maxAge:number){return `${authCookieName(kind,secure)}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure?'; Secure':''}`;}
export async function authorizationRequest(config:GoogleConfig,returnTo:unknown,linkOwnerId:string|null,now=Math.floor(Date.now()/1000)){
 const state=randomToken(),browserToken=randomToken(),nonce=randomToken(),verifier=randomToken();
 const flow:LoginFlow={stateHash:await tokenHash(state),browserHash:await tokenHash(browserToken),nonce,verifier,returnTo:safeReturnTo(returnTo),linkOwnerId,expiresAt:now+600};
 const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');
 url.search=new URLSearchParams({client_id:config.clientId,redirect_uri:config.callbackUrl,response_type:'code',scope:'openid email profile',state,nonce,code_challenge:await tokenHash(verifier),code_challenge_method:'S256',prompt:'select_account'}).toString();
 return {url:url.toString(),flow,browserToken};
}
export async function exchangeCode(config:GoogleConfig,code:string,verifier:string,fetcher:typeof fetch=fetch){
 const response=await fetcher('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:config.clientId,client_secret:config.clientSecret,code,code_verifier:verifier,redirect_uri:config.callbackUrl,grant_type:'authorization_code'}),signal:AbortSignal.timeout(10000)});
 if(!response.ok)throw new GoogleAuthError('exchange_failed');const body=await response.json() as {id_token?:unknown};if(typeof body.id_token!=='string')throw new GoogleAuthError('exchange_failed');return body.id_token;
}
export async function verifyGoogleToken(token:string,clientId:string,nonce:string,keys:JWTVerifyGetKey=googleKeys):Promise<GoogleIdentity>{
 try{const {payload}=await jwtVerify(token,keys,{issuer:['https://accounts.google.com','accounts.google.com'],audience:clientId,algorithms:['RS256'],requiredClaims:['sub','email','email_verified','exp','iat','nonce'],clockTolerance:5,maxTokenAge:'10 minutes'});
  if(typeof payload.nonce!=='string'||!equalToken(payload.nonce,nonce)||payload.email_verified!==true||typeof payload.sub!=='string'||!payload.sub||payload.sub.length>255||typeof payload.email!=='string'||payload.email.length>254||!payload.email.includes('@')||(payload.azp!==undefined&&payload.azp!==clientId)||(Array.isArray(payload.aud)&&payload.aud.length>1&&payload.azp!==clientId))throw new GoogleAuthError('invalid_identity');
  return {subject:payload.sub,email:payload.email,name:typeof payload.name==='string'?payload.name.slice(0,200):payload.email};
 }catch{throw new GoogleAuthError('invalid_identity');}
}
