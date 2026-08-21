import { describe, expect, test } from 'vitest'
import { DEFAULT_ORIGIN, requestOrigin, wantsJson, wantsMarkdown } from '../lib/http.js'

describe('requestOrigin', () => {
  test('uses the request host for the production and local hosts', () => {
    expect(
      requestOrigin({
        headers: { 'x-forwarded-proto': 'https', host: 'x.mynameistito.com' },
      }),
    ).toBe('https://x.mynameistito.com')
    expect(
      requestOrigin({
        headers: { host: 'localhost:8787' },
        protocol: 'http',
      }),
    ).toBe('http://localhost:8787')
    expect(
      requestOrigin({
        headers: { host: '127.0.0.1:8787' },
        protocol: 'http',
      }),
    ).toBe('http://127.0.0.1:8787')
  })

  test('ignores a forged forwarded host', () => {
    expect(
      requestOrigin({
        headers: { 'x-forwarded-host': 'evil.example', host: 'x.mynameistito.com' },
      }),
    ).toBe('https://x.mynameistito.com')
  })

  test('falls back to the hosted origin for unknown hosts', () => {
    expect(requestOrigin({ headers: {} })).toBe(DEFAULT_ORIGIN)
    expect(requestOrigin({ headers: { host: 'evil.example' } })).toBe(DEFAULT_ORIGIN)
  })
})

describe('wantsMarkdown', () => {
  test('gives an explicit format precedence over Accept', () => {
    expect(wantsMarkdown('json', 'text/markdown')).toBe(false)
    expect(wantsMarkdown('markdown', 'application/json')).toBe(true)
  })

  test('uses Accept when no format is explicit', () => {
    expect(wantsMarkdown(undefined, 'text/markdown')).toBe(true)
    expect(wantsMarkdown(undefined, 'text/html')).toBe(false)
  })
})

describe('wantsJson', () => {
  test('gives an explicit format precedence over Accept', () => {
    expect(wantsJson('markdown', 'application/json')).toBe(false)
    expect(wantsJson('json', 'text/markdown')).toBe(true)
  })

  test('uses Accept when no format is explicit', () => {
    expect(wantsJson(undefined, 'application/json')).toBe(true)
    expect(wantsJson(undefined, 'text/markdown')).toBe(false)
  })
})
