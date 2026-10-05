import {PrismaClient} from '@prisma/client';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {buildApp} from '../src/app.js';
import {loadConfig} from '../src/config.js';
import {hashPassword,issueSession} from '../src/security.js';
const dir=await mkdtemp(path.resolve('test-mobile-'));
const dbfile=path.join(dir,'mobile.db');
const sqlite=new DatabaseSync(dbfile);
for(const f of ['202610040001_initial','202610040002_kaoba167','202610050001_material_answers']) sqlite.exec(await readFile('prisma/migrations/'+f+'/migration.sql','utf8'));
sqlite.close();
const db=new PrismaClient({datasourceUrl:'file:'+dbfile.replaceAll('\\','/')});
const config={...loadConfig(),production:false,appUrl:'http://localhost:3000',storage:path.join(dir,'storage'),aiProvider:'manual'};
const app=await buildApp({db,config});
const teacher=await db.user.create({data:{role:'ADMIN',name:'验收老师',username:'mobile-teacher',passwordHash:await hashPassword('Mobile-test-2026'),teacher:{create:{}}}});
const student=await db.user.create({data:{role:'STUDENT',name:'手机验收同学',username:'mobile-student',passwordHash:await hashPassword('Mobile-test-2026'),student:{create:{teacherId:teacher.id}}}});
const staff=await issueSession(db,config,teacher.id), learner=await issueSession(db,config,student.id);
async function api(who:any,method:string,url:string,body?:any){const r=await app.inject({method:method as any,url:'/api'+url,payload:body,headers:{authorization:'Bearer '+who.token}});if(r.statusCode!==200)throw Error(r.body);return r.json()}
const ids=[];
for(const [title,rounds] of [['待完成：基层治理与群众参与',0],['我的批改：总结经验并再次训练',1],['已完成：三轮历史成绩与老师批注',3]] as const){
 const q=await api(staff,'POST','/teacher/questions',{title,type:'概括归纳',materials:'<p>社区搭建议事平台，<u>听取居民意见</u>，定期公开方案落实情况。</p><p>为解决居民反映的问题，社区建立问题清单，明确责任人和办理时限，每月邀请居民代表参加议事会。居民既能提出建议，也能了解办理进度。</p><p>把群众的小事当作社区的大事，通过协商推动问题解决，让治理成果惠及更多居民。</p>',prompt:'请概括社区提升基层治理水平的主要做法。',requirements:'全面准确、条理清晰。',wordLimit:300,maxScore:20,rubric:'要点完整，表述规范。',referenceAnswer:'搭建议事平台，拓宽群众参与渠道；公开落实情况，接受群众监督。',scoringPoints:[{label:'群众参与',description:'议事平台汇集民意',points:10},{label:'落实反馈',description:'公开落实情况接受监督',points:10}]});
 ids.push(q.id);
 await api(staff,'POST','/teacher/permissions',{studentIds:[student.id],questionIds:[q.id]});
 for(let round=1;round<=rounds;round++){
  const d=await api(learner,'POST','/student/questions/'+q.id+'/start',{});
  const text='搭建议事平台，听取居民意见，定期公开方案落实情况。';
  const save=await api(learner,'PUT','/student/attempts/'+d.id+'/draft',{text,version:d.version});
  await api(learner,'POST','/student/attempts/'+d.id+'/submit',{version:save.version});
  const review=await api(staff,'PUT','/teacher/submissions/'+d.id+'/review',{version:0,finalScore:12+round*2,summary:'要点较完整，能够结合材料概括。继续用更简洁的语言表达措施。',strengths:'能关注群众参与和落实反馈。',weaknesses:'层次还可更清楚。',nextFocus:'把每条措施写成动宾短语。',annotations:[{startOffset:0,endOffset:6,selectedText:text.slice(0,6),category:'POINT',severity:'LOW',comment:'概括准确',suggestion:'保持这个表达方式'}]});
  await api(staff,'POST','/teacher/submissions/'+d.id+'/publish',{reviewVersion:review.version});
 }
}
await mkdir('../test-results',{recursive:true});
await writeFile('../test-results/mobile-fixture.json',JSON.stringify({dir,questionIds:ids}));
await app.listen({host:'127.0.0.1',port:4000});
console.log('Local disposable mobile fixture ready:',JSON.stringify({questionIds:ids}));
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,async()=>{await app.close();await db.$disconnect();process.exit(0)});
