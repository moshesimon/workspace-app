import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {tmpdir,homedir} from 'node:os';
export const PROTOCOL_VERSION=1;
export function defaultStateRoot(){return process.env.WORKTREE_MANAGER_HOME??join(homedir(),'Library','Application Support','Worktree Manager')}
export function connectionPaths(stateRoot:string){const key=createHash('sha256').update(stateRoot).digest('hex').slice(0,12);const directory=join(tmpdir(),`wm-${process.getuid?.()??'user'}-${key}`);return {directory,socket:join(directory,'controller.sock'),lock:join(directory,'controller.lock')}}
