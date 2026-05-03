import { AppError } from "./errors";

type Ok<T> = { ok: true; data: T };

type Err<E> = { ok: false; error: E };

export type Result<T, E = AppError> = Ok<T> | Err<E>;

export function Ok<T>(data: T): Ok<T> {
  return { ok: true, data };
}

export function Err<E>(error: E): Err<E> {
  return { ok: false, error };
}
