import { z } from "zod";
import { createRouter, authedQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { notes } from "../db/schema";
import { and, eq, desc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

export const NOTE_COLORS = ["yellow", "green", "blue", "pink"] as const;

export const notesRouter = createRouter({
  list: authedQuery
    .input(z.object({ archived: z.boolean().default(false) }).optional())
    .query(async ({ ctx, input }) => {
      const db = getDb();
      const archived = input?.archived ?? false;

      return db
        .select()
        .from(notes)
        .where(and(eq(notes.userId, ctx.user.id), eq(notes.archived, archived)))
        .orderBy(desc(notes.updatedAt));
    }),

  create: authedQuery
    .input(
      z
        .object({
          color: z.enum(NOTE_COLORS).optional(),
        })
        .optional()
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();

      const [result] = await db
        .insert(notes)
        .values({
          userId: ctx.user.id,
          content: "",
          color: input?.color ?? "yellow",
        })
        .$returningId();

      return { id: result.id };
    }),

  update: authedQuery
    .input(
      z.object({
        id: z.number(),
        content: z.string().max(20000).optional(),
        color: z.enum(NOTE_COLORS).optional(),
        archived: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();

      // Ensure the note belongs to the current user
      const [note] = await db
        .select()
        .from(notes)
        .where(and(eq(notes.id, input.id), eq(notes.userId, ctx.user.id)))
        .limit(1);

      if (!note) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Note not found" });
      }

      const patch: Record<string, unknown> = {};
      if (input.content !== undefined) patch.content = input.content;
      if (input.color !== undefined) patch.color = input.color;
      if (input.archived !== undefined) patch.archived = input.archived;

      if (Object.keys(patch).length > 0) {
        await db.update(notes).set(patch).where(eq(notes.id, input.id));
      }

      return { ok: true };
    }),

  delete: authedQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();

      await db
        .delete(notes)
        .where(and(eq(notes.id, input.id), eq(notes.userId, ctx.user.id)));

      return { ok: true };
    }),
});
