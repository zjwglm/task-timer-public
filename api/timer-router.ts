import { z } from "zod";
import { createRouter, authedQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { timers } from "db/schema";
import { eq } from "drizzle-orm";

export const timerRouter = createRouter({
  get: authedQuery.query(async ({ ctx }) => {
    const db = getDb();
    const userId = ctx.user.id;

    const [timer] = await db
      .select()
      .from(timers)
      .where(eq(timers.userId, userId))
      .limit(1);

    return timer ?? null;
  }),

  create: authedQuery
    .input(z.object({ startTime: z.string().datetime() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const userId = ctx.user.id;

      const [timer] = await db
        .insert(timers)
        .values({
          userId,
          startTime: new Date(input.startTime),
        })
        .$returningId();

      return timer;
    }),
});
