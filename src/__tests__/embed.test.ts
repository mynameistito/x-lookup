import { describe, expect, test } from 'vitest'
import type { ConvertSuccess } from '../lib/converter.js'
import {
  buildEmbedHtml,
  embedDescription,
  embedResponse,
  formatCount,
  isEmbedUserAgent,
  oembedPayload,
  oembedResponse,
  pickFocalTweet,
  socialProof,
  supportsNativeMultiImage,
} from '../lib/embed.js'
import type { FxTweet } from '../lib/fxtwitter.js'

const photoTweet: FxTweet = {
  id: '2087920734702022870',
  url: 'https://x.com/nthglsn/status/2087920734702022870',
  text: '> X offers to sell the @claw handle\n\nWhat should I do?',
  likes: 469,
  retweets: 14,
  replies: 38,
  views: 78400,
  lang: 'en',
  author: {
    name: 'Nathan',
    screen_name: 'nthglsn',
    avatar_url: 'https://pbs.twimg.com/profile.jpg',
  },
  media: {
    photos: [
      { type: 'photo', url: 'https://pbs.twimg.com/one.jpg', width: 1226, height: 576, alt: 'deal screenshot' },
      { type: 'photo', url: 'https://pbs.twimg.com/two.jpg', width: 1324, height: 524 },
    ],
    mosaic: {
      type: 'mosaic_photo',
      formats: { jpeg: 'https://mosaic.fxtwitter.com/jpeg/one/two' },
    },
  },
}

const quoted: FxTweet = {
  id: '1',
  text: 'hello <world> & "friends"',
  author: { name: 'Ada', screen_name: 'ada' },
  quote: {
    id: '2',
    text: 'quoted line',
    author: { name: 'Grace', screen_name: 'hopper' },
  },
}

describe('embed user agents', () => {
  test('recognizes Discord, Telegram, and Slack preview bots', () => {
    expect(isEmbedUserAgent('Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)')).toBe(true)
    expect(isEmbedUserAgent('TelegramBot (like TwitterBot)')).toBe(true)
    expect(isEmbedUserAgent('Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)')).toBe(true)
    expect(isEmbedUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:92.0) Gecko/20100101 Firefox/92.0')).toBe(false)
    expect(isEmbedUserAgent('curl/8.7.1')).toBe(false)
  })

  test('only Discord-like UAs get native multi-image tags', () => {
    expect(supportsNativeMultiImage('Discordbot/2.0')).toBe(true)
    expect(supportsNativeMultiImage('TelegramBot')).toBe(false)
  })
})

describe('counts and description', () => {
  test('formats compact social-proof counts', () => {
    expect(formatCount(38)).toBe('38')
    expect(formatCount(78400)).toBe('78.4K')
    expect(formatCount(999_999)).toBe('1.00M')
    expect(formatCount(1_250_000)).toBe('1.25M')
    expect(socialProof(photoTweet)).toBe('💬 38   🔁 14   ❤️ 469   👁️ 78.4K')
  })

  test('appends quote attribution and poll bars', () => {
    const withPoll: FxTweet = {
      ...quoted,
      poll: {
        choices: [
          { label: 'Yes', percentage: 75 },
          { label: 'No', percentage: 25 },
        ],
        total_votes: 12,
        time_left_en: 'Final results',
      },
    }
    const text = embedDescription(withPoll)
    expect(text).toContain('hello <world> & "friends"')
    expect(text).toContain('Quoting Grace (@hopper)')
    expect(text).toContain('quoted line')
    expect(text).toContain('Yes\u2000\u2000(75%)')
    expect(text).toContain('12 votes · Final results')
  })

  test('picks the requested post from a conversation', () => {
    const posts: FxTweet[] = [
      { id: '1', context: 'parent' },
      { id: '2', context: 'post' },
      { id: '3', context: 'reply' },
    ]
    expect(pickFocalTweet(posts, '2')?.id).toBe('2')
    expect(pickFocalTweet(posts)?.id).toBe('2')
  })
})

