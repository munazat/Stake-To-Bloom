/**
 * templates.ts — the four hard-coded goal templates (blueprint §7.2). These never
 * need the AI, so pact creation and the judge demo work even if Gemini is down.
 * `rule-draft` (Phase 4) only uses the AI to propose a *custom* spec from free text.
 */
import type { RuleSpec } from './schemas.ts'

export interface TemplateOptions {
  threshold?: number
  requiredPasses?: number // 4..7, default 5 (blueprint D3)
}

export function stepsSpec(opts: TemplateOptions = {}): RuleSpec {
  const { threshold = 10_000, requiredPasses = 5 } = opts
  return {
    goalType: 'steps',
    title: `Walk ${threshold.toLocaleString('en-US')} steps`,
    checks: [
      {
        id: 'steps',
        kind: 'numeric',
        comparator: '>=',
        threshold,
        unit: 'steps',
        description: 'A step count for the day at or above the target',
        minConfidence: 0.75,
      },
    ],
    proofKinds: ['screenshot'],
    requiresVisibleDate: true,
    requiresDailyCode: false,
    requiredPasses,
  }
}

export function waterSpec(opts: TemplateOptions = {}): RuleSpec {
  const { threshold = 2_500, requiredPasses = 5 } = opts
  return {
    goalType: 'water',
    title: `Drink ${threshold} ml of water`,
    checks: [
      {
        id: 'water',
        kind: 'numeric',
        comparator: '>=',
        threshold,
        unit: 'ml',
        description: 'Total water intake for the day at or above the target',
        minConfidence: 0.75,
      },
    ],
    proofKinds: ['screenshot'],
    requiresVisibleDate: true,
    requiresDailyCode: false,
    requiredPasses,
  }
}

export function mealSpec(opts: TemplateOptions = {}): RuleSpec {
  const { requiredPasses = 5 } = opts
  return {
    goalType: 'meal',
    title: 'Log a healthy meal',
    checks: [
      {
        id: 'healthy_meal',
        kind: 'boolean',
        description: 'A photo showing a balanced, healthy meal',
        minConfidence: 0.75,
      },
    ],
    proofKinds: ['photo'],
    requiresVisibleDate: false,
    requiresDailyCode: true,
    requiredPasses,
  }
}

export function workoutSpec(opts: TemplateOptions = {}): RuleSpec {
  const { threshold = 30, requiredPasses = 5 } = opts
  return {
    goalType: 'workout',
    title: `Work out for ${threshold} minutes`,
    checks: [
      {
        id: 'minutes',
        kind: 'numeric',
        comparator: '>=',
        threshold,
        unit: 'min',
        description: 'Active workout duration at or above the target',
        minConfidence: 0.75,
      },
    ],
    proofKinds: ['photo'],
    requiresVisibleDate: false,
    requiresDailyCode: true,
    requiredPasses,
  }
}

export const GOAL_TEMPLATES = {
  steps: stepsSpec,
  water: waterSpec,
  meal: mealSpec,
  workout: workoutSpec,
} as const
