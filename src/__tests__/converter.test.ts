import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('../lib/cache.js', () => ({
  buildCacheKey: vi.fn((args: Record<string, unknown>) => JSON.stringify(args)),
  cacheControlHeader: vi.fn(() => 'public, max-age=300'),
  memoryConfig: vi.fn(() => ({ ttlSeconds: 300, stores: [] })),
  withCache: vi.fn(async (_key: string, _nocache: boolean, fn: () => Promise<unknown>) => ({
    value: await fn(),
    status: 'miss',
  })),
}))

vi.mock('../lib/tweet-fetch.js', () => ({
  fetchPosts: vi.fn(async () => ({
    tweets: [{ id: '1', text: 'hello' }],
    source: 'fxtwitter',
  })),
}))

vi.mock('../lib/markdown.js', () => ({
  renderThreadMarkdown: vi.fn(() => '# hello'),
}))

import { convertTweet, markdownResponse } from '../lib/converter.js'
import { ConvertError } from '../lib/errors.js'
import { buildCacheKey } from '../lib/cache.js'
import { renderThreadMarkdown } from '../lib/markdown.js'
import { fetchPosts } from '../lib/tweet-fetch.js'

describe('output selection', () => {
  const validUrl = 'https://x.com/testuser/status/1234567890'

  test('defaults to compact and full=true restores rich rendering', async () => {
    await convertTweet({ url: validUrl })
    expect(vi.mocked(renderThreadMarkdown)).toHaveBeenLastCalledWith(expect.any(Array), expect.objectContaining({ compact: true }))
    await convertTweet({ url: validUrl, full: 'true' })
    expect(vi.mocked(renderThreadMarkdown)).toHaveBeenLastCalledWith(expect.any(Array), expect.objectContaining({ compact: false }))
  })

  test('format=json is accepted and JSON contains structured posts and metadata', async () => {
    const result = await convertTweet({ url: validUrl, format: 'json' })
    const response = markdownResponse(result, true)
    const payload = JSON.parse(response.body) as { posts: Array<{ id?: string; url?: string }>; source: string; markdown: string }
    expect(response.headers['Content-Type']).toContain('application/json')
    expect(payload.posts[0]).toMatchObject({ id: '1' })
    expect(payload.posts[0]?.url).toBe(validUrl)
    expect(payload.source).toBe('fxtwitter')
    expect(payload.markdown).toBe('# hello')
  })

  test('varies negotiated responses by Accept and sets shared caching headers', async () => {
    const result = await convertTweet({ url: validUrl })
    const response = markdownResponse(result)
    expect(response.headers).toMatchObject({
      Vary: 'Accept, User-Agent',
      'Cache-Control': 'public, max-age=300',
      'X-Converter': 'x-lookup',
    })
  })

  test('retains relation annotations and synthesizes reply source URLs', async () => {
    vi.mocked(fetchPosts).mockResolvedValueOnce({
      tweets: [{ id: '99', text: 'reply', context: 'reply', author: { screen_name: 'bob' } }],
      source: 'fxtwitter',
    })
    const result = await convertTweet({ url: validUrl, format: 'json' })
    expect(result.posts[0]).toMatchObject({
      id: '99', context: 'reply', url: 'https://x.com/bob/status/99',
    })
  })

  test('validates context and replies query values', async () => {
    await expect(convertTweet({ url: validUrl, context: 'bad' })).rejects.toMatchObject({ code: 'invalid_context' })
    await expect(convertTweet({ url: validUrl, replies: 'bad' })).rejects.toMatchObject({ code: 'invalid_replies' })
  })

  test('rejects unsupported input hosts and malformed paths', async () => {
    await expect(convertTweet({ url: 'https://example.com/a/status/1' })).rejects.toMatchObject({ code: 'unsupported_host' })
    await expect(convertTweet({ url: 'https://x.com/ada/followers' })).rejects.toMatchObject({ code: 'invalid_path' })
    await expect(convertTweet({})).rejects.toMatchObject({ code: 'missing_url' })
  })

  test('accepts the production host and workers.dev previews as input URLs', async () => {
    await expect(convertTweet({ url: 'https://x.mynameistito.com/ada/status/5' })).resolves.toBeDefined()
    await expect(convertTweet({ url: 'https://x-lookup.someone.workers.dev/ada/status/5' })).resolves.toBeDefined()
  })
})

describe('parseThread — invalid values throw ConvertError', () => {
  const validUrl = 'https://x.com/testuser/status/1234567890'

  test.each(['1', '101', '0', '-1', 'abc', 'invalid_mode', '200'])(
    'throws for thread=%s',
    async (thread) => {
      await expect(convertTweet({ url: validUrl, thread })).rejects.toBeInstanceOf(ConvertError)
    },
  )

  test('error message includes "conversation", code is invalid_thread, status is 400', async () => {
    let err: unknown
    try {
      await convertTweet({ url: validUrl, thread: 'bad' })
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(ConvertError)
    expect((err as ConvertError).message).toContain('conversation')
    expect((err as ConvertError).code).toBe('invalid_thread')
    expect((err as ConvertError).status).toBe(400)
  })
})

describe('parseThread — valid values accepted', () => {
  const validUrl = 'https://x.com/testuser/status/1234567890'

  beforeEach(() => {
    vi.clearAllMocks()
  })

  test.each([null, undefined, 'full', 'conversation', 'off', '2', '100', '50'] as const)(
    'thread=%s resolves without error',
    async (thread) => {
      await expect(convertTweet({ url: validUrl, thread })).resolves.toBeDefined()
    },
  )
})

describe('canonicalThreadCacheValue — cache key normalisation', () => {
  const validUrl = 'https://x.com/testuser/status/1234567890'
  const mockedBuildCacheKey = vi.mocked(buildCacheKey)

  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('null, "full", and "conversation" all normalize to thread="full"', async () => {
    await convertTweet({ url: validUrl, thread: null })
    expect(mockedBuildCacheKey).toHaveBeenCalledWith(expect.objectContaining({ thread: 'full' }))

    vi.clearAllMocks()
    await convertTweet({ url: validUrl, thread: 'conversation' })
    expect(mockedBuildCacheKey).toHaveBeenCalledWith(expect.objectContaining({ thread: 'full' }))
    const calls = mockedBuildCacheKey.mock.calls
    expect(calls.every((args) => (args[0] as { thread: string }).thread !== 'conversation')).toBe(true)
  })

  test('thread="off" stays as "off" in the cache key', async () => {
    await convertTweet({ url: validUrl, thread: 'off' })
    expect(mockedBuildCacheKey).toHaveBeenCalledWith(expect.objectContaining({ thread: 'off' }))
  })

  test('numeric limits preserve focal post and choose context by role before display ordering', async () => {
    vi.mocked(fetchPosts).mockResolvedValueOnce({ tweets: [
      { id: '1', context: 'parent' }, { id: '2', context: 'parent' },
      { id: '3', context: 'post' }, { id: '4', context: 'thread' },
      { id: '5', context: 'reply' },
    ], source: 'fxtwitter' })
    const result = await convertTweet({ url: 'https://x.com/TestUser/status/3', thread: '2', format: 'json' })
    expect(result.posts.map((post) => post.id)).toEqual(['2', '3'])
    expect(vi.mocked(buildCacheKey)).toHaveBeenLastCalledWith(expect.objectContaining({ handle: 'testuser' }))
  })
})
