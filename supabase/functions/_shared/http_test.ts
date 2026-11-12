import assert from 'node:assert/strict'
import { secretMatches, withCors } from './http.ts'

Deno.test('a browser preflight answers 204 with no body (a body would make the hosted runtime throw a 500)', async () => {
  const handler = withCors(() => new Response('never reached'))
  const res = await handler(new Request('https://x.test/f', { method: 'OPTIONS' }))
  assert.equal(res.status, 204)
  assert.equal(await res.text(), '')
  assert.equal(res.headers.get('access-control-allow-methods'), 'POST, OPTIONS')
})

Deno.test('secretMatches accepts only the exact secret and never an empty one', () => {
  assert.equal(secretMatches('abc123', 'abc123'), true)
  assert.equal(secretMatches('abc12', 'abc123'), false)
  assert.equal(secretMatches('abc1234', 'abc123'), false)
  assert.equal(secretMatches('', ''), false)
})
