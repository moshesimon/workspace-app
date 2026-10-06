import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { Checkout, Repository } from '../../../contracts/src/models.js';
import { DomainError } from '../../../contracts/src/errors.js';
import { canonicalExisting, canonicalNew, git, gitText, resolveCommit, validRef } from './command.js';
export interface WorktreeInfo {path:string;branch:string|null;head:string|null;locked:boolean;main:boolean;}
export async function discoverWorktrees(repositoryPath:string):Promise<WorktreeInfo[]> {
 const raw=(await git(repositoryPath,['worktree','list','--porcelain','-z'])).toString('utf8');
 const result:WorktreeInfo[]=[];let entry:WorktreeInfo|undefined;
 for(const token of raw.split('\0')) {
  if(token.startsWith('worktree ')){entry={path:token.slice(9),branch:null,head:null,locked:false,main:result.length===0};result.push(entry);}
  else if(entry&&token.startsWith('HEAD '))entry.head=token.slice(5);
  else if(entry&&token.startsWith('branch '))entry.branch=token.slice(7).replace(/^refs\/heads\//,'');
  else if(entry&&(token==='locked'||token.startsWith('locked ')))entry.locked=true;
 }
 for(const item of result){try{item.path=await canonicalExisting(item.path);}catch{ /* missing registered worktree remains visible */ }}
 return result;
}
export async function registerRepository(input:string) {
 const candidate=await canonicalExisting(input);if(await gitText(candidate,['rev-parse','--is-bare-repository'])==='true')throw new DomainError('UNSUPPORTED_REPOSITORY','Bare repositories are unsupported');
 const repositoryPath=await canonicalExisting(await gitText(candidate,['rev-parse','--show-toplevel']));
 const commonDir=await canonicalExisting(await gitText(repositoryPath,['rev-parse','--path-format=absolute','--git-common-dir']));
 const main=(await discoverWorktrees(repositoryPath)).find(w=>w.main);if(!main)throw new DomainError('INVALID_REPOSITORY','No main checkout found');
 return {path:repositoryPath,commonDir,mainPath:main.path};
}
export async function verifyRepository(repository:Repository) {
 const current=await registerRepository(repository.path);
 if(current.commonDir!==await canonicalExisting(repository.commonDir)||current.mainPath!==await canonicalExisting(repository.mainPath))throw new DomainError('REPOSITORY_CHANGED','Registered repository identity changed');return current;
}
export async function currentBranch(root:string):Promise<string|null> {try{return await gitText(root,['symbolic-ref','--quiet','--short','HEAD'])||null;}catch{return null;}}
function checkoutRecord(repository:Repository,workspaceId:string,checkoutPath:string,ownership:'created'|'adopted',branch:string|null,sourceRef:string|null,sourceCommit:string|null,createdBranch:string|null):Checkout {
 const now=new Date().toISOString();return {id:randomUUID(),workspaceId,repositoryId:repository.id,repositoryKey:repository.key,path:checkoutPath,ownership,createdBranch,currentBranch:branch,sourceRef,sourceCommit,originEvidence:sourceCommit?'recorded':'unknown',createdAt:ownership==='created'?now:null,registeredAt:now};
}
export async function createCheckout(input:{repository:Repository;workspaceId:string;path:string;branch:string;sourceRef:string;existingBranch?:boolean}):Promise<Checkout> {
 const {repository,workspaceId,branch,sourceRef,existingBranch=false}=input;await verifyRepository(repository);validRef(branch);
 try{await git(repository.path,['check-ref-format','--branch',branch]);}catch{throw new DomainError('INVALID_BRANCH','Invalid branch name');}
 const target=await canonicalNew(input.path);
 // Resolve provenance before the operation. Git never sees a moving source ref for a new branch.
 let sourceCommit:string|null=null;
 if(existingBranch){await resolveCommit(repository.path,`refs/heads/${branch}`);await git(repository.path,['worktree','add','--',target,branch]);}
 else {sourceCommit=await resolveCommit(repository.path,sourceRef);await git(repository.path,['worktree','add','-b',branch,'--',target,sourceCommit]);}
 const created=(await discoverWorktrees(repository.path)).find(w=>w.path===target);if(!created||created.branch!==branch)throw new DomainError('CREATION_INCOMPLETE','Created checkout could not be verified',{path:target});
 return checkoutRecord(repository,workspaceId,target,'created',branch,existingBranch?null:sourceRef,sourceCommit,existingBranch?null:branch);
}
export async function adoptCheckout(input:{repository:Repository;workspaceId:string;path:string}):Promise<Checkout> {
 await verifyRepository(input.repository);const target=await canonicalExisting(input.path);const entry=(await discoverWorktrees(input.repository.path)).find(w=>w.path===target);
 if(!entry)throw new DomainError('UNREGISTERED_WORKTREE','Path is not a linked worktree of this repository');if(entry.main)throw new DomainError('PROTECTED_CHECKOUT','Main checkout cannot be adopted');
 return checkoutRecord(input.repository,input.workspaceId,target,'adopted',entry.branch,null,null,null);
}
