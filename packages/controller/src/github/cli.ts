import { execFile } from 'node:child_process';
export type UnavailableReason='missing-cli'|'authentication'|'network'|'unsupported-host'|'snapshot-mismatch'|'invalid-response'|'unknown';
export interface GhResult {stdout:string;stderr?:string;code:number;}
export interface GhClient {call(args:string[]):Promise<string>;}
export class GitHubUnavailable extends Error {constructor(public reason:UnavailableReason,message:string){super(message);this.name='GitHubUnavailable';}}
function classify(message:string):UnavailableReason {
 if(/ENOENT|command not found|not installed/i.test(message))return 'missing-cli';
 if(/not logged|authenticat|login|HTTP 401|HTTP 403|token/i.test(message))return 'authentication';
 if(/network|resolve host|connection|timeout|timed out|HTTP 5\d\d|TLS|offline/i.test(message))return 'network';return 'unknown';
}
async function execute(args:string[]):Promise<GhResult> {return new Promise(resolve=>execFile('gh',args,{encoding:'utf8',timeout:30_000,maxBuffer:16*1024*1024,env:{...process.env,GH_PROMPT_DISABLED:'1',GH_PAGER:'cat'}},(error,stdout,stderr)=>resolve({stdout,stderr:error?(stderr||error.message):stderr,code:error?1:0})));}
export function createGhClient(options:{run?:(args:string[])=>Promise<GhResult>}={}):GhClient {
 const run=options.run??execute;return {async call(args){
  // Every exposed operation is read-only. Argument arrays avoid a shell interpretation.
  if(!((args[0]==='pr'&&['list','view','diff'].includes(args[1]??''))||(args[0]==='auth'&&args[1]==='status')||(args[0]==='api'&&!args.some(arg=>['-X','--method','-f','--field','-F','--raw-field','--input'].some(flag=>arg===flag||arg.startsWith(flag+'=')||((flag==='-X'||flag==='-f'||flag==='-F')&&arg.startsWith(flag)))))))throw new GitHubUnavailable('unknown','Unsupported GitHub command');
  try{const result=await run(args[0]==='api'?[...args,'--method','GET']:args);if(result.code!==0)throw new GitHubUnavailable(classify(result.stderr??''),result.stderr||'GitHub request failed');return result.stdout;}
  catch(e:any){if(e instanceof GitHubUnavailable)throw e;throw new GitHubUnavailable(classify(e.message??''),e.message??'GitHub request failed');}
 }};
}
export function parseJson<T>(text:string):T {try{return JSON.parse(text) as T;}catch{throw new GitHubUnavailable('invalid-response','GitHub returned invalid JSON');}}
export function unavailable(error:unknown) {const item=error instanceof GitHubUnavailable?error:new GitHubUnavailable('unknown',error instanceof Error?error.message:String(error));return {status:'unavailable' as const,reason:item.reason,message:item.message,refreshedAt:new Date().toISOString()};}
