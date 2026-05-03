import { zValidator as zv } from "@hono/zod-validator";
import { ValidationTargets } from "hono";
import z from "zod";
import { validationError } from "./errors";
import type { ContentfulStatusCode } from "hono/utils/http-status";
/**
 * Use this instead of zValidator because we are formatting validation errors
 */
export const validate = <
  T extends z.ZodType,
  Target extends keyof ValidationTargets,
>(
  target: Target,
  schema: T,
) =>
  zv(target, schema, (result, c) => {
    if (!result.success) {
      const err = validationError(result.error);
      return c.json(
        {
          ok: false,
          type: err.type,
          message: err.message,
          errors: err.errors,
        },
        err.status as ContentfulStatusCode,
      );
    }
  });
