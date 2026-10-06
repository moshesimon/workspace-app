import { createHash } from 'node:crypto';
import { lstat, readdir, readFile, readlink, realpath } from 'node:fs/promises';
import path from 'node:path';
import type { Checkout, Repository } from '../../../contracts/src/models.js';
import { DomainError } from '../../../contracts/src/errors.js';
import { canonicalExisting, git, gitText, resolveCommit } from './command.js';
import { discoverWorktrees, verifyRepository } from './worktrees.js';
import { readChanges } from './changes.js';
export interface DestroyFile {path:string;type:'file'|'directory'|'symlink';size:number;hash:string;ignored:boolean;tracked:boolean;}
const hash=(data:Buffer|string)=>createHash('sha256').update(data).digest('hex');
export async function inspectDestroy(checkout:Checkout,repository:Repository) {
 if(checkout.ownership!=='created'&&checkout.ownership!=='adopted')throw new DomainError('UNMANAGED_CHECKOUT','Checkout has not been adopted or created');
 if(checkout.repositoryId!==repository.id||checkout.repositoryKey!==repository.key)throw new DomainError('REPOSITORY_CHANGED','Checkout repository identity does not match');
 await verifyRepository(repository);const rootStat=await lstat(checkout.path);if(rootStat.isSymbolicLink())throw new DomainError('PROTECTED_CHECKOUT','Checkout path cannot be a symlink');
 const target=await canonicalExisting(checkout.path);if(target!==path.resolve(checkout.path))throw new DomainError('PROTECTED_CHECKOUT','Checkout path identity changed');
 const info=(await discoverWorktrees(repository.path)).find(w=>w.path===target);
 if(!info)throw new DomainError('UNREGISTERED_WORKTREE','Checkout is no longer registered');if(info.main||target===await canonicalExisting(repository.mainPath))throw new DomainError('PROTECTED_CHECKOUT','Main checkout cannot be removed');
 if(info.locked)throw new DomainError('LOCKED_CHECKOUT','Locked checkout cannot be removed');
 if((await realpath(await gitText(target,['rev-parse','--path-format=absolute','--git-common-dir'])))!==await canonicalExisting(repository.commonDir))throw new DomainError('REPOSITORY_CHANGED','Worktree belongs to another repository');
 const staged=(await git(target,['ls-files','--stage','-z'])).toString('utf8');if(staged.split('\0').some(line=>line.startsWith('160000 ')))throw new DomainError('UNSUPPORTED_SUBMODULE','Worktrees containing submodules cannot be removed');
 const head=await resolveCommit(target,'HEAD');if(!info.branch){const protection=await gitText(target,['for-each-ref','--contains',head,'--format=%(refname)','refs/heads/']);if(!protection)throw new DomainError('UNPROTECTED_HEAD','Detached commits must be protected by a local branch');}
 const changes=await readChanges(target);const tracked=new Set((await git(target,['ls-files','-z'])).toString('utf8').split('\0').filter(Boolean));
 const ignored=new Set((await git(target,['ls-files','--others','--ignored','--exclude-standard','-z'])).toString('utf8').split('\0').filter(Boolean));
 const files:DestroyFile[]=[];let entries=0;
 async function walk(directory:string) {
  for(const name of (await readdir(directory)).sort()){if(directory===target&&name==='.git')continue;if(++entries>100_000)throw new DomainError('INVENTORY_TOO_LARGE','Destruction inventory exceeds safe bound; no preview was issued');
   const absolute=path.join(directory,name),relative=path.relative(target,absolute),stat=await lstat(absolute);const isIgnored=ignored.has(relative)||[...ignored].some(v=>v.startsWith(relative+'/'));
   if(stat.isSymbolicLink()){const link=await readlink(absolute);files.push({path:relative,type:'symlink',size:Buffer.byteLength(link),hash:hash(link),ignored:isIgnored,tracked:tracked.has(relative)});}
   else if(stat.isDirectory()){files.push({path:relative,type:'directory',size:0,hash:hash(String(stat.mode)),ignored:isIgnored,tracked:false});await walk(absolute);}
   else if(stat.isFile()){files.push({path:relative,type:'file',size:stat.size,hash:hash(await readFile(absolute)),ignored:isIgnored,tracked:tracked.has(relative)});}
   else throw new DomainError('UNSUPPORTED_FILE','Special files prevent safe destruction',{path:relative});
  }
 }
 await walk(target);const dirty=!changes.clean||files.some(file=>file.type!=='directory'&&!file.tracked);
 const fingerprint=hash(JSON.stringify({checkoutId:checkout.id,workspaceId:checkout.workspaceId,ownership:checkout.ownership,repositoryId:repository.id,commonDir:repository.commonDir,path:target,device:rootStat.dev,inode:rootStat.ino,gitFile:hash(await readFile(path.join(target,'.git'))),head,branch:info.branch,locked:info.locked,changes,files}));
 return {checkoutId:checkout.id,path:target,branch:info.branch,files,dirty,fingerprint};
}
export async function removeCheckout(checkout:Checkout,repository:Repository,expectedFingerprint:string,discardChanges:boolean) {
 const current=await inspectDestroy(checkout,repository);if(current.fingerprint!==expectedFingerprint)throw new DomainError('STALE_PREVIEW','Checkout changed after the destruction preview');
 if(current.dirty&&!discardChanges)throw new DomainError('DIRTY_CHECKOUT','Explicit discard authorization is required');
 await git(repository.path,['worktree','remove',...(current.dirty&&discardChanges?['--force']:[]),'--',current.path]);
 const stillRegistered=(await discoverWorktrees(repository.path)).some(w=>w.path===current.path);let exists=true;try{await lstat(current.path);}catch(e:any){if(e.code==='ENOENT')exists=false;else throw e;}
 if(stillRegistered||exists)throw new DomainError('REMOVAL_INCOMPLETE','Checkout removal could not be verified');return {checkoutId:checkout.id,path:current.path,removed:true,retainedBranch:current.branch};
}
