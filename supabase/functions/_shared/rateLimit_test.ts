import assert from 'node:assert/strict'
import { enforceCounter, requestIp } from './rateLimit.ts'

Deno.test('rate counter hashes the identifier and passes only the digest to Postgres', async () => {
  let args: Record<string, unknown> | undefined
  const admin = {
    async rpc(_name: string, input: Record<string, unknown>) {
      args = input
      return { data: 1, error: null }
    },
  }
  await enforceCounter(admin, {
    scope: 'USER',
    value: 'private-user-id',
    limit: 3,
    now: new Date('2026-11-11T17:00:00.000Z'),
  })
  assert.equal(args?.p_scope, 'USER')
  assert.equal(args?.p_limit, 3)
  assert.equal(args?.p_bucket_start, '2026-11-11T00:00:00.000Z')
  assert.match(String(args?.p_key_hash), /^[0-9a-f]{64}$/)
  assert.equal(JSON.stringify(args).includes('private-user-id'), false)
})

Deno.test('rate counter rejects the request after the atomic database limit', async () => {
  const admin = {
    async rpc() {
      return { data: 0, error: null }
    },
  }
  await assert.rejects(
    () => enforceCounter(admin, { scope: 'IP', value: '192.0.2.10', limit: 1 }),
    (error: unknown) => error instanceof Error && error.message.includes('reached today'),
  )
})

Deno.test('rate counter fails closed when its database RPC is unavailable', async () => {
  const admin = {
    async rpc() {
      return { data: null, error: new Error('offline') }
    },
  }
  await assert.rejects(
    () => enforceCounter(admin, { scope: 'USER', value: 'user', limit: 3 }),
    (error: unknown) => error instanceof Error && error.message.includes('Could not check'),
  )
})

Deno.test('request IP prefers the edge-provided client address', () => {
  const request = new Request('https://example.test', {
    headers: { 'cf-connecting-ip': '192.0.2.10', 'x-forwarded-for': '198.51.100.4' },
  })
  assert.equal(requestIp(request), '192.0.2.10')
})
