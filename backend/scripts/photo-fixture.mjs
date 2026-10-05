import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
import {realpathSync} from 'node:fs';
const require=createRequire(realpathSync(new URL('../../teacher-admin/node_modules/next/package.json',import.meta.url)));
const sharp=require('sharp');
await mkdir('../test-results',{recursive:true});
for (const page of [1,2]) {
  const lines=Array.from({length:24},(_,i)=>`<text x="160" y="${400+i*130}" font-size="58" fill="#252525">${i+1}. 社区搭建议事平台，听取居民意见，公开落实情况。</text>`).join('');
  const svg=`<svg width="3000" height="4000" xmlns="http://www.w3.org/2000/svg"><rect width="3000" height="4000" fill="white"/><text x="160" y="200" font-size="82">考吧167 作答图片验收 第 ${page} 页</text>${lines}</svg>`;
  await sharp(Buffer.from(svg)).jpeg({quality:95}).toFile(`../test-results/answer-photo-${page}.jpg`);
}
console.log('Two synthetic 12 MP answer sheets prepared.');
