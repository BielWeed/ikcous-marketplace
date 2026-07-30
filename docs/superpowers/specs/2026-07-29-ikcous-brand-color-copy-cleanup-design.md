# IKCOUS Brand Color & Copy Cleanup — Design

## Problem

Following the app-icon fix, the IKCOUS demo/template app still carries its
previous client's (SR Tudo10) visual identity throughout the customer-facing
UI: a hardcoded wine/burgundy color (`#5C061E`, hover `#720E28`, and a third
undocumented tint `#C74156`) is used as the primary call-to-action color on
nearly every purchase-critical button (checkout, add-to-cart, cart footer),
plus decorative rose/pink accents (borders, glows, gradients, stale shadow
tints) are scattered across ~20 components. Two components additionally
hardcode literal "SR Tudo 10" marketing copy: the push-notification opt-in
banner and the empty-favorites-list hero.

A full-repo inventory (see methodology note below) found:
- **30 literal hex occurrences** (`#5C061E` / `#720E28` / `#C74156`, plus 8
  `rgba(199,65,86,…)` occurrences — the same third hex written as rgba) across
  14 files.
- **~130 `rose-*`/`pink-*` Tailwind utility-class occurrences** across ~20
  files in `src/views/customer/`, `src/components/pwa/`, and
  `src/components/ui/custom/`.
- 2 components with literal "SR Tudo 10" copy: `PushNotificationBanner.tsx`
  and `FavoritesView.tsx`.

Not every rose/pink usage is a brand leftover, though — several are generic,
brand-agnostic UI conventions (low-stock urgency red, cancelled-order-status
red, toast-severity colors) that must be left alone. See "Explicitly out of
scope" below.

**Methodology note:** the file/line inventory below was produced by an
automated search-and-classify pass, then spot-verified by hand. One
classification from that pass was found incorrect during verification —
`src/components/ui/custom/CartReminder.tsx` was initially reported as
containing literal "SR Tudo 10" copy; direct inspection showed it does not
(it's the "Frete VIP" free-shipping reminder toast, color-only, no text
changes needed). The line numbers and snippets below for `CartReminder.tsx`,
`PushNotificationBanner.tsx`, and `FavoritesView.tsx` were confirmed by direct
reading. Line numbers for the remaining mechanical-sweep files came from the
automated pass; implementers must `Read` each file before editing and treat
the *substitution rule* below, not the exact reported line number, as the
source of truth if a line has drifted.

## Scope

