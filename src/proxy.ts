import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { AUTH_COOKIE, AUTH_MAX_AGE_S, makeAuthToken, passwordMatches, verifyAuthToken } from '@/lib/site-auth';

// Password protection using Next.js 16 Proxy. The password lives server-side only (SITE_PASSWORD).
// The session cookie is a signed, expiring token (see src/lib/site-auth.ts), not a constant, so it cannot be forged.

function withAuthCookie(response: NextResponse, token: string): NextResponse {
  response.cookies.set(AUTH_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: AUTH_MAX_AGE_S,
    path: '/',
  });
  return response;
}

export async function proxy(request: NextRequest) {
  // Skip auth for API routes (cron jobs need access)
  if (request.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

  // The session cookie is httpOnly, so only the server can clear it (document.cookie cannot)
  if (request.nextUrl.pathname === '/__logout') {
    const response = NextResponse.redirect(new URL('/', request.url), 303);
    response.cookies.set(AUTH_COOKIE, '', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 0, path: '/' });
    response.headers.set('Cache-Control', 'no-store');
    return response;
  }

  const SITE_PASSWORD = process.env.SITE_PASSWORD;

  // No password: open in dev, but never silently open in production
  if (!SITE_PASSWORD) {
    if (process.env.NODE_ENV === 'production') {
      return new NextResponse('Site password is not configured.', {
        status: 503,
        headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
      });
    }
    return NextResponse.next();
  }

  const nowSec = Math.floor(Date.now() / 1000);

  // Valid signed session cookie
  if (await verifyAuthToken(SITE_PASSWORD, request.cookies.get(AUTH_COOKIE)?.value, nowSec)) {
    return NextResponse.next();
  }

  // Login: the form POSTs the password; the old ?password= link still works so bookmarks keep working
  let password: string | null = null;
  let attempted = false;
  if (request.method === 'POST' && request.nextUrl.pathname === '/__login') {
    attempted = true;
    try {
      const form = await request.formData();
      password = String(form.get('password') ?? '').slice(0, 200);
    } catch {
      password = '';
    }
  } else if (request.nextUrl.searchParams.has('password')) {
    attempted = true;
    password = request.nextUrl.searchParams.get('password');
  }
  if (attempted && (await passwordMatches(SITE_PASSWORD, password))) {
    const token = await makeAuthToken(SITE_PASSWORD, nowSec + AUTH_MAX_AGE_S);
    return withAuthCookie(NextResponse.redirect(new URL('/', request.url), 303), token);
  }
  if (attempted) {
    await new Promise((r) => setTimeout(r, 800)); // cheap brake on guessing
  }

  // Show login page
  const loginHtml = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Login - Market Tracker</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: system-ui, -apple-system, sans-serif;
      background: #0a0a0a;
      color: #fafafa;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .card {
      background: #18181b;
      border: 1px solid #27272a;
      border-radius: 8px;
      padding: 2rem;
      width: 100%;
      max-width: 400px;
      margin: 1rem;
    }
    h1 { font-size: 1.5rem; margin-bottom: 0.5rem; }
    p { color: #71717a; font-size: 0.875rem; margin-bottom: 1.5rem; }
    form { display: flex; flex-direction: column; gap: 1rem; }
    input {
      background: #27272a;
      border: 1px solid #3f3f46;
      border-radius: 6px;
      padding: 0.75rem;
      color: #fafafa;
      font-size: 1rem;
    }
    input:focus { outline: none; border-color: #52525b; }
    button {
      background: #fafafa;
      color: #0a0a0a;
      border: none;
      border-radius: 6px;
      padding: 0.75rem;
      font-size: 1rem;
      cursor: pointer;
      font-weight: 500;
    }
    button:hover { background: #e4e4e7; }
    .error { color: #ef4444; font-size: 0.875rem; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Market Tracker</h1>
    <p>Enter password to continue</p>
    <form method="POST" action="/__login">
      <input type="password" name="password" placeholder="Password" required autofocus />
      <button type="submit">Enter</button>
    </form>
    ${attempted ? '<p class="error">Incorrect password</p>' : ''}
  </div>
</body>
</html>`;

  return new NextResponse(loginHtml, {
    status: 401,
    headers: { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' },
  });
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
