# IKCOUS App Icon Fix — Design

## Problem

`core_app_mkt` is the generic "IKCOUS" demo/template instance of a white-label
marketplace app (the "Core" that gets cloned per client — see
`.agents_inactive/skills/ecous-ecosystem-manager/SKILL.md`). Its `appName`,
page title, and meta tags already say "IKCOUS", but the app icon a user
actually sees — on the home screen after "Add to Home Screen", as the browser
tab favicon, and as the Apple touch icon — is still the previous client's
(SR Tudo10) pink "SR" wordmark logo. This is confirmed visually: every
PWA-install-relevant icon file was last touched in commit `77f32d6` ("sync
codebase and assets from app_mkt_cliente_novo"), not in the later rebrand
commit `2e16cdf`.

The correct IKCOUS mark — a rounded dark-zinc square (`#18181b`) with a bold
italic white "I" — already exists as `public/logo.svg` (identical copies at
`public/favicon.svg` and `public/branding/logo.svg`) and matches the
reference image the user confirmed. It's wired up correctly in `index.html`'s
static `<link rel="icon">`/`<link rel="apple-touch-icon">` tags. The gap is
purely in the **rasterized PNG/ICO files**, which were never regenerated from
this SVG.

## Scope

**In scope:** regenerate every PNG/ICO icon asset from the existing correct
SVG, so all app-icon surfaces (PWA manifest icons, apple-touch-icon, favicon)
show the IKCOUS mark instead of the SR Tudo10 leftover.

**Out of scope** (deferred to a later round, per user decision): hardcoded
pink/rose UI colors (`SearchView.tsx`, `FavoritesView.tsx`,
`PushNotificationBanner.tsx`, `ProfileView.tsx`), leftover "SR Tudo 10" text
strings, `src/index.css` `:root` palette not matching `branding.json`, demo
product images (apparel/makeup), and `og-image.png` style mismatch. These are
tracked in the exploration findings but not touched by this change.

## Source of truth

`public/logo.svg` — 512×512, `rect rx="116" fill="#18181b"` background +
centered bold italic white "I" (`font-size="300"`). This file does not
change. All raster assets below are generated from it (or a maskable-safe
variant of it).

## Files to regenerate

| File | Size | Notes |
|---|---|---|
| `public/icons/icon-72x72.png` | 72×72 | |
| `public/icons/icon-96x96.png` | 96×96 | |
| `public/icons/icon-128x128.png` | 128×128 | |
| `public/icons/icon-144x144.png` | 144×144 | |
| `public/icons/icon-152x152.png` | 152×152 | |
| `public/icons/icon-192x192.png` | 192×192 | referenced in PWA manifest |
| `public/icons/icon-384x384.png` | 384×384 | |
| `public/icons/icon-512x512.png` | 512×512 | referenced in PWA manifest (`any` + `maskable` purpose) |
| `public/icons/icon-maskable-512x512.png` | 512×512 | **full-bleed square variant** (no rounded corners) so the OS-applied mask doesn't clip into transparent corners; letter stays centered, well within the safe zone |
| `public/apple-touch-icon.png` | 180×180 | Apple's recommended size; also precached by `vite-plugin-pwa`'s `includeAssets` |
| `public/branding/logo.png` | 512×512 | the "client override" slot — `applyBranding()` points `apple-touch-icon` here at runtime |
| `public/favicon.ico` | multi-res (16/32/48) | |
| `public/branding/favicon.ico` | multi-res (16/32/48) | the "client override" slot — `applyBranding()` points the favicon `<link>` here at runtime |

`cart-96x96.png` and `heart-96x96.png` in `public/icons/` are unrelated UI
glyphs, not the app logo — left untouched.

## Why the "client override" files also get the IKCOUS icon

`src/config/branding.ts`'s `applyBranding()` deliberately rewrites the
favicon/apple-touch-icon `<link>` hrefs to `/branding/favicon.ico` and
`/branding/logo.png` at runtime — this is the intended per-client white-label
mechanism (`public/branding/` is the swap point future client clones use),
not a bug. Since `core_app_mkt` *is* the IKCOUS instance, that slot should
simply contain IKCOUS's own icon by default, exactly like every other config
value in `src/config/branding.json` already does. No code change to
`applyBranding()` is needed — only its target files' content changes.

## Cache-busting

`applyBranding()` currently appends a hardcoded `?v=2` query string to the
branding-override URLs. Since the file *content* is changing but the *URL*
would otherwise stay identical, browsers/service-workers that already cached
`v=2` (e.g. anyone who has visited the site before) would keep serving the
stale pink icon. Bump this to `?v=3` in `src/config/branding.ts` as part of
this change so the new icon is actually picked up.

## Generation approach

Write a small Node script (`scripts/generate-app-icons.mjs`) using `sharp`
(for SVG→PNG rasterization and resizing) and `png-to-ico` (to pack the 16/32/48
PNGs into a proper multi-resolution `.ico`). Both added as devDependencies.
The script is a plain, repo-committed utility — it can be re-run in the
future by client clones to regenerate their own icon set from their own
`logo.svg`, which fits the existing "brand customization routine" described
in the Ecosystem Manager skill docs, though that reuse isn't required by this
change.

Run the script once now to produce the 13 files listed above, replacing the
existing stale SR Tudo10 assets in place.

## Verification

- Visually inspect a couple of generated PNGs (smallest and largest sizes)
  to confirm correct rendering (dark background, crisp white "I", no
  artifacts, correct transparency/corners per variant).
- Run `npm run build` to confirm `vite-plugin-pwa` still builds its manifest
  and service worker without errors against the new files.
- Note for the user: a device that already has the PWA installed to its home
  screen may keep showing the cached OS-level icon until the app is
  removed and re-installed, or until the OS refreshes it — this is normal
  PWA/OS icon-caching behavior, not a sign the fix didn't work.
