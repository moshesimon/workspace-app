import { git, gitText, resolveCommit } from './command.js';
import { displayDiff } from './changes.js';
import { DomainError } from '../../../contracts/src/errors.js';
export async function readHistory(root:string,sourceCommit:string|null,limit=50,offset=0) {
 if(!Number.isInteger(limit)||limit<1||limit>200||!Number.isInteger(offset)||offset<0)throw new DomainError('INVALID_INPUT','History pagination is invalid');
 const head=await resolveCommit(root,'HEAD');const raw=(await git(root,['log',`--max-count=${limit}`,`--skip=${offset}`,'--format=%H%x00%s%x00%an%x00%aI%x00',head,'--'])).toString('utf8');
 const tokens=raw.split('\0');const commits:Array<{hash:string;subject:string;author:string;date:string}>=[];
 for(let i=0;i+3<tokens.length;i+=4){const hash=tokens[i]!.replace(/^\n/,'');if(hash)commits.push({hash,subject:tokens[i+1]!,author:tokens[i+2]!,date:tokens[i+3]!});}
 const commitsSinceBase=sourceCommit?Number(await gitText(root,['rev-list','--count',`${await resolveCommit(root,sourceCommit)}..${head}`,'--'])):null;return {commits,commitsSinceBase};
}
export async function readCommit(root:string,commit:string) {const hash=await resolveCommit(root,commit);return displayDiff(await git(root,['show','--format=fuller','--stat','--patch','--no-ext-diff','--no-textconv',hash,'--']));}
