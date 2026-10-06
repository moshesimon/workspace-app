import {createConnection} from 'node:net';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {openSync,closeSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {DomainError} from '../../contracts/src/errors.js';
import {connectionPaths,defaultStateRoot,PROTOCOL_VERSION} from './paths.js';
export class ControllerClient{
 constructor(public stateRoot=defaultStateRoot()){}
 call(name:string,input:Record<string,unknown>={}):Promise<any>{return new Promise((resolve,reject)=>{const socket=createConnection(connectionPaths(this.stateRoot).socket);let buffer='';const id=randomUUID();const timer=setTimeout(()=>{socket.destroy();reject(new DomainError('CONTROLLER_TIMEOUT','Controller request timed out. Retry the same operation key.'))},30000);socket.on('connect',()=>socket.write(JSON.stringify({id,protocolVersion:PROTOCOL_VERSION,name,input})+'\n'));socket.on('data',chunk=>{buffer+=chunk;if(buffer.length>8*1024*1024){socket.destroy();return reject(new DomainError('INVALID_RESPONSE','Controller response exceeds limit'))}const line=buffer.indexOf('\n');if(line<0)return;clearTimeout(timer);socket.end();try{const result=JSON.parse(buffer.slice(0,line));if(result.error)reject(new DomainError(result.error.code,result.error.message,result.error.details));else resolve(result.result)}catch(e){reject(e)}});socket.once('error',error=>{clearTimeout(timer);reject(error)});socket.once('close',()=>{clearTimeout(timer);if(!buffer)reject(new DomainError('CONTROLLER_DISCONNECTED','Controller connection closed'))})})}
}
export async function connectOrStart(options:{stateRoot?:string;executable?:string;args?:string[];env?:NodeJS.ProcessEnv}={}){
 const stateRoot=options.stateRoot??defaultStateRoot();const client=new ControllerClient(stateRoot);
 try{const status=await client.call('controller.status');if(status.protocolVersion!==PROTOCOL_VERSION)throw new DomainError('PROTOCOL_MISMATCH','Controller version differs; stop the previous installation first');return client}catch(e){if(e instanceof DomainError&&e.code==='PROTOCOL_MISMATCH')throw e}
 mkdirSync(stateRoot,{recursive:true,mode:0o700});const fd=openSync(join(stateRoot,'controller.log'),'a',0o600);
 const child=spawn(options.executable??process.execPath,options.args??[...process.argv.slice(1,2),'--mode=controller'],{detached:true,stdio:['ignore',fd,fd],env:{...process.env,...options.env,WORKTREE_MANAGER_HOME:stateRoot}});child.unref();closeSync(fd);let spawnError:Error|undefined;child.on('error',e=>{spawnError=e});
 for(let i=0;i<100;i++){if(spawnError)throw spawnError;await new Promise(r=>setTimeout(r,75));try{const status=await client.call('controller.status');if(status.protocolVersion!==PROTOCOL_VERSION)throw new DomainError('PROTOCOL_MISMATCH','Controller protocol mismatch');return client}catch(e){if(e instanceof DomainError&&e.code==='PROTOCOL_MISMATCH')throw e}}
 throw new DomainError('CONTROLLER_UNAVAILABLE',`Cannot connect to controller. Inspect ${join(stateRoot,'controller.log')}`);
}
