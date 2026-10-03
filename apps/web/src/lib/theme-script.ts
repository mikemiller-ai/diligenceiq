/**
 * The script that applies a stored theme choice before first paint (pattern from CareerOps).
 *
 * It runs synchronously in `<head>`: the choice lives in `localStorage`, and the site is a
 * static export with no request state, so a component correcting the theme after hydration
 * would paint the wrong one first. With no stored choice it does nothing and the OS
 * preference stands ("System", the default).
 *
 * **It is ONE string constant so that exactly one thing is hashed.** `app/layout.tsx`
 * renders it verbatim. DiligenceIQ has no Content-Security-Policy yet; the Phase 7 CSP
 * (assumptions D10) must allow this inline script by its SHA-256 hash
 * (`script-src 'sha256-…'`), computed from this exact string. Any edit to it changes the
 * hash, and a stale hash fails silently: the toggle still writes `localStorage`, but the
 * stored choice stops applying on load. A nonce is not an option: the export is static.
 *
 * The storage key must match `THEME_STORAGE_KEY` in `components/ui/theme-toggle.tsx`
 * (asserted by `theme.test.tsx`).
 */
export const THEME_SCRIPT =
  'try{var t=localStorage.getItem("diligenceiq:theme");' +
  'if(t==="light"||t==="dark"){document.documentElement.setAttribute("data-theme",t)}}catch(e){}';
