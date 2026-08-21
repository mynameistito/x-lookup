import { afterEach, describe, expect, test, vi } from 'vitest'
import { fetchSyndicationStatus } from '../lib/syndication.js'

describe('syndication video mapping', () => {
  afterEach(() => vi.restoreAllMocks())

  test('retains dimensions, duration, best direct URL, and every MP4 variant', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      id_str: '123', text: 'video', user: { screen_name: 'alice' },
      mediaDetails: [{
        type: 'video', media_url_https: 'https://img/thumb.jpg',
        original_info: { width: 1280, height: 720 },
        video_info: { duration_millis: 4500, variants: [
          { url: 'https://video/low.mp4', content_type: 'video/mp4', bitrate: 256000 },
          { url: 'https://video/high.mp4', content_type: 'video/mp4', bitrate: 832000 },
          { url: 'https://video/stream.m3u8', content_type: 'application/x-mpegURL' },
        ] },
      }],
    }), { status: 200 }))

    const tweet = await fetchSyndicationStatus('alice', '123')
    expect(tweet.media?.videos?.[0]).toMatchObject({
      url: 'https://video/high.mp4', thumbnail_url: 'https://img/thumb.jpg',
      width: 1280, height: 720, duration_ms: 4500, bitrate: 832000,
    })
    expect(tweet.media?.videos?.[0]?.variants?.map((variant) => variant.url)).toEqual([
      'https://video/high.mp4', 'https://video/low.mp4',
    ])
  })

  test('uses actual quoted_tweet identity and does not duplicate overlapping media', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      id_str: '123', text: 'container', user: { screen_name: 'alice' },
      mediaDetails: [{ type: 'photo', media_url_https: 'https://img/one.jpg' }],
      photos: [{ type: 'photo', media_url_https: 'https://img/one.jpg' }],
      quoted_tweet: { id_str: '456', text: 'quote', user: { screen_name: 'bob' } },
    }), { status: 200 }))
    const tweet = await fetchSyndicationStatus('alice', '123')
    expect(tweet.media?.photos).toHaveLength(1)
    expect(tweet.quote).toMatchObject({ id: '456', url: 'https://x.com/bob/status/456' })
  })

  test('leaves a quote source absent when its own identity is missing', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      id_str: '123', text: 'container', user: { screen_name: 'alice' },
      quoted_tweet: { text: 'anonymous quote' },
    }), { status: 200 }))
    const tweet = await fetchSyndicationStatus('alice', '123')
    expect(tweet.quote?.url).toBeUndefined()
  })

  test('deduplicates overlapping fallback media projections', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      id_str: '123', text: 'photos', user: { screen_name: 'alice' },
      photos: [{ type: 'photo', media_url_https: 'https://img/one.jpg' }],
      entities: { media: [
        { type: 'photo', media_url_https: 'https://img/one.jpg' },
        { type: 'photo', media_url_https: 'https://img/two.jpg' },
      ] },
    }), { status: 200 }))

    const tweet = await fetchSyndicationStatus('alice', '123')
    expect(tweet.media?.photos?.map((photo) => photo.url)).toEqual([
      'https://img/one.jpg',
      'https://img/two.jpg',
    ])
  })

  test('maps user fields and reports truthful failures', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      id_str: '123', text: 'hi',
      user: {
        name: 'Alice', screen_name: 'alice', description: 'bio',
        followers_count: 10, friends_count: 20, statuses_count: 30,
        profile_image_url_https: 'https://img/avatar.jpg',
        entities: { url: { urls: [{ display_url: 'alice.dev', expanded_url: 'https://alice.dev' }] } },
      },
    }), { status: 200 }))
    const tweet = await fetchSyndicationStatus('alice', '123')
    expect(tweet.author).toMatchObject({
      name: 'Alice', screen_name: 'alice', followers: 10, following: 20, statuses: 30,
      website: { display_url: 'alice.dev' },
    })

    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('down'))
    await expect(fetchSyndicationStatus('alice', '123')).rejects.toMatchObject({ code: 'syndication_network' })

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 404 }))
    await expect(fetchSyndicationStatus('alice', '123')).rejects.toMatchObject({ status: 404 })
  })
})
