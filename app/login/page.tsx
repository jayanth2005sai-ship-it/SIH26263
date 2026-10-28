import { redirect } from 'next/navigation';
import { getWorkspaceUser } from '../auth';
import { getGoogleConfig,isGoogleAuth } from '../../lib/google-auth-server';
import { safeReturnTo } from '../../lib/google-oidc';
import { AuthFrame,GoogleButton,authErrors } from '../auth-ui';
export const dynamic='force-dynamic';
export default async function LoginPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const params=await searchParams,user=await getWorkspaceUser(),enabled=isGoogleAuth(),configured=Boolean(getGoogleConfig()),returnTo=safeReturnTo(params.returnTo);
 if(user&&enabled)redirect(returnTo);
 const error=typeof params.error==='string'?authErrors[params.error]:undefined;
 return <AuthFrame><span className="auth-card-label">ACCOUNT ACCESS</span><h2>Sign in to IDVERA</h2><p>Use your Google account to manage your institution’s records, reviews and verification history.</p>{error&&<div className="auth-message" role="alert">{error}</div>}<GoogleButton disabled={!configured} href={'/auth/google/start?'+new URLSearchParams({returnTo,...(!enabled?{mode:'link'}:{})})}/>{!configured&&<p className="auth-setup-note" role="status">Google sign-in is being connected. Please check back soon.</p>}{!enabled&&user&&<a className="auth-secondary-link" href={returnTo}>Open your current workspace →</a>}{!enabled&&user&&configured&&<a className="auth-secondary-link" href="/account">Manage your connected account →</a>}<div className="auth-privacy-note"><strong>Your records stay with your workspace.</strong><p>Google supplies your account identity. Student records remain in IDVERA and are not sent to Google as part of sign-in.</p></div></AuthFrame>;
}
