// @vitest-environment jsdom
//
// A cor da loja como texto sobre BRANCO nos cartões que já renderizam de
// verdade no teste: o botão "Útil" da avaliação e o "Faltam R$ ..." do lembrete
// do carrinho. Com cor clara na loja, `text-primary` (a cor crua) some; os dois
// precisam apontar para `primary-legivel`. As classes viram CSS em
// marca-legivel-nos-pontos-da-vitrine.test.ts.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { CartReminder } from "@/components/ui/custom/CartReminder";
import { ReviewCard } from "@/components/ui/custom/ReviewCard";
import { defaultStoreConfig } from "@/config/cor-da-loja";
import type { Review } from "@/types";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/hooks/useCart", () => ({
  useCart: () => ({
    cart: [{ id: "item-1" }],
    cartCount: 1,
    cartTotal: 100,
  }),
}));

// O dublê é só do que o lembrete lê; os módulos reais puxam o Supabase.
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { ...defaultStoreConfig, freeShippingMin: 350 },
  }),
}));

vi.mock("@/contexts/CartContext", () => ({
  useCartContext: () => ({}),
}));

const avaliacao: Review = {
  id: "r1",
  productId: "p1",
  customerName: "Cliente",
  rating: 5,
  comment: "Gostei",
  verified: true,
  helpful: 2,
  createdAt: "2026-10-01T12:00:00Z",
};

let raiz: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers();
  host = document.createElement("div");
  document.body.appendChild(host);
  raiz = createRoot(host);
});
afterEach(() => {
  act(() => raiz.unmount());
  host.remove();
  vi.useRealTimers();
});

// `text-primary` puro: não conta `text-primary-foreground` nem `-legivel`.
const temCorCrua = (classes: string): boolean =>
  /(^|\s)text-primary(?![-\w])/.test(classes);

it("botão Útil: o texto e o ícone usam a cor legível sobre o tom claro", () => {
  act(() => {
    raiz.render(<ReviewCard review={avaliacao} onHelpful={vi.fn()} />);
  });
  const botao = Array.from(host.querySelectorAll("button")).find((b) =>
    b.textContent?.includes("Útil"),
  );
  expect(botao).toBeDefined();
  expect(botao?.className).toContain("text-primary-legivel");
  expect(temCorCrua(botao?.className ?? "")).toBe(false);
});

it("lembrete do carrinho: o valor que falta usa a cor legível sobre o branco", () => {
  act(() => {
    raiz.render(<CartReminder onAction={vi.fn()} />);
  });
  act(() => {
    vi.advanceTimersByTime(2000);
  });
  const faltam = Array.from(host.querySelectorAll("span")).find((s) =>
    s.textContent?.includes("250"),
  );
  expect(faltam, host.textContent ?? "").toBeDefined();
  expect(faltam?.className).toContain("text-primary-legivel");
  expect(temCorCrua(faltam?.className ?? "")).toBe(false);
});
