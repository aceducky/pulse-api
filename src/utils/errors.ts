import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { Context } from "hono";
import { z } from "zod";

export type AppError = {
  status: number;
  message: string;
  type: ErrType;
  errors?: Record<string, string[]>;
};

type ErrType =
  | "serverErr"
  | "clientErr"
  | "validationError"
  | "notFoundErr"
  | "conflictErr"
  | "notInitialized";

export function appError(
  status: number,
  type: ErrType,
  message: string,
  errors?: Record<string, string[]>,
): AppError {
  return { status, type, message, errors };
}

export function validationError(
  zodError: z.core.$ZodError,
  message = "Invalid input(s)",
): AppError {
  return {
    status: 400,
    message,
    type: "validationError",
    errors: z.flattenError(zodError).fieldErrors,
  };
}

export function errorResponse(c: Context, error: AppError) {
  return c.json(
    {
      ok: false as const,
      type: error.type,
      message: error.message,
      ...(error.errors && { errors: error.errors }),
    },
    error.status as ContentfulStatusCode,
  );
}
