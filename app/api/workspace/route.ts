import { getWorkspaceUser } from '../../auth';
import { execute, snapshot, InputError } from '../../../lib/workspace-server';
export const dynamic='force-dynamic';
const response=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
export async function GET(){try{const user=await getWorkspaceUser();if(!user)return response({error:'Sign in to open your workspace.'},401);return response({state:await snapshot(user.userId,user.displayName)});}catch(error){console.error('Workspace read failed',error instanceof Error?error.message:'unknown');return response({error:'Unable to load the workspace. Please try again.'},500);}}
export async function POST(request:Request){
 try{
  const user=await getWorkspaceUser();if(!user)return response({error:'Sign in to use your workspace.'},401);
  const origin=request.headers.get('origin');if(origin&&origin!==new URL(request.url).origin)return response({error:'This request must come from the workspace.'},403);
  if(Number(request.headers.get('content-length')||0)>3_000_000)return response({error:'Upload a file smaller than 2 MB.'},413);
  const body=await request.text();if(body.length>3_000_000)return response({error:'The request is too large.'},413);
  let input;try{input=JSON.parse(body);}catch{return response({error:'Invalid request data.'},400);}if(!input||typeof input!=='object'||Array.isArray(input))return response({error:'Invalid request data.'},400);
  return response(await execute(user.userId,user.displayName,input));
 }catch(error){if(error instanceof InputError)return response({error:error.message,findings:error.findings},error.status);console.error('Workspace action failed',error instanceof Error?error.message:'unknown');return response({error:'The change could not be saved. Please retry.'},500);}
}
