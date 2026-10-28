import { requireWorkspaceUser } from '../auth';
import { isGoogleAuth } from '../../lib/google-auth-server';
import Workspace from './workspace';
export const dynamic='force-dynamic';
export default async function WorkspacePage(){const user=await requireWorkspaceUser('/workspace');return <Workspace userName={user.displayName} googleAuth={isGoogleAuth()}/>;}
