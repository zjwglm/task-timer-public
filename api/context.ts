import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import type { User } from "@db/schema";
import { authenticateRequest } from "./kimi/auth";
import { verifyLocalToken } from "./local-auth-router";
import { getDb } from "./queries/connection";
import { users } from "@db/schema";
import { eq } from "drizzle-orm";

export type TrpcContext = {
  req: Request;
  resHeaders: Headers;
  user?: User;
};

export async function createContext(
  opts: FetchCreateContextFnOptions,
): Promise<TrpcContext> {
  const ctx: TrpcContext = { req: opts.req, resHeaders: opts.resHeaders };

  // Try OAuth authentication first
  try {
    ctx.user = await authenticateRequest(opts.req.headers);
    return ctx;
  } catch {
    // OAuth not available, try local auth
  }

  // Try local authentication via X-Local-Auth-Token header
  try {
    const authHeader = opts.req.headers.get("X-Local-Auth-Token");
    if (authHeader) {
      const token = authHeader.startsWith("local_")
        ? authHeader.slice(6)
        : authHeader;
      const claim = await verifyLocalToken(token);
      if (claim) {
        const db = getDb();
        const [user] = await db
          .select()
          .from(users)
          .where(eq(users.id, claim.userId))
          .limit(1);
        if (user) {
          ctx.user = user;
        }
      }
    }
  } catch {
    // Local auth not available
  }

  return ctx;
}
