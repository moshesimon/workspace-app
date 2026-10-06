import { gitText, validRef } from '../git/command.js';
import { currentBranch } from '../git/worktrees.js';
import { displayDiff } from '../git/changes.js';
import { createGhClient, GitHubUnavailable, parseJson, unavailable, type GhClient } from './cli.js';
export interface GitHubRepository {host:string;owner:string;name:string;repository:string;remote:string;}
export interface GitHubOptions {client?:GhClient;supportedHosts?:string[];repository?:string;}
export interface PullRequest {number:number;title:string;state:string;isDraft:boolean;url:string;headRefName:string;headRefOid:string;baseRefName:string;baseRefOid:string;headRepository:{name:string}|null;headRepositoryOwner:{login:string}|null;reviewDecision?:string;statusCheckRollup?:unknown[];updatedAt?:string;repository:string;[key:string]:unknown;}
function parseRemote(value:string,remote:string):GitHubRepository|null {
 let host:string,pathname:string;const ssh=value.match(/^(?:[^@\s]+@)?([^:\s/]+):(.+)$/);
 if(ssh&&!value.includes('://')){host=ssh[1]!;pathname=ssh[2]!;}else{try{const url=new URL(value);if(!['https:','http:','ssh:','git:'].includes(url.protocol)||url.password)return null;host=url.hostname;pathname=url.pathname.replace(/^\//,'');}catch{return null;}}
 const match=pathname.replace(/\.git$/,'').match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/?$/);if(!match||!/^[A-Za-z0-9.-]+$/.test(host)||host.startsWith('-'))return null;
 const owner=match[1]!,name=match[2]!;return {host:host.toLowerCase(),owner,name,repository:`${host.toLowerCase()}/${owner}/${name}`,remote};
}
function assertSupported(host:string,options:GitHubOptions) {const supported=new Set(['github.com',...(process.env.GH_HOST?[process.env.GH_HOST]:[]),...options.supportedHosts??[]]);if(!supported.has(host))throw new GitHubUnavailable('unsupported-host',`Host ${host} is not configured as a GitHub host`);}
export async function discoverRemote(root:string,options:GitHubOptions={}) {
 const names=(await gitText(root,['remote'])).split('\n').filter(Boolean);const remotes:GitHubRepository[]=[];
 for(const remote of names){for(const value of (await gitText(root,['remote','get-url','--all',remote])).split('\n')){const info=parseRemote(value,remote);if(info&&!remotes.some(r=>r.repository.toLowerCase()===info.repository.toLowerCase()))remotes.push(info);}}
 if(!remotes.length)throw new GitHubUnavailable('unsupported-host','No supported repository remote found');
 let headRepository=remotes.find(r=>r.remote==='origin')??remotes[0]!;
 // A push URL defines the source repository when fetch and push remotes differ.
 try{const push=parseRemote((await gitText(root,['remote','get-url','--push',headRepository.remote])).split('\n')[0]!,headRepository.remote);if(push)headRepository=push;}catch{ /* read-only fetch identity remains available */ }
 assertSupported(headRepository.host,options);const targets=remotes.filter(r=>r.host===headRepository.host);if(!targets.some(r=>r.repository.toLowerCase()===headRepository.repository.toLowerCase()))targets.push(headRepository);
 return {...headRepository,headRepository,repositories:targets};
}
const FIELDS='number,title,state,isDraft,url,headRefName,headRefOid,headRepository,headRepositoryOwner,baseRefName,baseRefOid,reviewDecision,statusCheckRollup,updatedAt';
function matching(pr:any,branch:string,head:GitHubRepository) {return pr.headRefName===branch&&pr.headRepository?.name?.toLowerCase()===head.name.toLowerCase()&&pr.headRepositoryOwner?.login?.toLowerCase()===head.owner.toLowerCase();}
function normalizeRest(row:any,repository:string):PullRequest {return {number:row.number,title:row.title,state:row.merged_at?'MERGED':String(row.state).toUpperCase(),isDraft:!!row.draft,url:row.html_url??'',headRefName:row.head?.ref??'',headRefOid:row.head?.sha??'',baseRefName:row.base?.ref??'',baseRefOid:row.base?.sha??'',headRepository:row.head?.repo?{name:row.head.repo.name}:null,headRepositoryOwner:row.head?.repo?.owner?{login:row.head.repo.owner.login}:null,updatedAt:row.updated_at,repository};}
export async function listPullRequests(root:string,branch?:string|null,options:GitHubOptions={}) {
 try {
  const refs=await discoverRemote(root,options);const head=branch??await currentBranch(root);if(!head)return {status:'available' as const,pullRequests:[] as PullRequest[],truncated:false,refreshedAt:new Date().toISOString(),detached:true};validRef(head);
  const client=options.client??createGhClient();await client.call(['auth','status','--hostname',refs.host]);const pullRequests:PullRequest[]=[];let truncated=false;
  for(const repository of refs.repositories){
   let candidates=parseJson<any[]>(await client.call(['pr','list','--repo',repository.repository,'--head',head,'--state','all','--limit','100','--json',FIELDS]));if(!Array.isArray(candidates))throw new GitHubUnavailable('invalid-response','Expected a pull request array');
   if(candidates.length>=100){candidates=[];for(let page=1;page<=100;page++){const rows=parseJson<any[]>(await client.call(['api','--hostname',refs.host,`repos/${repository.owner}/${repository.name}/pulls?state=all&per_page=100&page=${page}`]));if(!Array.isArray(rows))throw new GitHubUnavailable('invalid-response','Expected a pull request page');candidates.push(...rows.map(row=>normalizeRest(row,repository.repository)));if(rows.length<100)break;if(page===100)truncated=true;}}
   for(const candidate of candidates){if(matching(candidate,head,refs.headRepository)&&!pullRequests.some(pr=>pr.number===candidate.number&&pr.repository===repository.repository))pullRequests.push({...candidate,repository:repository.repository});}
  }
  return {status:'available' as const,pullRequests,truncated,refreshedAt:new Date().toISOString(),headRepository:refs.headRepository};
 }catch(e){return unavailable(e);}
}
export async function readPullRequest(root:string,number:number,options:GitHubOptions={}) {
 try {
  if(!Number.isSafeInteger(number)||number<1)throw new GitHubUnavailable('unknown','Invalid pull request number');const remotes=await discoverRemote(root,options);const repository=options.repository??remotes.repository;
  if(!remotes.repositories.some(r=>r.repository.toLowerCase()===repository.toLowerCase()))throw new GitHubUnavailable('unsupported-host','Pull request repository is not a registered remote');
  const client=options.client??createGhClient();await client.call(['auth','status','--hostname',remotes.host]);
  for(let attempt=0;attempt<2;attempt++){
   const before=parseJson<any>(await client.call(['pr','view',String(number),'--repo',repository,'--json','number,title,state,commits,files,headRefOid,baseRefOid,updatedAt']));
   const diff=await client.call(['pr','diff',String(number),'--repo',repository,'--color','never']);
   const after=parseJson<any>(await client.call(['pr','view',String(number),'--repo',repository,'--json','number,headRefOid,baseRefOid,updatedAt']));
   if(!before.headRefOid||!before.baseRefOid||!Array.isArray(before.commits)||!Array.isArray(before.files))throw new GitHubUnavailable('invalid-response','Incomplete pull request snapshot');
   if(before.headRefOid===after.headRefOid&&before.baseRefOid===after.baseRefOid&&before.updatedAt===after.updatedAt)return {status:'available' as const,pullRequest:before as {commits:any[];files:any[];[key:string]:any},diff:displayDiff(Buffer.from(diff)),headCommit:before.headRefOid as string,baseCommit:before.baseRefOid as string,refreshedAt:new Date().toISOString(),repository};
  }
  throw new GitHubUnavailable('snapshot-mismatch','Pull request changed during retrieval; refresh its details');
 }catch(e){return unavailable(e);}
}
