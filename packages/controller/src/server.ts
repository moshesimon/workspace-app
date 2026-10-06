import {createServer,type Socket} from 'node:net';
import {mkdir,chmod,lstat,readFile,writeFile,unlink,open} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {connectionPaths,PROTOCOL_VERSION} from '../../client/src/paths.js';
import {commands} from '../../contracts/src/commands.js';
import {DomainError,errorRecord} from '../../contracts/src/errors.js';
export function processIdentity(pid:number){try{return execFileSync('/bin/ps',['-p',String(pid),'-o','lstart='],{encoding:'utf8'}).trim()}catch{return null}}
export async function startServer(options:{stateRoot:string;dispatch:(name:string,input:any)=>Promise<unknown>;idle?:()=>boolean;idleMs?:number}){
 const paths=connectionPaths(options.stateRoot);await mkdir(paths.directory,{recursive:true,mode:0o700});const ds=await lstat(paths.directory);if(ds.isSymbolicLink()||(process.getuid&&ds.uid!==process.getuid()))throw new DomainError('OWNERSHIP_UNVERIFIED','IPC directory not owned by current user');await chmod(paths.directory,0o700);
 let lock;try{lock=await open(paths.lock,'wx',0o600)}catch(error:any){if(error.code!=='EEXIST')throw error;let owner;try{owner=JSON.parse(await readFile(paths.lock,'utf8'))}catch{throw new DomainError('CONTROLLER_BUSY','Controller lock is initializing or invalid; do not remove it while a controller may be starting')}
 const identity=processIdentity(owner.pid);if(identity)throw new DomainError('CONTROLLER_BUSY','Controller already running');await unlink(paths.lock);try{await unlink(paths.socket)}catch{};lock=await open(paths.lock,'wx',0o600)}
 await lock.writeFile(JSON.stringify({pid:process.pid,startIdentity:processIdentity(process.pid)}));await lock.close();const sockets=new Set<Socket>();let lastActivity=Date.now();
 const server=createServer(socket=>{sockets.add(socket);let buffer='';socket.setTimeout(35000,()=>socket.destroy());socket.on('close',()=>sockets.delete(socket));socket.on('error',()=>{});socket.on('data',async chunk=>{buffer+=chunk;if(buffer.length>1024*1024){socket.destroy();return}const newline=buffer.indexOf('\n');if(newline<0)return;socket.pause();lastActivity=Date.now();try{const request=JSON.parse(buffer.slice(0,newline));if(request.protocolVersion!==PROTOCOL_VERSION)throw new DomainError('PROTOCOL_MISMATCH','Unsupported controller protocol version');if(!(request.name in commands))throw new DomainError('INVALID_INPUT','Unknown controller command');const result=await options.dispatch(request.name,request.input);socket.end(JSON.stringify({id:request.id,result})+'\n')}catch(error){socket.end(JSON.stringify({error:errorRecord(error)})+'\n')}})});
 try{await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(paths.socket,resolve)});await chmod(paths.socket,0o600)}catch(e){await unlink(paths.lock).catch(()=>{});throw e}
 const close=async()=>{clearInterval(idleTimer);for(const socket of sockets)socket.destroy();await new Promise<void>(r=>server.close(()=>r()));await unlink(paths.socket).catch(()=>{});await unlink(paths.lock).catch(()=>{})};
 const idleTimer=setInterval(()=>{if(options.idle?.()&&sockets.size===0&&Date.now()-lastActivity>(options.idleMs??60000))void close()},5000);idleTimer.unref();
 return {socketPath:paths.socket,close,server};
}
export async function startController(stateRoot:string,options:{executable?:string;skillRoot?:string;codexHome?:string;agentsHome?:string}={}){
 const {Controller}=await import('./controller.js');let controller:any;const server=await startServer({stateRoot,dispatch:(name,input)=>controller.call(name,input),idle:()=>controller?.isIdle??false});controller=new Controller(stateRoot,options);server.server.on('close',()=>controller.close());return {...server,controller};
}
