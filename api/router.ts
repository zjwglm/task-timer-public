import { authRouter } from "./auth-router";
import { localAuthRouter } from "./local-auth-router";
import { timerRouter } from "./timer-router";
import { checkInRouter } from "./checkin-router";
import { createRouter, publicQuery } from "./middleware";

export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, ts: Date.now() })),
  auth: authRouter,
  localAuth: localAuthRouter,
  timer: timerRouter,
  checkIn: checkInRouter,
});

export type AppRouter = typeof appRouter;
