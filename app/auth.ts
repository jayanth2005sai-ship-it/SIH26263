import { redirect } from 'next/navigation';
import { getGoogleUser,isGoogleAuth } from '../lib/google-auth-server';
import { safeReturnTo } from '../lib/google-oidc';
export async function getWorkspaceUser(){return getGoogleUser();}
export async function requireWorkspaceUser(returnTo:string){const user=await getWorkspaceUser();if(user)return user;const path=safeReturnTo(returnTo);redirect(isGoogleAuth()?'/login?returnTo='+encodeURIComponent(path):'/signin-with-chatgpt?return_to='+encodeURIComponent(path));}
