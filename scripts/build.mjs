import {build} from 'esbuild';
import {build as viteBuild} from 'vite';
import {mkdir} from 'node:fs/promises';
await mkdir('dist',{recursive:true});
await build({entryPoints:['apps/desktop/src/main.ts'],outfile:'dist/main.cjs',bundle:true,platform:'node',format:'cjs',target:'node22',external:['electron','better-sqlite3'],sourcemap:true,logLevel:'info'});
await build({entryPoints:['apps/desktop/src/preload.ts'],outfile:'dist/preload.cjs',bundle:true,platform:'node',format:'cjs',external:['electron'],logLevel:'info'});
await viteBuild({root:'apps/desktop',base:'./',build:{outDir:'../../dist/renderer',emptyOutDir:true},logLevel:'warn'});