describe('embed HTML', () => {
  test('Discord gets repeated og:image tags and oEmbed discovery on the request origin', () => {
    const html = buildEmbedHtml(photoTweet, {
      origin: 'https://x.mynameistito.com',
      userAgent: 'Discordbot/2.0',
    })
    expect(html).toContain('og:title" content="Nathan (@nthglsn)"')
    expect(html).toContain('og:description" content="&gt; X offers to sell the @claw handle')
    expect(html).toContain('twitter:card" content="summary_large_image"')
    expect(html).toContain('og:image" content="https://pbs.twimg.com/one.jpg"')
    expect(html).toContain('og:image" content="https://pbs.twimg.com/two.jpg"')
    expect(html).toContain('og:site_name" content="x-lookup"')
    expect(html).toContain('rel="alternate" type="application/json+oembed" href="https://x.mynameistito.com/oembed?url=')
  })

  test('non-Discord UAs fall back to the mosaic for multi-photo posts', () => {
    const html = buildEmbedHtml(photoTweet, {
      origin: 'https://x.mynameistito.com',
      userAgent: 'TelegramBot (like TwitterBot)',
    })
    expect(html.match(/og:image/g)).toHaveLength(1)
    expect(html).toContain('https://mosaic.fxtwitter.com/jpeg/one/two')
  })

  test('video posts advertise a player card with stream metadata', () => {
    const videoTweet: FxTweet = {
      id: '10',
      url: 'https://x.com/ada/status/10',
      text: 'clip',
      author: { name: 'Ada', screen_name: 'ada' },
      media: {
        videos: [{
          type: 'video',
          url: 'https://video/high.mp4',
          thumbnail_url: 'https://img/thumb.jpg',
          width: 1280,
          height: 720,
          bitrate: 832000,
          format: 'video/mp4',
          variants: [{ url: 'https://video/high.mp4', content_type: 'video/mp4', bitrate: 832000 }],
        }],
      },
    }
    const html = buildEmbedHtml(videoTweet, { origin: 'https://x.mynameistito.com', userAgent: 'TelegramBot' })
    expect(html).toContain('twitter:card" content="player"')
    expect(html).toContain('twitter:player:stream" content="https://video/high.mp4"')
    expect(html).toContain('og:video:type" content="video/mp4"')
    expect(html).toContain('og:image" content="https://img/thumb.jpg"')
  })

  test('escapes HTML-sensitive characters in titles and descriptions', () => {
    const html = buildEmbedHtml(quoted, { origin: 'https://x.mynameistito.com' })
    expect(html).toContain('og:description" content="hello &lt;world&gt; &amp; &quot;friends&quot;\nQuoting Grace (@hopper)')
    expect(html).toContain('og:title" content="Ada (@ada)"')
  })
})

describe('embed and oembed responses', () => {
  const success: ConvertSuccess = {
    body: '',
    warnings: [],
    canonicalUrl: 'https://x.com/nthglsn/status/2087920734702022870',
    format: 'markdown',
    postCount: 1,
    source: 'fxtwitter',
    cache: 'hit',
    posts: [photoTweet],
    compact: true,
  }

  test('embed responses carry embed headers and cache status', () => {
    const response = embedResponse(success, { origin: 'https://x.mynameistito.com', userAgent: 'Discordbot/2.0' })
    expect(response.status).toBe(200)
    expect(response.headers).toMatchObject({
      'Content-Type': 'text/html; charset=utf-8',
      'X-Embed': '1',
      'X-Converter': 'x-lookup',
      'X-Cache': 'HIT',
    })
  })

  test('embed responses 404 when no focal post exists', () => {
    const response = embedResponse({ ...success, posts: [] }, { origin: 'https://x.mynameistito.com' })
    expect(response.status).toBe(404)
    expect(JSON.parse(response.body)).toMatchObject({ code: 'not_found' })
  })

  test('oembed payloads derive identity from the URL and allow overrides', () => {
    const payload = oembedPayload({ url: 'https://x.com/ada/status/123' }, 'https://x.mynameistito.com')
    expect(payload).toMatchObject({
      author_url: 'https://x.com/ada/status/123',
      provider_name: 'x-lookup',
      provider_url: 'https://x.mynameistito.com',
      type: 'link',
      version: '1.0',
    })

    const overridden = oembedPayload({
      url: 'https://x.com/ada/status/123',
      text: '💬 12   ❤️ 40',
      provider: '💬 12   ❤️ 40',
      author: 'grace',
      status: '999',
    }, 'https://x.mynameistito.com')
    expect(overridden).toMatchObject({
      author_name: '💬 12   ❤️ 40',
      provider_name: '💬 12   ❤️ 40',
      provider_url: 'https://x.com/ada/status/123',
      type: 'rich',
    })
  })

  test('oembed responses are cacheable JSON with open CORS', () => {
    const response = oembedResponse({ url: 'https://x.com/ada/status/123' }, 'https://x.mynameistito.com')
    expect(response.status).toBe(200)
    expect(response.headers['Content-Type']).toContain('application/json')
    expect(response.headers['Access-Control-Allow-Origin']).toBe('*')
    expect(response.headers['Cache-Control']).toContain('max-age=3600')
    expect(JSON.parse(response.body)).toMatchObject({ author_url: 'https://x.com/ada/status/123' })
  })
})
