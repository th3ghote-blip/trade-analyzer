import { NextRequest, NextResponse } from "next/server";

// Basic-auth gate. Runs on every request except Next.js internals and static assets.
// Credentials are read from BASIC_AUTH_USER / BASIC_AUTH_PASSWORD env vars.
// In production both vars must be set or every request returns 503 — fail-closed
// so a misconfigured deployment can never be served publicly.

export const config = {
  matcher: [
    // Match everything except _next internals, favicon, and static files.
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    // Still do a fake compare so we don't reveal length differences via timing.
    let acc = 1;
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      acc |= (a.charCodeAt(i % a.length) ^ b.charCodeAt(i % b.length)) | 0;
    }
    return false;
  }
  let acc = 0;
  for (let i = 0; i < a.length; i++) {
    acc |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return acc === 0;
}

export function middleware(req: NextRequest) {
  const expectedUser = process.env.BASIC_AUTH_USER;
  const expectedPass = process.env.BASIC_AUTH_PASSWORD;

  // Dev-mode skip: if no creds configured and we are not on Vercel, allow.
  if (!expectedUser && !expectedPass && !process.env.VERCEL) {
    return NextResponse.next();
  }

  // Misconfiguration on a deployed instance — refuse to serve.
  if (!expectedUser || !expectedPass) {
    return new NextResponse("Server auth not configured", { status: 503 });
  }

  const header = req.headers.get("authorization");
  if (header?.startsWith("Basic ")) {
    try {
      const decoded = atob(header.slice(6));
      const idx = decoded.indexOf(":");
      if (idx > 0) {
        const user = decoded.slice(0, idx);
        const pass = decoded.slice(idx + 1);
        if (timingSafeEqual(user, expectedUser) && timingSafeEqual(pass, expectedPass)) {
          const requestHeaders = new Headers(req.headers);
          requestHeaders.set("x-auth-user", user);
          const res = NextResponse.next({ request: { headers: requestHeaders } });
          res.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
          res.headers.set("X-Frame-Options", "DENY");
          res.headers.set("Referrer-Policy", "no-referrer");
          return res;
        }
      }
    } catch {
      // Fall through to 401.
    }
  }

  return new NextResponse("Authentication required", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Trade Analyzer", charset="UTF-8"',
      "Cache-Control": "no-store",
    },
  });
}
