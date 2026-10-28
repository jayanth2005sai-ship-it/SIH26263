import { requireWorkspaceUser } from '../auth';
import { getGoogleConfig,getLinkedAccount,isGoogleAuth } from '../../lib/google-auth-server';
import { AuthFrame,GoogleButton,authErrors } from '../auth-ui';
export const dynamic='force-dynamic';
export default async function AccountPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const user=await requireWorkspaceUser('/account'),params=await searchParams,account=await getLinkedAccount(user.userId),configured=Boolean(getGoogleConfig()),enabled=isGoogleAuth();
 const error=typeof params.error==='string'?authErrors[params.error]:undefined;
 return <AuthFrame caption="Connected accounts"><span className="auth-card-label">ACCOUNT SETTINGS</span><h2>Your sign-in</h2><p>{user.displayName}</p>{error&&<div className="auth-message" role="alert">{error}</div>}{params.linked==='1'&&<div className="auth-message success" role="status">Google is connected to this workspace. Your existing records retain their ownership.</div>}<dl className="auth-account-details"><div><dt>Current sign-in</dt><dd>{enabled?'Google':'Sites / ChatGPT'}</dd></div><div><dt>Connected Google account</dt><dd>{account?.email||'Not connected yet'}</dd></div></dl>{!enabled&&!account&&<><GoogleButton href="/auth/google/start?mode=link&returnTo=%2Faccount" disabled={!configured}/><p className="auth-setup-note">Connect your Google account before switching authentication so that your existing institution records stay with you.</p></>}{!configured&&<div className="auth-message">Google sign-in is waiting for OAuth client configuration. Your current sign-in is still active.</div>}<a className="auth-secondary-link" href="/workspace">Return to your workspace →</a></AuthFrame>;
}
