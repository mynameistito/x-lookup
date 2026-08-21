import { browse, browseResponse } from './lib/browse.js'
import {
  ConvertError,
  acceptPrefersHtml,
  convertTweet,
  markdownResponse,
} from './lib/converter.js'
import { embedResponse, isEmbedUserAgent, oembedResponse, type OEmbedQuery } from './lib/embed.js'
import { requestOrigin, wantsJson, wantsMarkdown } from './lib/http.js'
import { workerConfig, type RuntimeConfig } from './lib/cache.js'
import type { Env } from './env.js'
import { DOCS_MARKDOWN, ROOT_MARKDOWN } from './docs.js'

const HANDLE = '([A-Za-z0-9_]{1,15})'
const STATUS_ROUTE = new RegExp(`^/${HANDLE}/status/(\\d+)$`)
const LIST_ROUTE = new RegExp(`^/${HANDLE}/(followers|following)$`)
const PROFILE_ROUTE = new RegExp(`^/${HANDLE}$`)

type ApiResponse = { status: number; headers: Record<string, string>; body?: string }

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' },
  })

const apiResponse = (result: ApiResponse): Response => {
  const headers = new Headers(result.headers)
  headers.set('Access-Control-Allow-Origin', '*')
  headers.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS')
  headers.set('Access-Control-Allow-Headers', 'Accept, Content-Type')
  return new Response(result.body ?? null, { status: result.status, headers })
}

const textResponse = (body: string): Response =>
  new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=3600',
    },
  })

const fail = (error: unknown): Response => {
  if (error instanceof ConvertError) return jsonResponse(error.status, { error: error.message, code: error.code })
  console.error(error)
  return jsonResponse(500, { error: 'Internal server error', code: 'internal_error' })
}

const originOf = (request: Request): string =>
  requestOrigin({
    headers: { host: request.headers.get('host') ?? undefined },
    protocol: new URL(request.url).protocol,
  })

async function handleBrowse(query: URLSearchParams, request: Request, config: RuntimeConfig): Promise<Response> {
  const param = (key: string): string | undefined => query.get(key) ?? undefined
  const result = await browse({
    resource: param('resource'),
    handle: param('handle'),
    q: param('q'),
    feed: param('feed'),
    cursor: param('cursor'),
    page: param('page'),
    limit: param('limit'),
    full: param('full'),
    format: param('format'),
    nocache: param('nocache'),
  }, config)
  const response = browseResponse(result, wantsJson(param('format'), request.headers.get('accept') ?? ''))
  return apiResponse(response)
}

async function handleConvert(query: URLSearchParams, request: Request, config: RuntimeConfig): Promise<Response> {
  const param = (key: string): string | undefined => query.get(key) ?? undefined
  const accept = request.headers.get('accept') ?? ''
  const userAgent = request.headers.get('user-agent') ?? ''
  const requestedFormat = param('format')
  const asJson = wantsJson(requestedFormat, accept)
  const asMarkdown = wantsMarkdown(requestedFormat, accept)
  const asEmbed = !requestedFormat && !asJson && !asMarkdown && isEmbedUserAgent(userAgent)
  const asHtml = !requestedFormat && !asJson && !asMarkdown && !asEmbed && acceptPrefersHtml(accept)

  const result = await convertTweet({
    url: param('url'),
    handle: param('handle'),
    id: param('id'),
    format: requestedFormat,
    thread: param('thread'),
    userinfo: param('userinfo'),
    nocache: param('nocache'),
    full: param('full'),
    context: param('context'),
    replies: param('replies'),
  }, config)

  const response = asEmbed
    ? embedResponse(result, { origin: originOf(request), userAgent })
    : markdownResponse(result, asJson, asHtml)
  return apiResponse(response)
}

function handleOEmbed(query: URLSearchParams, request: Request): Response {
  const param = (key: string): string | undefined => query.get(key) ?? undefined
  const oembedQuery: OEmbedQuery = {
    url: param('url'),
    text: param('text'),
    author: param('author'),
    status: param('status'),
    provider: param('provider'),
  }
  return apiResponse(oembedResponse(oembedQuery, originOf(request)))
}

export async function handleRequest(request: Request, env: Env = {}): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Access-Control-Allow-Headers': 'Accept, Content-Type',
      },
    })
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return jsonResponse(405, { error: 'Method not allowed', code: 'method_not_allowed' })
  }

  const url = new URL(request.url)
  const path = url.pathname.replace(/\/+$/, '') || '/'
  const query = url.searchParams
  const config = workerConfig(env)

  try {
    if (path === '/') return textResponse(ROOT_MARKDOWN)
    if (path === '/docs') return textResponse(DOCS_MARKDOWN)
    if (path === '/api/browse') return await handleBrowse(query, request, config)
    if (path === '/api/convert') return await handleConvert(query, request, config)
    if (path === '/oembed') return handleOEmbed(query, request)
    if (path === '/search') {
      query.set('resource', 'search')
      return await handleBrowse(query, request, config)
    }

    const statusMatch = STATUS_ROUTE.exec(path)
    if (statusMatch) {
      query.set('handle', statusMatch[1] ?? '')
      query.set('id', statusMatch[2] ?? '')
      return await handleConvert(query, request, config)
    }

    const listMatch = LIST_ROUTE.exec(path)
    if (listMatch) {
      query.set('resource', listMatch[2] ?? '')
      query.set('handle', listMatch[1] ?? '')
      return await handleBrowse(query, request, config)
    }

    const profileMatch = PROFILE_ROUTE.exec(path)
    if (profileMatch) {
      query.set('resource', 'profile')
      query.set('handle', profileMatch[1] ?? '')
      return await handleBrowse(query, request, config)
    }
  } catch (error) {
    return fail(error)
  }

  return jsonResponse(404, { error: 'Not found.', code: 'not_found' })
}
