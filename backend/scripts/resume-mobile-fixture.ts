// Resume only the explicitly named disposable UI fixture after a tool restart.
import {readFile,realpath} from 'node:fs/promises';
import path from 'node:path';
import {PrismaClient} from '@prisma/client';
import {buildApp} from '../src/app.js';
import {loadConfig} from '../src/config.js';
const fixture=JSON.parse(await readFile('../test-results/mobile-fixture.json','utf8'));
const dir=await realpath(fixture.dir), root=await realpath(process.cwd());
if(path.dirname(dir)!==root || !/^test-mobile-[a-zA-Z0-9]+$/.test(path.basename(dir)))throw Error('Expected disposable fixture');
const db=new PrismaClient({datasourceUrl:'file:'+path.join(dir,'mobile.db').replaceAll('\\','/')});
const config={...loadConfig(),production:false,appUrl:'http://localhost:3000',storage:path.join(dir,'storage'),aiProvider:'manual'};
const app=await buildApp({db,config});
await app.listen({host:'127.0.0.1',port:4000});
console.log('Resumed disposable UI fixture.');
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,async()=>{await app.close();await db.$disconnect();process.exit(0)});
