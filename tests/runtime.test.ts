import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startServer} from '../packages/controller/src/server.js';
import {ControllerClient} from '../packages/client/src/connect.js';
test('concurrent clients share a private controller socket and validated protocol',async()=>{const root=await mkdtemp(join(tmpdir(),'wm-ipc-'));const server=await startServer({stateRoot:root,dispatch:async(name)=>{if(name==='controller.status')return {protocolVersion:1,pid:process.pid};throw Error('no')}});try{const clients=Array.from({length:8},()=>new ControllerClient(root));const records=await Promise.all(clients.map(c=>c.call('controller.status',{})));assert.equal(new Set(records.map(r=>r.pid)).size,1);assert.equal((await stat(server.socketPath)).mode&0o777,0o600);await assert.rejects(clients[0].call('unknown',{}));await assert.rejects(startServer({stateRoot:root,dispatch:async()=>({})}),/already running/)}finally{await server.close();await rm(root,{recursive:true,force:true})}});
