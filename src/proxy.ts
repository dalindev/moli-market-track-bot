import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Simple password protection using Next.js 16 Proxy
// Password is stored server-side only (not exposed to client)
const SITE_PASSWORD = process.env.SITE_PASSWORD;

export function proxy(request: NextRequest) {
  // Skip auth for API routes (cron jobs need access)
  if (request.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

  // Skip if no password is set (dev mode or disabled)
  if (!SITE_PASSWORD) {
    return NextResponse.next();
  }

  // Check for auth cookie
  const authCookie = request.cookies.get('site-auth');
  if (authCookie?.value === 'authenticated') {
    return NextResponse.next();
  }

  // Check for password in query param (for login)
  const password = request.nextUrl.searchParams.get('password');
  if (password === SITE_PASSWORD) {
    const response = NextResponse.redirect(new URL('/', request.url));
    response.cookies.set('site-auth', 'authenticated', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7, // 7 days
    });
    return response;
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
    <form method="GET" action="/">
      <input type="password" name="password" placeholder="Password" required autofocus />
      <button type="submit">Enter</button>
    </form>
    ${password !== null ? '<p class="error">Incorrect password</p>' : ''}
  </div>
</body>
</html>`;

  return new NextResponse(loginHtml, {
    status: 401,
    headers: { 'Content-Type': 'text/html' },
  });
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
