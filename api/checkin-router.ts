import { z } from "zod";
import { createRouter, authedQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { checkIns } from "../db/schema";
import { eq, desc } from "drizzle-orm";

function formatInterval(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export const checkInRouter = createRouter({
  list: authedQuery.query(async ({ ctx }) => {
    const db = getDb();
    const userId = ctx.user.id;

    const rows = await db
      .select()
      .from(checkIns)
      .where(eq(checkIns.userId, userId))
      .orderBy(desc(checkIns.timestamp));

    return rows;
  }),

  create: authedQuery
    .input(
      z.object({
        timerId: z.number(),
        timestamp: z.string().datetime(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const userId = ctx.user.id;

      // Find the most recent check-in for interval calculation
      const [lastCheckIn] = await db
        .select()
        .from(checkIns)
        .where(eq(checkIns.userId, userId))
        .orderBy(desc(checkIns.timestamp))
        .limit(1);

      const now = new Date(input.timestamp);
      let interval = "00:00:00";

      if (lastCheckIn) {
        const lastTime = new Date(lastCheckIn.timestamp).getTime();
        const nowTime = now.getTime();
        interval = formatInterval(nowTime - lastTime);
      }

      const [checkIn] = await db
        .insert(checkIns)
        .values({
          userId,
          timerId: input.timerId,
          timestamp: now,
          interval,
        })
        .$returningId();

      return { id: checkIn.id, interval };
    }),
});
