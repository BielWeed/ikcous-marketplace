# IKCOUS Brand Color & Copy Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the leftover SR Tudo10 wine-color (`#5C061E`/`#720E28`/`#C74156`) CTA styling and rose/pink decorative accents across the customer-facing app with the IKCOUS brand palette (`bg-primary`/`text-primary`/`bg-secondary`), and rewrite the literal "SR Tudo 10" marketing copy in the two components that still carry it — while leaving generic, brand-agnostic UI-convention colors (low-stock urgency, discount/sale pricing, cancelled-order status, toast severity, generic destructive-action red) untouched.

**Architecture:** Five independent tasks, each touching a distinct group of files. Tasks A–C are mechanical color-substitution sweeps guided by one shared rule table (below) plus per-file exception notes for files that mix in-scope brand colors with out-of-scope semantic colors. Tasks D–E are bespoke visual + copy rewrites of two specific components. No shared code/interfaces between tasks — each is independently testable via `npm run typecheck` + `npm run build` + targeted `grep` checks.

**Tech Stack:** React + TypeScript + Tailwind CSS (utility classes and Tailwind arbitrary-value hex syntax `bg-[#hex]`). No test runner exists in this project.

## Global Constraints

- Source of truth for the IKCOUS brand color is `src/config/branding.json` (`theme.primary = "#18181B"`, `theme.secondary = "#059669"`), exposed as the Tailwind/CSS tokens `primary` / `secondary` (see `tailwind.config.js` and `src/index.css`'s CSS custom properties) — always use the token classes (`bg-primary`, `text-primary`, `bg-secondary`, etc.), never a new literal hex.
- Never touch `src/views/admin/*` — out of scope for this plan.
- Never touch `src/index.css`'s `:root`/`.dark` base palette or the `[data-theme="rose-gold"]` block (an unrelated loyalty-tier theme preset) — out of scope for this plan.
- Never touch demo product images or `og-image.png` — out of scope for this plan.
- **Substitution table** (the default rule for every mechanical task — apply verbatim except where a task's own "Exceptions" list overrides it for a specific line):

  | Current | Replacement |
  |---|---|
  | `bg-[#5C061E]` | `bg-primary` |
  | `hover:bg-[#720E28]` | `hover:bg-primary/90` |
  | `bg-[#720E28]` (standalone, non-hover static fill) | `bg-primary/80` |
  | `text-[#5C061E]` | `text-primary` |
  | `text-[#C74156]` | `text-primary` |
  | `border-rose-100`, `border-rose-200` (light decorative border, not paired with a `red-*` danger state) | `border-zinc-100` |
  | `bg-rose-50`, `bg-rose-100` (light decorative background, full card/section) | `bg-zinc-50` |
  | `bg-rose-50`, `bg-rose-100` (small branded badge/pill background — not a discount/promo badge, see exceptions) | `bg-secondary/10` |
  | `text-rose-500`, `text-rose-600`, `text-rose-700` (brand-decorative accent — not urgency, not discount price, see exceptions) | `text-primary` |
  | `bg-rose-500` as a plain accent dot/pulse (not a stock/status indicator) | `bg-secondary` |
  | CTA button gradients (`from-rose-500 via-pink-600 to-rose-700` and similar) | simplify to solid `bg-primary` (matches `src/components/ui/button.tsx:12`'s established convention) |
  | Decorative glow/blur orbs in rose/pink (not on a button) | `bg-secondary/10` or `bg-zinc-100`, or delete if purely ornamental |
  | `shadow-rose-100/XX`, `shadow-[...rgba(199,65,86,X)...]` (stale shadow tint) | `shadow-black/10` |
  | Literal light-pink hex in non-Tailwind contexts (e.g. inline SVG `stroke="#ffe4e6"`) | nearest neutral equivalent (e.g. `#e4e4e7`) |
  | `rgba(199, 65, 86, X)` in inline JS `style={{}}` (e.g. Framer Motion `whileHover`) | `rgba(24, 24, 27, X)` (IKCOUS primary as rgba) |

- **Exceptions — never change these, in any task, even though they use rose/red colors:**
  1. **Low-stock / out-of-stock / in-stock indicators** — any block driven by a stock-quantity check (`isLowStock`, `product.stock <= N`, etc.) where the pattern is a 3-way `zinc` (out of stock) / `rose` (low stock) / `emerald` (in stock) choice, applied to both a pulsing dot and its adjacent status text (e.g. "Apenas N restam!"). Found in `ProductView.tsx`, `ProductCard.tsx`, `CartItemsList.tsx`.
  2. **Discounted/sale price emphasis** — price text shown in `text-rose-600` specifically when `originalPrice > currentPrice` (i.e. only on discounted items; the non-discounted branch already correctly uses a neutral color). Found in `ProductView.tsx`, `ProductCard.tsx`.
  3. **"% OFF" discount badges** — `border-rose-100 bg-rose-50 text-rose-600/700` badges showing a discount percentage (the same visual pattern as the neighboring, already-correct amber "bestseller" badge — this is a discount-badge convention, not brand). Found in `ProductView.tsx`, `ProductCard.tsx`.
  4. **Order status "cancelled" color** in `OrderList.tsx`'s `statusConfig` map and its matching progress-bar strip.
  5. **Toast/notification severity colors** in `Header.tsx`'s `renderToastIcon` function (`case "error"` = rose, `case "info"` = pink) — leave the whole function untouched.
  6. **Generic `text-red-500`/`border-red-500`/`hover:bg-red-500`** used for delete/remove/destructive actions or validation errors anywhere — already correct, brand-agnostic.
- After every task: run `npm run typecheck` and `npm run build` (must both exit 0 — no test suite exists in this project) before committing.
- After every task: `grep -n "5C061E\|720E28\|C74156" <changed files>` must return zero matches in the files that task touched (all literal hex must be gone from those files).

---

### Task 1: Purchase flow — Cart, Checkout, and related components

**Files:**
- Modify: `src/views/customer/CheckoutView.tsx`
- Modify: `src/views/customer/CartView.tsx`
- Modify: `src/components/ui/custom/CartFooterSummary.tsx`
- Modify: `src/components/ui/custom/EmptyCart.tsx`
- Modify: `src/components/ui/custom/ShippingCalculator.tsx`
- Modify: `src/components/ui/custom/CartItemsList.tsx`
- Modify: `src/components/ui/custom/CartReminder.tsx`

**Interfaces:** None — pure styling changes, no exported function signatures or props change in any of these files.

**Exceptions specific to this task:**
- `CartItemsList.tsx`: leave its low-stock badge (`border-rose-100/50 bg-rose-50/80 text-rose-600` wrapping "Só N restante(s)", plus its `bg-rose-400`/`bg-rose-500` pulsing dot) completely untouched — this is the low-stock exception (Global Constraints #1).
- `CheckoutView.tsx`: the "Aviso de Região" delivery-notice box (a `border-rose-200/30 bg-rose-50/60` box with `text-rose-500` icons, informational — "só entregamos em Monte Carmelo") is IN SCOPE (per user decision) — recolor it to neutral: `border-rose-200/30 bg-rose-50/60` → `border-zinc-200 bg-zinc-50`, its `text-rose-500` icons → `text-zinc-500`.

- [ ] **Step 1: Read all 7 files**

Read each file in full to locate every occurrence of the patterns in the Global Constraints substitution table (`#5C061E`, `#720E28`, `#C74156`, `rose-*`, `pink-*`, `rgba(199, 65, 86, ...)`).

- [ ] **Step 2: Grep to confirm the current occurrence list before editing**

Run:
```bash
grep -n "5C061E\|720E28\|C74156\|rose-\|pink-\|rgba(199" src/views/customer/CheckoutView.tsx src/views/customer/CartView.tsx src/components/ui/custom/CartFooterSummary.tsx src/components/ui/custom/EmptyCart.tsx src/components/ui/custom/ShippingCalculator.tsx src/components/ui/custom/CartItemsList.tsx src/components/ui/custom/CartReminder.tsx
```
Note every matching line. For `CartItemsList.tsx`, confirm the matches are exactly the low-stock badge described in "Exceptions" above — if so, none of that file's matches get changed.

- [ ] **Step 3: Apply the substitution table to every match except the listed exceptions**

For each match found in Step 2 (excluding `CartItemsList.tsx`'s low-stock badge), apply the Global Constraints substitution table. `CartReminder.tsx` additionally has a literal SVG `stroke="#ffe4e6"` (a light-pink circle-timer background stroke) — change it to `stroke="#e4e4e7"` (Tailwind zinc-200 equivalent). Its `stroke="#10b981"` (emerald, the active timer arc) is already correct — leave it.

- [ ] **Step 4: Re-run the grep to verify**

Run the same grep command from Step 2. Expected: the only remaining matches are `CartItemsList.tsx`'s low-stock badge lines (untouched, as intended) and `CheckoutView.tsx`'s `AlertCircle`/`MapPin` icon component names if they happen to contain "rose" as a substring (they don't — `AlertCircle`/`MapPin` are icon component names, not color classes, so this should not produce false positives). If any other file still shows a match, go back to Step 3.

- [ ] **Step 5: Verify the build**

Run: `npm run typecheck && npm run build`
Expected: both exit 0, no errors.

- [ ] **Step 6: Commit**

```bash
git add src/views/customer/CheckoutView.tsx src/views/customer/CartView.tsx src/components/ui/custom/CartFooterSummary.tsx src/components/ui/custom/EmptyCart.tsx src/components/ui/custom/ShippingCalculator.tsx src/components/ui/custom/CartItemsList.tsx src/components/ui/custom/CartReminder.tsx
git commit -m "fix: replace SR Tudo10 wine color with IKCOUS brand color in purchase flow"
```

---

### Task 2: Product browsing — Product detail, cards, Q&A, reviews, offers, home

**Files:**
- Modify: `src/views/customer/ProductView.tsx`
- Modify: `src/components/ui/custom/ProductCard.tsx`
- Modify: `src/components/ui/custom/ProductQA.tsx`
- Modify: `src/components/ui/custom/ReviewCard.tsx`
- Modify: `src/components/ui/custom/PremiumOffers.tsx`
- Modify: `src/views/customer/HomeView.tsx`

**Interfaces:** None — pure styling changes.

**Exceptions specific to this task (verified by direct reading — exact line numbers as of plan-writing time; re-verify with `Read` before editing since numbers may have drifted):**
- `ProductView.tsx` lines 848-875: the low-stock/out-of-stock/in-stock indicator block (pulsing dot at 850-858 + status text at 860-874, `isOutOfStock`/`isLowStock`-driven) — leave entirely untouched.
- `ProductView.tsx` line 883 (`text-rose-600` on the discounted current price, inside the `product.originalPrice > currentPrice` branch) — leave untouched (Exception #2).
- `ProductView.tsx` line 898 (the `border-rose-100 bg-rose-50 ... text-rose-600` "{discount}% OFF" badge) — leave untouched (Exception #3).
- `ProductView.tsx` line 1334 (`text-rose-600` on the sticky-bottom-bar mini price display — same discounted-price convention as line 883) — leave untouched (Exception #2).
- `ProductCard.tsx` lines 209-238: same low-stock indicator pattern as `ProductView.tsx` — leave entirely untouched.
- `ProductCard.tsx` line 252 (`text-rose-600` discounted price) and line 268 (`border-rose-100 bg-rose-50 ... text-rose-700` "% OFF" badge) — leave untouched (Exceptions #2 and #3).

**In-scope changes verified by direct reading (apply these specifically, in addition to running the general grep sweep for anything else the table catches):**
- `ProductView.tsx` line 184: `hover:bg-rose-50/50 hover:text-primary` (variant-picker row hover) → `hover:bg-zinc-50 hover:text-primary` (keep `hover:text-primary`, only the background changes).
- `ProductView.tsx` line 192: `isSelected ? "text-rose-100" : "text-zinc-400"` (muted stock-count sub-label on a selected/black-background variant row — NOT the low-stock indicator, this is a decorative muted-text color) → `isSelected ? "text-white/60" : "text-zinc-400"`.
- `ProductView.tsx` line 965: `shadow-md shadow-rose-100/30` (on an already-correct `bg-primary` selected variant chip) → `shadow-md shadow-black/10`.
- `ProductView.tsx` line 966: `hover:border-rose-300 hover:text-primary hover:bg-rose-50/20` (unselected variant chip hover) → `hover:border-zinc-300 hover:text-primary hover:bg-zinc-50` (keep `hover:text-primary`).
- `ProductView.tsx` lines 1043-1044: `bg-[#5C061E] hover:bg-[#720E28] shadow-lg shadow-rose-100/30 active:scale-[0.98]` / `bg-[#720E28] shadow-none` (main add-to-cart button, idle/pending states) → `bg-primary hover:bg-primary/90 shadow-lg shadow-black/10 active:scale-[0.98]` / `bg-primary/80 shadow-none`.
- `ProductView.tsx` lines 1387-1388: same pattern as 1043-1044 (compact sticky add-to-cart button) → same fix.
- `ProductCard.tsx` line 287: `shadow-[0_4px_10px_rgba(199,65,86,0.1)]` (stale shadow on the quick-buy button) → `shadow-[0_4px_10px_rgba(24,24,27,0.1)]`.
- `PremiumOffers.tsx` line 335: `shadow-[0_2px_4px_rgba(199,65,86,0.1)]` (stale shadow on an already-correct `bg-primary` badge) → `shadow-[0_2px_4px_rgba(24,24,27,0.1)]`.
- `PremiumOffers.tsx` line 490: `bg-rose-50 hover:bg-rose-100/60 text-rose-700 border-rose-200/40` (the "Comprar" quick-buy secondary CTA) → `bg-secondary/10 hover:bg-secondary/20 text-primary border-secondary/20`.

- [ ] **Step 1: Read all 6 files**

- [ ] **Step 2: Grep to confirm the current occurrence list before editing**

```bash
grep -n "5C061E\|720E28\|C74156\|rose-\|pink-\|rgba(199" src/views/customer/ProductView.tsx src/components/ui/custom/ProductCard.tsx src/components/ui/custom/ProductQA.tsx src/components/ui/custom/ReviewCard.tsx src/components/ui/custom/PremiumOffers.tsx src/views/customer/HomeView.tsx
```

- [ ] **Step 3: Apply the listed in-scope changes exactly as specified above**, then apply the general substitution table to any remaining matches in `ProductQA.tsx`, `ReviewCard.tsx`, and `HomeView.tsx` (files with no verified exceptions — every match in these three files should be replaced per the table), plus any other `PremiumOffers.tsx` matches beyond the two listed above (that file has additional purely-decorative rose/pink usage per the table, e.g. section glows, countdown badges — apply the table to those too, they have no stock/discount exception).

- [ ] **Step 4: Re-run the grep to verify**

Run the same command from Step 2. Expected remaining matches: only the listed `ProductView.tsx`/`ProductCard.tsx` exceptions (low-stock blocks, discounted-price lines, "% OFF" badges).

- [ ] **Step 5: Verify the build**

Run: `npm run typecheck && npm run build`

- [ ] **Step 6: Commit**

```bash
git add src/views/customer/ProductView.tsx src/components/ui/custom/ProductCard.tsx src/components/ui/custom/ProductQA.tsx src/components/ui/custom/ReviewCard.tsx src/components/ui/custom/PremiumOffers.tsx src/views/customer/HomeView.tsx
git commit -m "fix: replace SR Tudo10 wine color with IKCOUS brand color in product browsing views"
```

---

### Task 3: Search, account, orders, and toast severity spot-fix

**Files:**
- Modify: `src/views/customer/SearchView.tsx`
- Modify: `src/views/customer/ProfileView.tsx`
- Modify: `src/views/customer/AccountSettingsView.tsx`
- Modify: `src/components/ui/custom/OrderSearch.tsx`
- Modify: `src/components/ui/custom/OrderList.tsx`
- Modify: `src/components/ui/custom/Header.tsx`

**Interfaces:** None — pure styling changes.

**Exceptions specific to this task:**
- `OrderList.tsx`: the `statusConfig` object's `cancelled` entry (`color: "text-rose-600", bg: "bg-rose-50/50", dot: "bg-rose-500"`) and the matching `bg-rose-500/80` bottom progress-bar strip rendered when `status === "cancelled"` — leave entirely untouched (Exception #4).
- `Header.tsx`: the entire `renderToastIcon` function (covers `case "error"`: `bg-rose-500/25 text-rose-300 ring-1 ring-rose-400/40`, and `case "info"`: `bg-pink-400/25 text-pink-200 ring-1 ring-pink-300/40`) — leave entirely untouched (Exception #5). The ONLY in-scope change in `Header.tsx` is a decorative `text-rose-300/90` sparkle glyph elsewhere in the file (not inside `renderToastIcon`) — find it via the grep in Step 2, confirm via `Read` that it's outside `renderToastIcon`, and change it to `text-secondary/90`.
- `ProfileView.tsx` and `AccountSettingsView.tsx` both contain a near-identical cover-photo modal with a "Remover Capa"/"Remover Avatar" delete button styled `text-red-500 hover:border-red-500/30 hover:bg-red-500/5` alongside a `border-rose-100` idle-state border on the SAME button — only the `border-rose-100` piece changes (to `border-zinc-100`); the `text-red-500`/`hover:*-red-500*` classes are the genuine danger-action color (Exception #6) and must not change.

- [ ] **Step 1: Read all 6 files**

- [ ] **Step 2: Grep to confirm the current occurrence list before editing**

```bash
grep -n "5C061E\|720E28\|C74156\|rose-\|pink-\|rgba(199" src/views/customer/SearchView.tsx src/views/customer/ProfileView.tsx src/views/customer/AccountSettingsView.tsx src/components/ui/custom/OrderSearch.tsx src/components/ui/custom/OrderList.tsx src/components/ui/custom/Header.tsx
```

- [ ] **Step 3: Apply the substitution table to every match**, respecting the exceptions listed above (`OrderList.tsx`'s cancelled-status entries, `Header.tsx`'s `renderToastIcon` function, and the `text-red-500`/hover-red classes on the two delete buttons). For `SearchView.tsx` specifically: lines ~216 and ~291 have the `bg-[#5C061E] ... hover:bg-[#720E28]` filter-button pattern (→ `bg-primary ... hover:bg-primary/90`, plus their `shadow-rose-100/XX` → `shadow-black/10`); line ~253 has a stale `shadow-rose-100/20` on an already-correct `bg-primary` category chip (→ `shadow-black/10`).

- [ ] **Step 4: Re-run the grep to verify**

Run the same command from Step 2. Expected remaining matches: only `OrderList.tsx`'s cancelled-status lines and `Header.tsx`'s `renderToastIcon` lines.

- [ ] **Step 5: Verify the build**

Run: `npm run typecheck && npm run build`

- [ ] **Step 6: Commit**

```bash
git add src/views/customer/SearchView.tsx src/views/customer/ProfileView.tsx src/views/customer/AccountSettingsView.tsx src/components/ui/custom/OrderSearch.tsx src/components/ui/custom/OrderList.tsx src/components/ui/custom/Header.tsx
git commit -m "fix: replace SR Tudo10 wine color with IKCOUS brand color in search, account, and order views"
```

---

### Task 4: PushNotificationBanner.tsx — copy rewrite and recolor

**Files:**
- Modify: `src/components/pwa/PushNotificationBanner.tsx`

**Interfaces:** None — the component's props (`PushNotificationBannerProps`) and exported function signature (`PushNotificationBanner`) do not change.

- [ ] **Step 1: Read the current file**

Read `src/components/pwa/PushNotificationBanner.tsx` in full (176 lines as of plan-writing time) to confirm current content matches the changes below before editing.

- [ ] **Step 2: Rename the localStorage key**

Change line 12:
```typescript
const DISMISS_KEY = "sr_tudo10_push_banner_dismissed_until";
```
to:
```typescript
const DISMISS_KEY = "ikcous_push_banner_dismissed_until";
```

- [ ] **Step 3: Rewrite the comment and heading, remove the "Makes R$10" badge**

Change (around lines 120-129):
```tsx
            {/* Conteudo formatado com a identidade de marca da SR Tudo 10 */}
            <div className="flex-1 space-y-1">
              <div className="flex items-center gap-1.5 flex-wrap">
                <h4 className="text-xs font-black uppercase tracking-wider text-white">
                  SR Tudo 10 VIP 💖
                </h4>
                <span className="flex items-center gap-0.5 rounded-full bg-rose-500/20 border border-rose-500/30 px-2 py-0.5 font-mono text-[9px] font-bold uppercase text-rose-300">
                  <Sparkles className="size-2.5 text-rose-400" /> Makes R$10
                </span>
              </div>
```
to:
```tsx
            {/* Conteudo do banner de notificacoes da IKCOUS */}
            <div className="flex-1 space-y-1">
              <div className="flex items-center gap-1.5 flex-wrap">
                <h4 className="text-xs font-black uppercase tracking-wider text-white">
                  IKCOUS Novidades 🔔
                </h4>
              </div>
```

- [ ] **Step 4: Rewrite the body copy**

Change (lines 130-144):
```tsx
              <p className="text-[11px] leading-snug text-zinc-300">
                Fique por dentro das{" "}
                <strong className="text-rose-400 font-semibold">
                  reposições de R$10,00
                </strong>
                ,{" "}
                <strong className="text-rose-400 font-semibold">
                  kits de make
                </strong>{" "}
                e{" "}
                <strong className="text-rose-400 font-semibold">
                  mimos exclusivos
                </strong>{" "}
                direto no seu celular!
              </p>
```
to:
```tsx
              <p className="text-[11px] leading-snug text-zinc-300">
                Fique por dentro de{" "}
                <strong className="text-secondary font-semibold">
                  promoções
                </strong>
                ,{" "}
                <strong className="text-secondary font-semibold">
                  novidades
                </strong>{" "}
                e{" "}
                <strong className="text-secondary font-semibold">
                  ofertas exclusivas
                </strong>{" "}
                direto no seu celular!
              </p>
```

- [ ] **Step 5: Recolor the banner chrome (border, glow line, close-button hover, bell-icon container)**

Change line 97:
```tsx
        <div className="relative overflow-hidden rounded-2xl border border-rose-500/25 bg-zinc-950/95 p-4 shadow-2xl backdrop-blur-2xl text-white">
```
to:
```tsx
        <div className="relative overflow-hidden rounded-2xl border border-secondary/25 bg-zinc-950/95 p-4 shadow-2xl backdrop-blur-2xl text-white">
```

Change line 99:
```tsx
          <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-transparent via-rose-500/70 to-transparent" />
```
to:
```tsx
          <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-transparent via-secondary/70 to-transparent" />
```

Change line 104:
```tsx
            className="absolute right-3 top-3 rounded-full p-1 text-zinc-400 hover:bg-rose-500/10 hover:text-rose-300 transition-colors"
```
to:
```tsx
            className="absolute right-3 top-3 rounded-full p-1 text-zinc-400 hover:bg-secondary/10 hover:text-secondary transition-colors"
```

Change lines 113-117:
```tsx
            <div className="relative flex-shrink-0">
              <div className="absolute inset-0 animate-ping rounded-xl bg-rose-500/20 blur-sm" />
              <div className="relative flex size-11 items-center justify-center rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-400 shadow-inner">
                <BellRing className="size-5 animate-bounce" />
              </div>
            </div>
```
to:
```tsx
            <div className="relative flex-shrink-0">
              <div className="absolute inset-0 animate-ping rounded-xl bg-secondary/20 blur-sm" />
              <div className="relative flex size-11 items-center justify-center rounded-xl border border-secondary/30 bg-secondary/10 text-secondary shadow-inner">
                <BellRing className="size-5 animate-bounce" />
              </div>
            </div>
```

- [ ] **Step 6: Recolor the CTA button, rewrite the dismiss button text**

Change lines 147-168:
```tsx
              <div className="mt-3 flex items-center gap-2 pt-1">
                <button
                  onClick={handleSubscribe}
                  disabled={isSubscribing}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-rose-500 via-pink-600 to-rose-700 px-3.5 py-2 text-[10px] font-black uppercase tracking-wider text-white shadow-lg shadow-rose-500/25 hover:brightness-110 active:scale-95 transition-all disabled:opacity-50"
                >
                  {isSubscribing ? (
                    <span className="animate-pulse">Ativando...</span>
                  ) : (
                    <>
                      <Heart className="size-3.5 fill-white/80" />
                      Quero Receber!
                    </>
                  )}
                </button>

                <button
                  onClick={handleDismiss}
                  className="rounded-xl border border-white/10 bg-zinc-900 px-3 py-2 text-[10px] font-bold text-zinc-400 hover:bg-zinc-800 hover:text-white transition-colors"
                >
                  Agora Não, Miga
                </button>
              </div>
```
to:
```tsx
              <div className="mt-3 flex items-center gap-2 pt-1">
                <button
                  onClick={handleSubscribe}
                  disabled={isSubscribing}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary px-3.5 py-2 text-[10px] font-black uppercase tracking-wider text-white shadow-lg shadow-black/25 hover:bg-primary/90 active:scale-95 transition-all disabled:opacity-50"
                >
                  {isSubscribing ? (
                    <span className="animate-pulse">Ativando...</span>
                  ) : (
                    <>
                      <Heart className="size-3.5 fill-white/80" />
                      Quero Receber!
                    </>
                  )}
                </button>

                <button
                  onClick={handleDismiss}
                  className="rounded-xl border border-white/10 bg-zinc-900 px-3 py-2 text-[10px] font-bold text-zinc-400 hover:bg-zinc-800 hover:text-white transition-colors"
                >
                  Agora Não
                </button>
              </div>
```

- [ ] **Step 7: Verify no SR/rose/pink references remain**

Run: `grep -n "SR Tudo\|sr_tudo\|rose-\|pink-" src/components/pwa/PushNotificationBanner.tsx`
Expected: no output.

- [ ] **Step 8: Verify the build**

Run: `npm run typecheck && npm run build`

- [ ] **Step 9: Commit**

```bash
git add src/components/pwa/PushNotificationBanner.tsx
git commit -m "fix: rewrite push notification banner copy and recolor from SR Tudo10 to IKCOUS"
```

---

### Task 5: FavoritesView.tsx — empty-state copy rewrite and recolor

**Files:**
- Modify: `src/views/customer/FavoritesView.tsx`

**Interfaces:** None — the component's exported function signature does not change.

- [ ] **Step 1: Read the current file**

Read `src/views/customer/FavoritesView.tsx` in full to confirm current content matches the changes below before editing (the empty-state block runs from the `if (favorites.length === 0)` check through its closing `);`, roughly lines 82-269 as of plan-writing time).

- [ ] **Step 2: Recolor the page background and ambient glow orbs**

Change:
```tsx
      <div className="pb-customer relative flex min-h-full flex-col items-center justify-start overflow-x-hidden bg-gradient-to-b from-rose-50/70 via-pink-50/30 to-white px-4 py-8 sm:px-6">
        {/* Soft Ambient Background Elements & Cherry Blossom Blooms */}
        <div className="absolute left-[-15%] top-[-5%] -z-10 h-[380px] w-[380px] rounded-full bg-rose-200/40 blur-[110px]" />
        <div className="absolute right-[-15%] top-[20%] -z-10 h-[300px] w-[300px] rounded-full bg-pink-300/30 blur-[120px]" />
        <div className="absolute bottom-[5%] left-[20%] -z-10 h-[250px] w-[250px] rounded-full bg-rose-100/60 blur-[90px]" />
```
to:
```tsx
      <div className="pb-customer relative flex min-h-full flex-col items-center justify-start overflow-x-hidden bg-gradient-to-b from-zinc-50 via-white to-white px-4 py-8 sm:px-6">
        {/* Soft Ambient Background Elements */}
        <div className="absolute left-[-15%] top-[-5%] -z-10 h-[380px] w-[380px] rounded-full bg-zinc-200/40 blur-[110px]" />
        <div className="absolute right-[-15%] top-[20%] -z-10 h-[300px] w-[300px] rounded-full bg-secondary/10 blur-[120px]" />
        <div className="absolute bottom-[5%] left-[20%] -z-10 h-[250px] w-[250px] rounded-full bg-zinc-100/60 blur-[90px]" />
```

- [ ] **Step 3: Remove the "Preço Único • SR Tudo 10" brand badge entirely**

Delete this whole block (the badge `motion.div` immediately after the hero container opens):
```tsx
          {/* Brand Badge - Price Point & Store Persona */}
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="mb-6 inline-flex items-center gap-2 rounded-full border border-rose-200/80 bg-white/90 px-4 py-1.5 shadow-sm backdrop-blur-md"
          >
            <Sparkles className="size-3.5 fill-rose-500/20 text-rose-500 animate-pulse" />
            <span className="text-[11px] font-black uppercase tracking-wider text-[#5C061E]">
              Preço Único R$ 10,00 • SR Tudo 10
            </span>
          </motion.div>
```
(Delete the block entirely — no replacement badge.)

- [ ] **Step 4: Remove the two floating cherry-blossom petal elements**

Delete both of these `motion.div` blocks (they float 🌸 emoji around the hero icon):
```tsx
            <motion.div
              animate={{
                y: [-6, 6, -6],
                rotate: [0, 15, -10, 0],
                opacity: [0.7, 1, 0.7],
              }}
              transition={{
                duration: 5,
                repeat: Number.POSITIVE_INFINITY,
                ease: "easeInOut",
              }}
              className="pointer-events-none absolute -left-6 top-2 text-rose-300"
            >
              🌸
            </motion.div>

            <motion.div
              animate={{
                y: [6, -6, 6],
                rotate: [0, -15, 10, 0],
                opacity: [0.6, 0.9, 0.6],
              }}
              transition={{
                duration: 4.2,
                repeat: Number.POSITIVE_INFINITY,
                ease: "easeInOut",
                delay: 0.5,
              }}
              className="pointer-events-none absolute -right-5 bottom-4 text-pink-300 text-xl"
            >
              🌸
            </motion.div>
```
(Delete both blocks entirely — no replacement.)

- [ ] **Step 5: Recolor the glowing heart icon container and its pulse ring**

Change:
```tsx
                className="relative z-10 flex size-full items-center justify-center rounded-[2.8rem] border border-white/40 bg-gradient-to-tr from-[#5C061E] via-rose-600 to-rose-400 p-4 shadow-[0_20px_45px_-10px_rgba(199,65,86,0.38)]"
```
to:
```tsx
                className="relative z-10 flex size-full items-center justify-center rounded-[2.8rem] border border-white/40 bg-gradient-to-tr from-primary via-primary to-secondary p-4 shadow-[0_20px_45px_-10px_rgba(24,24,27,0.38)]"
```

Change:
```tsx
                className="absolute inset-0 -z-10 rounded-[2.8rem] border-2 border-rose-300/60 bg-rose-200/20"
```
to:
```tsx
                className="absolute inset-0 -z-10 rounded-[2.8rem] border-2 border-secondary/40 bg-secondary/10"
```

- [ ] **Step 6: Rewrite the headline gradient color and the body copy**

Change:
```tsx
            <h2 className="text-2xl font-black uppercase tracking-tight text-slate-900 sm:text-3xl">
              Sua lista de desejos <br />
              <span className="bg-gradient-to-r from-[#5C061E] via-rose-600 to-pink-500 bg-clip-text text-transparent italic not-italic">
                tá tão vazia... 💕
              </span>
            </h2>
            <p className="px-2 text-xs font-medium leading-relaxed text-slate-600 sm:text-sm">
              Que tal rechear com as makes e acessórios mais fofos de Monte
              Carmelo? Tudo com aquele preço único incrível de{" "}
              <span className="font-bold text-[#5C061E]">R$ 10,00</span>!
            </p>
```
to:
```tsx
            <h2 className="text-2xl font-black uppercase tracking-tight text-slate-900 sm:text-3xl">
              Sua lista de desejos <br />
              <span className="bg-gradient-to-r from-primary via-primary to-secondary bg-clip-text text-transparent italic not-italic">
                tá tão vazia... 💕
              </span>
            </h2>
            <p className="px-2 text-xs font-medium leading-relaxed text-slate-600 sm:text-sm">
              Que tal dar uma olhada nos produtos mais desejados da loja?
              Encontre aqui suas{" "}
              <span className="font-bold text-primary">
                próximas compras favoritas
              </span>
              !
            </p>
```

- [ ] **Step 7: Recolor the primary CTA button and rewrite its text**

Change:
```tsx
            <button
              onClick={() => {
                haptic.medium();
                onNavigate("home");
              }}
              className="group relative flex h-14 w-full items-center justify-between overflow-hidden rounded-2xl border border-rose-400/30 bg-gradient-to-r from-[#5C061E] via-rose-700 to-rose-600 px-5 text-white shadow-[0_12px_28px_-6px_rgba(199,65,86,0.4)] transition-all hover:scale-[1.02] active:scale-95"
            >
              <div className="relative z-10 flex items-center gap-2.5">
                <div className="flex size-7 items-center justify-center rounded-xl bg-white/15 text-rose-200">
                  <Sparkles className="size-4 fill-rose-200/30 text-rose-100 animate-pulse" />
                </div>
                <span className="text-[12px] font-black uppercase tracking-wider text-white">
                  Explorar por R$ 10,00
                </span>
              </div>
```
to:
```tsx
            <button
              onClick={() => {
                haptic.medium();
                onNavigate("home");
              }}
              className="group relative flex h-14 w-full items-center justify-between overflow-hidden rounded-2xl border border-primary/20 bg-primary px-5 text-white shadow-[0_12px_28px_-6px_rgba(24,24,27,0.4)] transition-all hover:scale-[1.02] active:scale-95"
            >
              <div className="relative z-10 flex items-center gap-2.5">
                <div className="flex size-7 items-center justify-center rounded-xl bg-white/15 text-secondary">
                  <Sparkles className="size-4 fill-secondary/30 text-secondary animate-pulse" />
                </div>
                <span className="text-[12px] font-black uppercase tracking-wider text-white">
                  Explorar Produtos
                </span>
              </div>
```

- [ ] **Step 8: Recolor the suggestions section divider and eyebrow badge**

Change:
```tsx
            className="mt-10 w-full max-w-md border-t border-rose-100/80 pt-6"
```
to:
```tsx
            className="mt-10 w-full max-w-md border-t border-zinc-100 pt-6"
```

Change:
```tsx
              <span className="inline-block rounded-full bg-rose-100/70 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-[#5C061E]">
                ✨ Destaques por R$ 10,00
              </span>
```
to:
```tsx
              <span className="inline-block rounded-full bg-secondary/10 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-primary">
                ✨ Destaques da Loja
              </span>
```

- [ ] **Step 9: Check for any remaining rose/pink/SR references and the "Descobrir Mais" floating button**

Run: `grep -n "SR Tudo\|rose-\|pink-\|5C061E\|C74156\|rgba(199, *65, *86" src/views/customer/FavoritesView.tsx`

If a `shadow-[0_20px_50px_-10px_rgba(199,65,86,0.15)]` remains on a "Descobrir Mais" floating CTA (outside the empty-state block edited above — this is a separate always-rendered floating action button), change it to `shadow-[0_20px_50px_-10px_rgba(24,24,27,0.15)]`. Re-run the grep — expected: no output afterward.

- [ ] **Step 10: Verify the build**

Run: `npm run typecheck && npm run build`

- [ ] **Step 11: Commit**

```bash
git add src/views/customer/FavoritesView.tsx
git commit -m "fix: rewrite favorites empty-state copy and recolor from SR Tudo10 to IKCOUS"
```

---

## Post-plan verification (not a task — run after all 5 tasks land)

```bash
grep -rn "5C061E\|720E28\|C74156\|SR Tudo\|sr_tudo" src/ --include="*.tsx" --include="*.ts"
```
Expected: no output at all (the audit in this plan's design spec found zero occurrences outside the files covered by Tasks A-E).
