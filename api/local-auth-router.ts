import { z } from "zod";
import bcrypt from "bcryptjs";
import * as jose from "jose";
import { TRPCError } from "@trpc/server";
import { createRouter, publicQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { users } from "../db/schema";
import { eq } from "drizzle-orm";
import { env } from "./lib/env";

const JWT_ALG = "HS256";
const LOCAL_AUTH_PREFIX = "local_";

async function signLocalToken(payload: { userId: number; username: string }): Promise<string> {
  const secret = new TextEncoder().encode(env.appSecret);
  return new jose.SignJWT({ ...payload, type: "local" })
    .setProtectedHeader({ alg: JWT_ALG })
    .setIssuedAt()
    .setExpirationTime("1 year")
    .sign(secret);
}

async function verifyLocalToken(token: string): Promise<{ userId: number; username: string } | null> {
  try {
    const secret = new TextEncoder().encode(env.appSecret);
    const { payload } = await jose.jwtVerify(token, secret, {
      algorithms: [JWT_ALG],
      clockTolerance: 60,
    });
    if (payload.type !== "local" || !payload.userId || !payload.username) {
      return null;
    }
    return { userId: payload.userId as number, username: payload.username as string };
  } catch {
    return null;
  }
}

export { signLocalToken, verifyLocalToken };

export const localAuthRouter = createRouter({
  register: publicQuery
    .input(
      z.object({
        username: z.string().min(3).max(50).regex(/^[a-zA-Z0-9_]+$/, "Username can only contain letters, numbers, and underscores"),
        password: z.string().min(6).max(100),
        name: z.string().min(1).max(100).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb();

      // Check if username already exists
      const [existing] = await db
        .select()
        .from(users)
        .where(eq(users.username, input.username))
        .limit(1);

      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Username already taken",
        });
      }

      const passwordHash = await bcrypt.hash(input.password, 10);

      const [result] = await db
        .insert(users)
        .values({
          username: input.username,
          passwordHash,
          name: input.name || input.username,
        })
        .$returningId();

      const token = await signLocalToken({
        userId: result.id,
        username: input.username,
      });

      return { token, userId: result.id };
    }),

  login: publicQuery
    .input(
      z.object({
        username: z.string().min(1),
        password: z.string().min(1),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb();

      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.username, input.username))
        .limit(1);

      if (!user || !user.passwordHash) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Invalid username or password",
        });
      }

      const valid = await bcrypt.compare(input.password, user.passwordHash);
      if (!valid) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Invalid username or password",
        });
      }

      // Update last sign in
      await db
        .update(users)
        .set({ lastSignInAt: new Date() })
        .where(eq(users.id, user.id));

      const token = await signLocalToken({
        userId: user.id,
        username: input.username,
      });

      return { token, userId: user.id, name: user.name || input.username };
    }),

  me: publicQuery.query(async ({ ctx }) => {
    const authHeader = ctx.req.headers.get("X-Local-Auth-Token");
    if (!authHeader) {
      return null;
    }

    const token = authHeader.startsWith(LOCAL_AUTH_PREFIX)
      ? authHeader.slice(LOCAL_AUTH_PREFIX.length)
      : authHeader;

    const claim = await verifyLocalToken(token);
    if (!claim) {
      return null;
    }

    const db = getDb();
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, claim.userId))
      .limit(1);

    return user ?? null;
  }),
});
