// Login Google via SpacetimeAuth (OIDC PKCE) — pola sama dengan sapaty-pos.
// Web-only: redirect balik ke origin halaman ini.

const EMAIL_KEY = 'cek-login-email';
const TOKEN_KEY = 'cek-spacetime-token';
const REFRESH_KEY = 'cek-refresh-token';
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

function simpanToken(idToken: string, refreshToken?: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, idToken);
    if (refreshToken) localStorage.setItem(REFRESH_KEY, refreshToken);
  } catch {}
}

export function logout(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_KEY);
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
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=${encodeURIComponent('openid email profile offline_access')}` +
    `&code_challenge=${challenge}&code_challenge_method=S256&state=${state}`;
  window.location.href = url;
}

async function tukarCode(code: string, verifier: string): Promise<{ idToken: string; refreshToken?: string }> {
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
  return { idToken: j.id_token as string, refreshToken: j.refresh_token as string | undefined };
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
  tukarCode(code, verifier).then(({ idToken, refreshToken }) => {
    const email = decodeEmail(idToken);
    try { localStorage.setItem(EMAIL_KEY, email); } catch {}
    simpanToken(idToken, refreshToken);
    window.history.replaceState({}, '', '/');
    window.location.reload();
  }).catch((e) => document.body.insertAdjacentText('beforeend', `login gagal: ${e}`));
  return true;
}

// Token SpacetimeAuth (id_token) berlaku ~1 jam. Tanpa pemeriksaan ini,
// setelah kedaluwarsa koneksi gagal diam-diam: indikator kuning, input cek
// mati, tanpa penjelasan apa pun ke operator.
export function tokenKedaluwarsa(marjinDetik = 120): boolean {
  const t = spacetimeToken();
  if (!t) return true;
  try {
    const bagian = t.split('.')[1] ?? '';
    const isi = JSON.parse(atob(bagian.replace(/-/g, '+').replace(/_/g, '/')));
    const exp = Number(isi.exp ?? 0);
    if (!exp) return false; // tanpa exp: biarkan server yang menilai
    return Date.now() / 1000 > exp - marjinDetik;
  } catch {
    return true;
  }
}

const KUNCI_COBA = 'cek-login-terakhir';

// Cegah lingkaran redirect: paling cepat 60 detik sekali.
export function bolehCobaLagi(ms = 60000): boolean {
  try {
    const t = Number(localStorage.getItem(KUNCI_COBA) ?? 0);
    return Date.now() - t > ms;
  } catch {
    return true;
  }
}

export function tandaiCobaLagi(): void {
  try { localStorage.setItem(KUNCI_COBA, String(Date.now())); } catch {}
}

// Perpanjang token DIAM-DIAM (tanpa pindah halaman) memakai refresh_token.
// Grant ini terbukti didukung SpacetimeAuth; kalau server tidak mengirim
// refresh_token saat login (atau perpanjangan gagal), pemanggil yang
// memutuskan: tampilkan kartu / masuk ulang lewat halaman login.
export async function perpanjangToken(): Promise<boolean> {
  let rt = '';
  try { rt = localStorage.getItem(REFRESH_KEY) ?? ''; } catch {}
  if (!rt) return false;
  try {
    const r = await fetch(`${AUTH_BASE}/oidc/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: rt,
        client_id: SPACETIME_CLIENT_ID,
      }),
    });
    if (!r.ok) return false;
    const j = await r.json();
    if (!j.id_token) return false;
    simpanToken(j.id_token as string, (j.refresh_token as string) ?? rt);
    return true;
  } catch {
    return false;
  }
}

// Token masih sah tapi tinggal sedikit (dipakai untuk memperpanjang saat senggang).
export function tokenSegeraHabis(menit = 10): boolean {
  const t = spacetimeToken();
  if (!t) return true;
  try {
    const isi = JSON.parse(atob((t.split('.')[1] ?? '').replace(/-/g, '+').replace(/_/g, '/')));
    const exp = Number(isi.exp ?? 0);
    if (!exp) return false;
    return Date.now() / 1000 > exp - menit * 60;
  } catch {
    return true;
  }
}
