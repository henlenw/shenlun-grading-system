import {test} from 'node:test';
import assert from 'node:assert/strict';
import {api} from '../../teacher-admin/lib/api.js';
test('网页无正文的退出和人工批改请求不发送空 JSON，保留 CSRF 与有正文请求的 JSON 编码',async()=>{
  const original=globalThis.fetch;
  const requests:any[]=[];
  try {
    globalThis.fetch=async(url,options)=>{
      requests.push({url,...options});
      const headers=options?.headers as Record<string,string>;
      if(headers['Content-Type']==='application/json') assert.ok(options?.body,'Empty JSON is rejected by Fastify');
      return new Response(JSON.stringify(url==='/api/auth/me'?{csrfToken:'fixture-csrf'}:{ok:true}),{status:200,headers:{'Content-Type':'application/json'}});
    };
    await api('/auth/me');
    await api('/teacher/submissions/fixture/manual','POST');
    assert.equal(requests.at(-1).headers['X-CSRF-Token'],'fixture-csrf');
    assert.equal(requests.at(-1).headers['Content-Type'],undefined);
    await api('/student/attempts/fixture/draft','PUT',{text:'答案',version:0});
    assert.deepEqual(JSON.parse(requests.at(-1).body),{text:'答案',version:0});
    await api('/auth/logout','POST');
    assert.equal(requests.at(-1).headers['Content-Type'],undefined);
    assert.equal(requests.at(-1).body,undefined);
  } finally {globalThis.fetch=original;}
});
