import { signOutGoogle } from '../../../lib/google-auth-server';
export const dynamic='force-dynamic';
export async function POST(request:Request){return signOutGoogle(request);}
