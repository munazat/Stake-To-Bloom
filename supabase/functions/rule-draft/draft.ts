/**
 * draft.ts — ask the model chain for a rule proposal and reduce it to a RuleSpec.
 * Pure of I/O beyond the injected generator, so the failure handling is testable.
 */
import {
  RULE_DRAFT_RESPONSE_SCHEMA,
  RULE_DRAFT_SYSTEM_INSTRUCTION,
  buildRuleDraftPrompt,
  ruleSpecFromDraft,
  type RuleSpec,
} from '../_shared/core/index.ts'
import { runChain, type ChainDeps, type TextGenerateFn } from '../_shared/gemini.ts'

export type DraftOutcome =
  | { kind: 'drafted'; spec: RuleSpec; model: string }
  | { kind: 'not_verifiable' } // the model answered, but nothing provable from an image survived validation
  | { kind: 'unavailable' } // no key, no models, rate limits, timeouts, blocks

export async function draftRuleSpec(
  description: string,
  requiredPasses: number,
  deps: ChainDeps & { generate: TextGenerateFn },
): Promise<DraftOutcome> {
  const request = {
    system: RULE_DRAFT_SYSTEM_INSTRUCTION,
    prompt: buildRuleDraftPrompt(description),
    schema: RULE_DRAFT_RESPONSE_SCHEMA,
  }
  const result = await runChain(
    deps,
    (model) => deps.generate(model, request),
    (raw) => ruleSpecFromDraft(raw, requiredPasses),
  )
  if (result.value && result.model) return { kind: 'drafted', spec: result.value, model: result.model }
  // Output the model produced but we could not turn into a valid spec is the
  // user's problem to rephrase, not an outage.
  return result.outcome === 'invalid_output' ? { kind: 'not_verifiable' } : { kind: 'unavailable' }
}
