import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { root, type Config } from './config.js';
import { aiSchema, validOffsets } from './schemas.js';
import { requireLocalInference } from './local-inference.js';
export type EssayGradingInput = { text: string; question: Record<string, unknown> };
export type AIGradingResult = z.infer<typeof aiSchema>;
export interface AIProvider {
  gradeEssay(input: EssayGradingInput): Promise<{ result: AIGradingResult; raw: string }>;
  analyzeEssay(input: EssayGradingInput): Promise<AIGradingResult>;
  generateMaterial(input: {
    topic: string;
    sourceSummary: string;
  }): Promise<{ title: string; summary: string; status: 'DRAFT' }>;
}
export class OllamaProvider implements AIProvider {
  constructor(private c: Config) {}
  private async request(system: string, input: unknown, schema: unknown) {
    requireLocalInference(this.c.ollamaUrl);
    const res = await fetch(`${this.c.ollamaUrl.replace(/\/$/, '')}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: AbortSignal.timeout(120000),
      redirect: 'error',
      body: JSON.stringify({
        model: this.c.ollamaModel,
        stream: false,
        think: false,
        format: schema,
        options: { temperature: 0, num_predict: 6000 },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: JSON.stringify(input) },
        ],
      }),
    });
    if (!res.ok) throw Error(`本地模型响应 ${res.status}`);
    const raw = await res.text();
    if (raw.length > 1000000) throw Error('模型输出过大');
    const envelope = JSON.parse(raw);
    if (typeof envelope.message?.content !== 'string') throw Error('模型响应缺少内容');
    return { data: JSON.parse(envelope.message.content), raw };
  }
  async gradeEssay(input: EssayGradingInput) {
    const promptDir = path.join(root, 'prompts', 'essay-grading');
    const system = await readFile(path.join(promptDir, 'system.txt'), 'utf8');
    const task = await readFile(path.join(promptDir, 'task.txt'), 'utf8');
    const schema = JSON.parse(await readFile(path.join(promptDir, 'output-schema.json'), 'utf8'));
    const response = await this.request(system, { task, ...input }, schema);
    const result = validateAIResult(input, response.data);
    return { result, raw: response.raw };
  }
  async analyzeEssay(input: EssayGradingInput) {
    return (await this.gradeEssay(input)).result;
  }
  async generateMaterial(input: { topic: string; sourceSummary: string }) {
    const schema = z.object({ title: z.string().max(200), summary: z.string().max(8000) });
    const { data } = await this.request(
      '只根据提供的来源摘要整理申论素材，不编造事实和政策，不复制全文。结果仅为教师待审草稿。',
      input,
      z.toJSONSchema(schema),
    );
    return { ...schema.parse(data), status: 'DRAFT' as const };
  }
}

export class ManualProvider implements AIProvider {
  constructor(private reason = '本地 AI 暂不可用，可直接人工批改') {}
  async gradeEssay(_input: EssayGradingInput): Promise<{ result: AIGradingResult; raw: string }> {
    throw Error(this.reason);
  }
  async analyzeEssay(_input: EssayGradingInput): Promise<AIGradingResult> {
    throw Error(this.reason);
  }
  async generateMaterial(_input: {
    topic: string;
    sourceSummary: string;
  }): Promise<{ title: string; summary: string; status: 'DRAFT' }> {
    throw Error(this.reason);
  }
}
export function createAIProvider(c: Config): AIProvider {
  return c.aiProvider === 'ollama'
    ? new OllamaProvider(c)
    : new ManualProvider(
        c.aiProvider === 'remote'
          ? '远程 AI 接口尚未配置，可直接人工批改'
          : '人工批改模式，等待教师批改',
      );
}

export function validateAIResult(input: EssayGradingInput, data: unknown) {
  const result = aiSchema.parse(data);
  const points = (input.question.scoringPoints || []) as any[];
  if (points.length) {
    const assessed = result.pointAssessments;
    if (
      assessed.length !== points.length ||
      new Set(assessed.map((p) => p.pointId)).size !== points.length ||
      assessed.some((a) => {
        const p = points.find((p) => p.id === a.pointId);
        return (
          !p ||
          a.label !== p.label ||
          a.awarded > p.points ||
          (a.status === 'MISS' && a.awarded !== 0) ||
          (a.status === 'HIT' && a.awarded !== p.points) ||
          (a.status === 'PARTIAL' && (a.awarded <= 0 || a.awarded >= p.points))
        );
      }) ||
      Math.abs(assessed.reduce((s, p) => s + p.awarded, 0) - result.estimatedScore) > 0.01
    )
      throw Error('AI 得分点与教师设定不一致，请人工复核');
  }
  if (
    result.estimatedScore > Number(input.question.maxScore) ||
    !validOffsets(result.annotations, input.text)
  )
    throw Error('AI 分数或批注位置无效，需教师手动处理');
  return result;
}
