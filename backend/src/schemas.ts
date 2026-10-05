import { z } from 'zod';
export const categories = [
  'CONTENT',
  'POINT',
  'LOGIC',
  'STRUCTURE',
  'LANGUAGE',
  'WORDING',
  'MATERIAL',
  'ARGUMENT',
  'POLICY',
  'TASK_REQUIREMENT',
  'OTHER',
] as const;
export const annotationSchema = z.object({
  startOffset: z.number().int().nonnegative(),
  endOffset: z.number().int().positive(),
  selectedText: z.string().min(1).max(30000),
  category: z.enum(categories),
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH']),
  comment: z.string().min(1).max(2000),
  suggestion: z.string().max(2000).default(''),
});
export const pageAnnotationSchema = z
  .object({
    id: z.string().min(1).max(100),
    fileId: z.string().min(1).max(100),
    page: z.number().int().min(1).max(100),
    type: z.enum([
      'check',
      'cross',
      'circle',
      'rectangle',
      'underline',
      'strike',
      'arrow',
      'highlight',
      'text',
      'comment',
    ]),
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().min(0).max(1),
    height: z.number().min(0).max(1),
    endX: z.number().min(0).max(1).optional(),
    endY: z.number().min(0).max(1).optional(),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    content: z.string().max(2000).default(''),
    author: z.string().max(100).optional(),
    createdAt: z.string().max(40).optional(),
  })
  .refine((a) => a.x + a.width <= 1.00001 && a.y + a.height <= 1.00001, '批注超出页面边界');
export const reviewSchema = z.object({
  version: z.number().int().nonnegative(),
  finalScore: z.number().min(0),
  summary: z.string().trim().min(1).max(8000),
  strengths: z.string().max(5000).default(''),
  weaknesses: z.string().max(5000).default(''),
  nextFocus: z.string().max(5000).default(''),
  recommendedResources: z.string().max(5000).default(''),
  internalNote: z.string().max(5000).default(''),
  annotations: z.array(annotationSchema).max(100),
  pageAnnotations: z.array(pageAnnotationSchema).max(500).default([]),
});
export const scoringPointSchema = z.object({
  label: z.string().trim().min(1).max(200),
  description: z.string().max(2000).default(''),
  points: z.number().positive().max(1000),
});
export const questionSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    type: z.string().trim().min(1).max(50),
    year: z.number().int().min(1900).max(2200).optional(),
    region: z.string().max(100).default(''),
    examType: z.string().max(100).default(''),
    materials: z.string().max(50000),
    prompt: z.string().trim().min(1).max(5000),
    requirements: z.string().max(2000),
    wordLimit: z.number().int().min(1).max(30000),
    maxScore: z.number().int().min(1).max(1000),
    rubric: z.string().max(10000),
    referenceAnswer: z.string().max(20000).default(''),
    internalNote: z.string().max(5000).default(''),
    category: z.enum(['国考', '省考', '专项训练', '大作文', '自定义试卷']).default('专项训练'),
    teacherInstructions: z.string().max(5000).default(''),
    aiInstructions: z.string().max(5000).default(''),
    allowReference: z.boolean().default(true),
    autoUnlockReference: z.boolean().default(true),
    scoringPoints: z.array(scoringPointSchema).max(100).default([]),
  })
  .refine(
    (q) =>
      !q.scoringPoints.length ||
      Math.abs(q.scoringPoints.reduce((s, p) => s + p.points, 0) - q.maxScore) < 0.001,
    { path: ['scoringPoints'], message: '各得分点分值之和必须等于满分' },
  );
export const aiSchema = z.object({
  estimatedScore: z.number().min(0),
  confidence: z.number().min(0).max(1),
  summary: z.string().max(8000),
  strengths: z.array(z.string().max(2000)).max(40),
  weaknesses: z.array(z.string().max(2000)).max(40),
  pointsCovered: z.array(z.string().max(2000)).max(40),
  pointsMissing: z.array(z.string().max(2000)).max(40),
  structureAnalysis: z.string().max(8000),
  languageAnalysis: z.string().max(8000),
  annotations: z.array(annotationSchema).max(100),
  suggestions: z.array(z.string().max(2000)).max(40),
  pointAssessments: z
    .array(
      z.object({
        pointId: z.string(),
        label: z.string(),
        status: z.enum(['HIT', 'PARTIAL', 'MISS']),
        awarded: z.number().nonnegative(),
        evidence: z.string().max(2000),
        reason: z.string().max(2000),
      }),
    )
    .max(100)
    .default([]),
});
export type Annotation = z.infer<typeof annotationSchema>;
export function validOffsets(annotations: Annotation[], text: string) {
  return annotations.every(
    (a) =>
      a.endOffset > a.startOffset &&
      a.endOffset <= text.length &&
      text.slice(a.startOffset, a.endOffset) === a.selectedText,
  );
}
export function publicQuestion(raw: string) {
  const q = JSON.parse(raw);
  return {
    title: q.title,
    type: q.type,
    materials: q.materials,
    prompt: q.prompt,
    requirements: q.requirements,
    wordLimit: q.wordLimit,
    maxScore: q.maxScore,
    year: q.year,
    region: q.region,
    examType: q.examType,
    category: q.category || '专项训练',
  };
}
export const idParam = z.object({ id: z.string().min(1).max(100) });
