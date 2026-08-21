import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('../lib/cache.js', () => ({
  buildCacheKey: vi.fn(() => 'browse-test'),
  cacheControlHeader: vi.fn(() => 'public, max-age=300'),
  memoryConfig: vi.fn(() => ({ ttlSeconds: 300, stores: [] })),
  withCache: vi.fn(async (_key: string, _nocache: boolean, fn: () => Promise<unknown>) => ({ value: await fn(), status: 'miss' })),
}))

vi.mock('../lib/fxtwitter.js', () => ({
  fetchFxProfile: vi.fn(),
  fetchFxProfileStatuses: vi.fn(),
  fetchFxConnections: vi.fn(),
  searchFxStatuses: vi.fn(),
}))

import { browse, browseResponse, isOriginalPost } from '../lib/browse.js'
import { buildCacheKey } from '../lib/cache.js'
import { ConvertError } from '../lib/errors.js'
import { fetchFxConnections, fetchFxProfile, fetchFxProfileStatuses, searchFxStatuses } from '../lib/fxtwitter.js'

const post = { id: '1', text: 'hello', url: 'https://x.com/ada/status/1', author: { screen_name: 'ada' } }

beforeEach(() => vi.clearAllMocks())

describe('browse', () => {
  test('filters replies and reposts from a profile and includes source links', async () => {
    vi.mocked(fetchFxProfile).mockResolvedValue({ screen_name: 'ada', name: 'Ada' })
    vi.mocked(fetchFxProfileStatuses).mockResolvedValue({
      results: [post, { ...post, id: '2', replying_to: ['bob'] }, { ...post, id: '3', reposted_by: 'bob' }],
      cursor: { bottom: 'next' },
    })
    const result = await browse({ resource: 'profile', handle: 'ada', nocache: true })
    expect(result.posts).toHaveLength(1)
    expect(result.markdown).toContain('[@ada](https://x.com/ada)')
    expect(result.markdown).toContain('[Source](https://x.com/ada/status/1)')
    expect(result.markdown).toContain('/ada?cursor=next')
    expect(result.markdown).toContain('/ada?page=2')
  })

  test('walks cursors sequentially for page=N', async () => {
    vi.mocked(searchFxStatuses)
      .mockResolvedValueOnce({ results: [], cursor: { bottom: 'page-2' } })
      .mockResolvedValueOnce({ results: [post], cursor: { bottom: 'page-3' } })
    const result = await browse({ resource: 'search', q: 'hello world', page: 2, nocache: true })
    expect(searchFxStatuses).toHaveBeenNthCalledWith(2, 'hello world', 'latest', 'page-2', 20)
    expect(result.markdown).toContain('/search?q=hello+world&feed=latest&cursor=page-3')
    expect(result.markdown).toContain('/search?q=hello+world&feed=latest&page=3')
  })

  test.each([
    { full: 'false', expected: false },
    { full: 'true', expected: true },
  ])('parses full=$full when building both continuation links', async ({ full, expected }) => {
    vi.mocked(searchFxStatuses).mockResolvedValue({ results: [post], cursor: { bottom: 'next' } })
    const result = await browse({ resource: 'search', q: 'x-lookup', full, limit: 7, page: 3, nocache: true })
    expect(result.markdown.includes('full=true')).toBe(expected)
    expect(result.markdown).toContain('limit=7')
    expect(result.markdown).toContain('cursor=next')
    expect(result.markdown).toContain('page=4')
  })

  test('dispatches following and caps the local limit', async () => {
    vi.mocked(fetchFxConnections).mockResolvedValue({ results: [{ screen_name: 'bob' }] })
    const result = await browse({ resource: 'following', handle: 'ada', limit: 999, nocache: true })
    expect(fetchFxConnections).toHaveBeenCalledWith('ada', 'following', undefined, 50)
    expect(result.users?.[0]?.screen_name).toBe('bob')
  })

  test('propagates upstream search refusals as search_unavailable', async () => {
    vi.mocked(searchFxStatuses).mockRejectedValue(
      new ConvertError(502, 'X search is unavailable upstream.', 'search_unavailable'),
    )
    await expect(browse({ resource: 'search', q: 'cloudflare', nocache: true }))
      .rejects.toMatchObject({ status: 502, code: 'search_unavailable' })
  })

  test('produces structured JSON with response metadata', async () => {
    vi.mocked(searchFxStatuses).mockResolvedValue({ results: [post] })
    const result = await browse({ resource: 'search', q: 'x-lookup', full: true, nocache: true })
    const response = browseResponse(result, true)
    expect(response.headers['Content-Type']).toContain('application/json')
    expect(response.headers).toMatchObject({
      Vary: 'Accept',
      'Cache-Control': 'public, max-age=300',
    })
    expect(response.headers['X-Source']).toBe('fxtwitter')
    expect(response.headers['X-Result-Count']).toBe('1')
    expect(JSON.parse(response.body)).toMatchObject({ resource: 'search', query: 'x-lookup' })
    expect(result.markdown).toContain('0 likes')
  })

  test('rejects Obsidian output on browse resources', async () => {
    await expect(browse({ resource: 'profile', handle: 'ada', format: 'obsidian' }))
      .rejects.toBeInstanceOf(ConvertError)
  })

  test('includes output format in the cache identity', async () => {
    vi.mocked(searchFxStatuses).mockResolvedValue({ results: [post] })
    await browse({ resource: 'search', q: 'x-lookup', format: 'json' })
    expect(vi.mocked(buildCacheKey)).toHaveBeenCalledWith(
      expect.objectContaining({ format: 'json', v: 2 }),
    )
  })
})

test('provider filtering identifies replies and reposts', () => {
  expect(isOriginalPost(post)).toBe(true)
  expect(isOriginalPost({ ...post, replying_to_status: ['9'] })).toBe(false)
  expect(isOriginalPost({ ...post, reposted_by: { screen_name: 'bob' } })).toBe(false)
})
