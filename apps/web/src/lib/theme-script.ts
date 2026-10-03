/**
 * The script that applies a stored theme choice before first paint (pattern from CareerOps).
 *
 * It runs synchronously in `<head>`: the choice lives in `localStorage`, and the site is a
 * static export with no request state, so a component correcting the theme after hydration
 * would paint the wrong one first. With no stored choice it does nothing and the OS
 * preference stands ("System", the default).
 *
 * **It is ONE string constant so that exactly one thing is hashed.** `app/layout.tsx`
 * renders it verbatim. The CSP (assumptions D10) allows it by its SHA-256 hash: after
 * `next build`, `src/build/csp.ts` hashes every inline script of each page into that page's
 * `<meta>` policy, so an edit here is picked up by the next build. `csp.test.ts` and the e2e
 * `security.spec.ts` (theme applied with every bundle blocked) guard it. A nonce is not an
 * option: the export is static.
 *
 * The storage key must match `THEME_STORAGE_KEY` in `components/ui/theme-toggle.tsx`
 * (asserted by `theme.test.tsx`).
 */
export const THEME_SCRIPT =
  'try{var t=localStorage.getItem("diligenceiq:theme");' +
  'if(t==="light"||t==="dark"){document.documentElement.setAttribute("data-theme",t)}}catch(e){}';
