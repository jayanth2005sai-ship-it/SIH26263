import { startGoogleSignIn } from '../../../../lib/google-auth-server';
export const dynamic='force-dynamic';
export async function GET(request:Request){return startGoogleSignIn(request);}
