import type { Env } from "./env.js";
import { handleRequest } from "./router.js";

export default {
  async fetch(
    request: Request,
    env: Env,
    _ctx: ExecutionContext
  ): Promise<Response> {
    return handleRequest(request, env);
  },
};
