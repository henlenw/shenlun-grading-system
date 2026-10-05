import {PrismaClient} from '@prisma/client';
import {loadConfig} from '../src/config.js';
import {purgeExpiredOriginals} from '../src/retention.js';
const db=new PrismaClient();
try{console.log(await purgeExpiredOriginals(db,loadConfig(),process.argv.includes('--apply')))}finally{await db.$disconnect()}
