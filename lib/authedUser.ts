import { NextRequest } from "next/server";

/**
 * Resolve the authenticated username for an API route. In production the
 * basic-auth middleware injects `x-auth-user`. In local dev (no VERCEL,
 * no basic-auth env vars) we use a deterministic "dev" owner so saved
 * accounts persist across restarts.
 */
export function getAuthedUser(req: NextRequest | Request): string {
  const headerName = "x-auth-user";
  const fromHeader =
    typeof (req as NextRequest).headers?.get === "function"
      ? (req as NextRequest).headers.get(headerName)
      : null;
  if (fromHeader) return fromHeader;
  if (!process.env.VERCEL) return "dev";
  // In a deployed environment without the header, refuse — middleware
  // is supposed to set it before routes run.
  throw new Error("Unauthenticated request reached an API route");
}
