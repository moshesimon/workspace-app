import { readdir, lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { DomainError } from '../../../contracts/src/errors.js';
import { registerRepository } from '../git/worktrees.js';
import { contains } from '../git/command.js';
const SKIP=new Set(['.git','node_modules','vendor','.venv','venv','__pycache__','dist','build','target','.next','.cache','coverage']);
export interface DiscoveryOptions {depth?:number;include?:string[];exclude?:string[];}
export interface DiscoveryRepository {path:string;commonDir:string;mainPath:string;relativePath:string;worktrees:Array<{path:string;relativePath:string}>;}
export interface DiscoveryEvidence {path:string;kind:string;message:string;}
export async function discoverProjectFolder(input:string,options:DiscoveryOptions={}) {
 const root=await realpath(path.resolve(input));if(!(await lstat(root)).isDirectory())throw new DomainError('INVALID_PATH','Project root is not a directory');
 const depth=options.depth??5;if(!Number.isInteger(depth)||depth<0||depth>25)throw new DomainError('INVALID_INPUT','Discovery depth must be between 0 and 25');
 for(const value of [...options.include??[],...options.exclude??[]])if(path.isAbsolute(value)||!contains(root,path.resolve(root,value)))throw new DomainError('INVALID_PATH','Discovery override escapes project root');
 const evidence:DiscoveryEvidence[]=[];const repositories:DiscoveryRepository[]=[];const identities=new Map<string,DiscoveryRepository>();let truncated=false,visited=0;
 const included=(relative:string)=>(options.include??[]).some(v=>relative===v||relative.startsWith(v+path.sep)||v.startsWith(relative+path.sep));
 const excluded=(relative:string)=>(options.exclude??[]).some(v=>relative===v||relative.startsWith(v+path.sep));
 async function walk(directory:string,level:number) {
  if(++visited>10_000){truncated=true;evidence.push({path:directory,kind:'truncated',message:'Directory count limit reached'});return;}
  const relative=path.relative(root,directory);if(excluded(relative)){evidence.push({path:directory,kind:'excluded',message:'Explicit exclusion'});return;}
  let children;try{children=await readdir(directory,{withFileTypes:true});}catch(e:any){truncated=true;evidence.push({path:directory,kind:'unreadable',message:e.message});return;}
  if(children.some(entry=>entry.name==='.git')) {
   try{const info=await registerRepository(directory);if(info.path===directory){let repository=identities.get(info.commonDir);if(!repository){repository={...info,relativePath:relative||'.',worktrees:[]};identities.set(info.commonDir,repository);repositories.push(repository);}repository.worktrees.push({path:directory,relativePath:relative||'.'});evidence.push({path:directory,kind:'git',message:'Verified Git root and common repository directory'});}}
   catch(e:any){truncated=true;evidence.push({path:directory,kind:'invalid-repository',message:e.message});}
  }
  for(const child of children.sort((a,b)=>a.name.localeCompare(b.name))) {
   const childPath=path.join(directory,child.name),childRelative=path.relative(root,childPath);
   if(child.isSymbolicLink()){evidence.push({path:childPath,kind:'skipped',message:'Symlink traversal disabled'});continue;}
   if(!child.isDirectory()||child.name==='.git'||excluded(childRelative))continue;
   if(SKIP.has(child.name)&&!included(childRelative)){evidence.push({path:childPath,kind:'skipped',message:'Dependency or generated directory'});continue;}
   if(level>=depth){truncated=true;evidence.push({path:childPath,kind:'truncated',message:'Depth limit reached'});continue;}
   await walk(childPath,level+1);if(visited>10_000)break;
  }
 }
 await walk(root,0);return {root,repositories,evidence,truncated,visitedDirectories:visited};
}
