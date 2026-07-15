import type { Request, Response, NextFunction } from "express";

// PIN gate removed — all Work Tree endpoints are open to authenticated users.
// No cookie, no prompt, no 12-hour unlock window.
export function requireWtAuth(
  _req: Request,
  _res: Response,
  next: NextFunction,
): void {
  next();
}
