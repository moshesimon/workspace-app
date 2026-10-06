import {randomUUID,createHash} from 'node:crypto';
import type {Operation} from '../../../contracts/src/models.js';
import {DomainError,errorRecord} from '../../../contracts/src/errors.js';
import {Store} from '../store.js';
import {Mutex} from './locks.js';
function stable(value:any):string {if(Array.isArray(value))return '['+value.map(stable).join(',')+']';if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stable(value[k])).join(',')+'}';return JSON.stringify(value)}
export class OperationStore {
 private lock=new Mutex();private pending=new Map<string,Promise<void>>();
 constructor(private store:Store){for(const op of store.all<Operation>('operations'))if(op.status==='running'||op.status==='queued'){op.status='failed';op.error={code:'INTERRUPTED',message:'Controller stopped during this operation. Refresh state before retrying with a new key.'};op.updatedAt=new Date().toISOString();store.put('operations',op)}}
 get(id:string){const op=this.store.get<Operation>('operations',id);if(!op)throw new DomainError('INVALID_INPUT','Operation not found');return op}
 run(action:string,input:Record<string,any>,fn:()=>Promise<unknown>):Operation{
 if(!input.idempotencyKey)throw new DomainError('INVALID_INPUT','An idempotencyKey is required');
 const hash=createHash('sha256').update(stable({action,input})).digest('hex');const previous=this.store.all<Operation>('operations').find(o=>o.idempotencyKey===input.idempotencyKey);
 if(previous){if(previous.inputHash!==hash)throw new DomainError('OPERATION_CONFLICT','Idempotency key already used with different input');return previous}
 const now=new Date().toISOString();const op:Operation={id:randomUUID(),idempotencyKey:input.idempotencyKey,inputHash:hash,action,status:'queued',createdAt:now,updatedAt:now,outcomes:[]};this.store.put('operations',op);
 const work=this.lock.run(async()=>{op.status='running';op.updatedAt=new Date().toISOString();this.store.put('operations',op);try{op.result=await fn();op.status=op.result?.partial?'partial':'succeeded';if(op.result?.outcomes)op.outcomes=op.result.outcomes}catch(error){op.status='failed';op.error=errorRecord(error)}finally{op.updatedAt=new Date().toISOString();this.store.put('operations',op);this.pending.delete(op.id)}});
 this.pending.set(op.id,work);return {...op};
 }
 async wait(id:string,timeoutMs=25000){const pending=this.pending.get(id);if(pending)await Promise.race([pending,new Promise<void>(resolve=>{const t=setTimeout(resolve,Math.min(Math.max(timeoutMs,0),25000));t.unref()})]);return this.get(id)}
 get active(){return this.pending.size}
}
