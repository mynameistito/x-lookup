import { handleRequest } from './router.js'
import type { Env } from './env.js'

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    return handleRequest(request, env)
  },
}