**In scope:**
1. Replace every brand-color hex/rgba occurrence (`#5C061E`, `#720E28`,
   `#C74156`, `rgba(199,65,86,…)`) with the IKCOUS brand token (`primary` /
   `secondary`, defined in `src/config/branding.json` and wired to Tailwind
   via `tailwind.config.js` + `src/index.css`'s CSS variables).
2. Replace decorative/brand `rose-*`/`pink-*` Tailwind utility classes with
   neutral or brand-token equivalents, per the Substitution Rule below —
   except the explicitly excluded semantic uses.
3. Rewrite the literal "SR Tudo 10" copy in `PushNotificationBanner.tsx` and
   `FavoritesView.tsx` with the approved generic/IKCOUS copy (below), and
   redesign both components' visual chrome (gradients, decorative elements)
   to match the app's neutral/primary/secondary palette instead of the
   rose/cherry-blossom SR aesthetic.
4. Rename the `PushNotificationBanner.tsx` localStorage key from
   `sr_tudo10_push_banner_dismissed_until` to
   `ikcous_push_banner_dismissed_until` (users who previously dismissed the
   banner will see it once more — acceptable, harmless).

**Explicitly out of scope — do not touch, even though these files also
contain rose/red colors:**
- **Low-stock urgency indicators** — any `rose-500`/`rose-600` styling
  driven by a stock-quantity check (pattern:
  `isLowStock ? "bg-rose-500 ..." : "bg-emerald-500 ..."` or equivalent),
  found in `ProductView.tsx`, `ProductCard.tsx`, `CartItemsList.tsx`. Red for
  low-stock is a standard, brand-agnostic e-commerce convention — leave
  exactly as-is.
- **Order status "cancelled" color** in `OrderList.tsx`'s `statusConfig`
  map (`color: "text-rose-600", bg: "bg-rose-50/50", dot: "bg-rose-500"`
  under the `cancelled` key, plus its matching progress-bar strip). Part of
  a multi-color status-per-state system — leave exactly as-is.
- **Toast/notification severity colors** in `Header.tsx`'s
  `renderToastIcon` function — `case "error"` (rose) and `case "info"`
  (pink) are a systemwide 4-state severity palette
  (error/warning/info/success), unrelated to brand. Leave the whole
  function untouched. (Line 317's decorative `text-rose-300/90` sparkle
  glyph in the same file, outside `renderToastIcon`, IS in scope — see file
  list below.)
- **Generic `text-red-500` / `border-red-500` / `hover:bg-red-500`** used
  for delete/remove/destructive actions or form-validation errors anywhere
  in the app (e.g. "Remover Avatar", "Remover Capa" buttons) — already
  correct, brand-agnostic red. Leave untouched.
- **`[data-theme="rose-gold"]` block in `src/index.css`** — an unrelated
  customer loyalty-tier theme preset (actual color value is warm gold, not
  SR's wine color) — not a leftover, leave untouched.
- **`src/views/admin/*`** — entirely out of scope (per earlier user
  decision on the icon-fix round; admin's red/rose destructive-action
  buttons are generic UI, not brand).
- `src/index.css`'s `:root` base palette, demo product images,
  `og-image.png` — tracked separately, not part of this round.

## Approved copy changes

**`src/components/pwa/PushNotificationBanner.tsx`:**
- Heading `SR Tudo 10 VIP 💖` → `IKCOUS Novidades 🔔`
- Remove the `✨ Makes R$10` badge entirely (the `<span>` at lines 126-128 —
  it's SR's specific makeup-category promo tag, has no IKCOUS equivalent).
- Body copy — replace the three-`<strong>` sentence (lines 130-144, "Fique
  por dentro das reposições de R$10,00, kits de make e mimos exclusivos
  direto no seu celular!") with: `Fique por dentro de` **`promoções`**`,`
  **`novidades`** `e` **`ofertas exclusivas`** `direto no seu celular!` (keep
  the same three-`<strong>` emphasis structure, just on the new words).
- Dismiss button `Agora Não, Miga` → `Agora Não`.
- Comment at line 120 (`Conteudo formatado com a identidade de marca da SR
  Tudo 10`) → rephrase to describe the IKCOUS banner generically, e.g.
  `Conteudo do banner de notificacoes da IKCOUS`.

**`src/views/customer/FavoritesView.tsx`:**
- Remove the "Preço Único R$ 10,00 • SR Tudo 10" brand badge entirely (the
  `motion.div` block at lines 95-105 — IKCOUS has no single-price model).
- Keep the headline `Sua lista de desejos tá tão vazia... 💕` as-is (generic,
  works for any store).
- Replace the paragraph "Que tal rechear com as makes e acessórios mais
  fofos de Monte Carmelo? Tudo com aquele preço único incrível de R$
  10,00!" (lines 190-194) with: `Que tal dar uma olhada nos produtos mais
  desejados da loja? Encontre aqui suas próximas compras favoritas!` (no
  price emphasis span needed — bold "próximas compras favoritas" instead,
  in `text-primary`, for the same visual rhythm the old price emphasis had).
- Replace CTA button text `Explorar por R$ 10,00` → `Explorar Produtos`.
- Replace section eyebrow `✨ Destaques por R$ 10,00` → `✨ Destaques da
  Loja` (same reasoning — no single-price model).
- Remove the two floating 🌸 cherry-blossom petal `motion.div` elements
  (lines ~115-129 and ~131-146) — purely decorative SR motif with no
  IKCOUS equivalent, simplest correct fix is deletion, not replacement.

## Substitution rule (mechanical color sweep)

Applied file-by-file in Tasks A–C below. This is the default mapping;
apply it verbatim except where a file's own listed exceptions (above)
override it.

| Current | Replacement | Applies to |
|---|---|---|
| `bg-[#5C061E]` | `bg-primary` | solid CTA button fill |
| `hover:bg-[#720E28]` | `hover:bg-primary/90` | CTA hover state |
| `bg-[#720E28]` (standalone, non-hover — e.g. a static pressed/loading fill) | `bg-primary/80` | static darker-shade fill |
| `text-[#5C061E]` | `text-primary` | text/icon accent |
| `text-[#C74156]` | `text-primary` | text accent (third hex variant) |
| `border-rose-100`, `border-rose-200` (light decorative border, not part of a `red-*` danger pairing) | `border-zinc-100` | card/modal/input borders |
| `bg-rose-50`, `bg-rose-100` (light decorative background) | `bg-zinc-50` | neutral card backgrounds |
| `bg-rose-50`, `bg-rose-100` where used specifically as a "branded" badge/tag background (discount tags, VIP-style badges — judgment call, prefer this when the element is a small pill/badge rather than a full card) | `bg-secondary/10` | badges/tags |
| `text-rose-500`, `text-rose-600`, `text-rose-700` (brand-decorative accent, not urgency/status-driven) | `text-primary` | text/icon accents |
| `bg-rose-500` used as a plain accent dot/pulse (not a stock/status indicator) | `bg-secondary` | accent dots |
| Gradients: `from-rose-500 via-pink-600 to-rose-700` and similar rose/pink multi-stop gradients on CTA buttons | simplify to solid `bg-primary` (matches the established convention in `src/components/ui/button.tsx:12`) | CTA button fills |
| Gradients used for pure decorative glow/blur orbs (not on a button) | `bg-secondary/10` or `bg-zinc-100` blur orb, or delete if purely ornamental (e.g. the FavoritesView cherry-blossom petals — see copy section) | ambient background decoration |
| `shadow-rose-100/XX`, `shadow-[...rgba(199,65,86,X)...]` (stale shadow tinted for a background color that's being changed) | `shadow-black/10` | button/card elevation shadows |
| Literal light-pink hex in non-Tailwind contexts (e.g. an inline SVG `stroke="#ffe4e6"`) | nearest neutral equivalent (e.g. `#e4e4e7`, Tailwind zinc-200) | SVG/inline styles |
| `rgba(199, 65, 86, X)` in inline JS `style={{}}` objects (e.g. Framer Motion `whileHover`) | `rgba(24, 24, 27, X)` (the IKCOUS primary color, `#18181B`, as rgba) | inline hover styles |

## File-by-file task grouping

**Task A — Purchase flow** (`src/views/customer/CheckoutView.tsx`,
`CartView.tsx`, `src/components/ui/custom/CartFooterSummary.tsx`,
`EmptyCart.tsx`, `ShippingCalculator.tsx`, `CartItemsList.tsx`,
`CartReminder.tsx`): apply the substitution rule. `CartItemsList.tsx` has
the low-stock exception (leave alone). `CheckoutView.tsx` additionally gets
the "Aviso de Região" notice box recolored from rose to neutral (lines
955-961: `border-rose-200/30 bg-rose-50/60` → `border-zinc-200 bg-zinc-50`,
`text-rose-500` icons → `text-zinc-500`) per user decision. No copy changes
in this task.

**Task B — Product browsing** (`src/views/customer/ProductView.tsx`,
`src/components/ui/custom/ProductCard.tsx`, `ProductQA.tsx`, `ReviewCard.tsx`,
`PremiumOffers.tsx`, `src/views/customer/HomeView.tsx`): apply the
substitution rule. `ProductView.tsx` and `ProductCard.tsx` have the
low-stock exception (leave alone) — both files have brand-color CTA buttons
AND a separate low-stock indicator; only the CTA/decorative parts change.
No copy changes.

**Task C — Search, account, orders** (`src/views/customer/SearchView.tsx`,
`ProfileView.tsx`, `AccountSettingsView.tsx`,
`src/components/ui/custom/OrderSearch.tsx`, `OrderList.tsx`,
`src/components/ui/custom/Header.tsx`): apply the substitution rule.
`OrderList.tsx` has the cancelled-status exception (leave alone).
`Header.tsx` only gets its one decorative line touched (line ~317,
`text-rose-300/90` sparkle) — its `renderToastIcon` function is fully
excluded. No copy changes.

**Task D — PushNotificationBanner.tsx**: substitution rule + the approved
copy rewrite + localStorage key rename, described in full above.

**Task E — FavoritesView.tsx**: substitution rule + the approved copy
rewrite + petal removal, described in full above.

## Verification

- `npm run typecheck` and `npm run build` must pass after each task (no
  test suite exists in this project).
- No `grep -rn "5C061E\|720E28\|C74156\|rgba(199, *65, *65\|rgba(199, *65, *86" src/` matches should remain after Tasks A-E, except inside
  `src/views/admin/` (out of scope) if any exist there (none were found in
  the inventory, but the check should still exclude `admin/` to be safe).
- No `grep -rn "SR Tudo\|sr_tudo" src/` matches should remain anywhere.
- Manually re-verify (via `Read`, not just grep) that the explicitly
  out-of-scope elements (low-stock indicators, cancelled-order color, toast
  severity colors, generic red delete buttons) are still present and
  unchanged after all tasks — a final task-level check, not a full visual
  QA pass (no test suite/browser automation is being used for this round).
