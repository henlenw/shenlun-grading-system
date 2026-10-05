import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { OllamaProvider } from '../src/ai.js';
import { loadConfig } from '../src/config.js';
test('AI 按教师得分点逐项评分；遗漏、重复、超额和总分不符均转人工', async () => {
  let points: any[] = [
    {
      pointId: 'p1',
      label: '参与',
      status: 'HIT',
      awarded: 8,
      evidence: '参与',
      reason: '完全命中',
    },
    {
      pointId: 'p2',
      label: '反馈',
      status: 'PARTIAL',
      awarded: 6,
      evidence: '反馈',
      reason: '细节不足',
    },
  ];
  let score = 14,
    received: any;
  const server = createServer(async (req, res) => {
    let raw = '';
    for await (const part of req) raw += part;
    received = JSON.parse(raw);
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        message: {
          content: JSON.stringify({
            estimatedScore: score,
            confidence: 0.7,
            summary: '逐项评分',
            strengths: [],
            weaknesses: [],
            pointsCovered: [],
            pointsMissing: [],
            structureAnalysis: '',
            languageAnalysis: '',
            annotations: [],
            suggestions: [],
            pointAssessments: points,
          }),
        },
      }),
    );
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const provider = new OllamaProvider({
      ...loadConfig(),
      ollamaUrl: 'http://127.0.0.1:' + (server.address() as any).port,
    });
    const input = {
      text: '参与，反馈。',
      question: {
        maxScore: 20,
        referenceAnswer: '教师答案',
        rubric: '教师评分标准',
        teacherInstructions: '具体要求',
        scoringPoints: [
          { id: 'p1', label: '参与', points: 8 },
          { id: 'p2', label: '反馈', points: 12 },
        ],
      },
    };
    const valid = await provider.gradeEssay(input);
    assert.equal(valid.result.estimatedScore, 14);
    assert.equal(JSON.parse(received.messages[1].content).question.referenceAnswer, '教师答案');
    const original = structuredClone(points);
    points = [original[0]];
    await assert.rejects(provider.gradeEssay(input), /得分点/);
    points = [original[0], original[0]];
    await assert.rejects(provider.gradeEssay(input), /得分点/);
    points = [original[0], { ...original[1], awarded: 13 }];
    await assert.rejects(provider.gradeEssay(input), /得分点/);
    points = original;
    score = 17;
    await assert.rejects(provider.gradeEssay(input), /得分点/);
    score = 14;
    points = [original[0], { ...original[1], status: 'MISS' }];
    await assert.rejects(provider.gradeEssay(input), /得分点/);
  } finally {
    server.close();
    await once(server, 'close');
  }
});
