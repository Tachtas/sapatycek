// Login Google via SpacetimeAuth (OIDC PKCE) — pola sama dengan sapaty-pos.
// Web-only: redirect balik ke origin halaman ini.

const EMAIL_KEY = 'cek-login-email';
const TOKEN_KEY = 'cek-spacetime-token';
// Client ID SpacetimeAuth (tab Clients dashboard) — public, bukan rahasia.
const SPACETIME_CLIENT_ID = 'client_034lxMnaHtdhfFEAhxJj5V';
const AUTH_BASE = 'https://auth.spacetimedb.com';
const REDIRECT_URI = window.location.origin + '/';

function rand(n = 43): string {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function sha256(s: string): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return btoa(String.fromCharCode(...new Uint8Array(h))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function emailLogin(): string {
  try { return localStorage.getItem(EMAIL_KEY) ?? ''; } catch { return ''; }
}

export function spacetimeToken(): string | undefined {
  try { return localStorage.getItem(TOKEN_KEY) ?? undefined; } catch { return undefined; }
}

export function logout(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(EMAIL_KEY);
    sessionStorage.removeItem('oidc-verifier');
    sessionStorage.removeItem('oidc-state');
  } catch {}
  window.location.href = REDIRECT_URI;
}

function decodeEmail(idToken: string): string {
  const payload = JSON.parse(atob(idToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
  const email = String(payload.email ?? '').trim().toLowerCase();
  if (!email) throw new Error('token tanpa email');
  return email;
}

// Mulai login: redirect ke SpacetimeAuth (di dalamnya ada Google).
export async function loginGoogle(): Promise<void> {
  const verifier = rand();
  const challenge = await sha256(verifier);
  const state = rand(16);
  try { sessionStorage.setItem('oidc-verifier', verifier); sessionStorage.setItem('oidc-state', state); } catch {}
  const url =
    `${AUTH_BASE}/oidc/auth?response_type=code&client_id=${encodeURIComponent(SPACETIME_CLIENT_ID)}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=${encodeURIComponent('openid email profile')}` +
    `&code_challenge=${challenge}&code_challenge_method=S256&state=${state}`;
  window.location.href = url;
}

async function tukarCode(code: string, verifier: string): Promise<string> {
  const r = await fetch(`${AUTH_BASE}/oidc/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI,
      client_id: SPACETIME_CLIENT_ID, code_verifier: verifier,
    }),
  });
  if (!r.ok) throw new Error('tukar token gagal: ' + r.status);
  const j = await r.json();
  if (!j.id_token) throw new Error('tak ada id_token');
  return j.id_token as string;
}

// Dipanggil saat halaman dibuka dengan ?code=..&state=.. (callback login).
export function handleOidcCallback(): boolean {
  const u = new URL(window.location.href);
  if (!u.searchParams.has('code')) return false;
  const code = u.searchParams.get('code') ?? '';
  const st = u.searchParams.get('state') ?? '';
  const verifier = (() => { try { return sessionStorage.getItem('oidc-verifier') ?? ''; } catch { return ''; } })();
  if (st !== (() => { try { return sessionStorage.getItem('oidc-state') ?? ''; } catch { return ''; } })()) {
    // Teks konstan (bukan input pengguna) — aman dari XSS.
    document.body.insertAdjacentText('beforeend', 'login gagal: state tidak cocok');
    return true;
  }
  tukarCode(code, verifier).then((idToken) => {
    const email = decodeEmail(idToken);
    try { localStorage.setItem(EMAIL_KEY, email); localStorage.setItem(TOKEN_KEY, idToken); } catch {}
    window.history.replaceState({}, '', '/');
    window.location.reload();
  }).catch((e) => document.body.insertAdjacentText('beforeend', `login gagal: ${e}`));
  return true;
}
