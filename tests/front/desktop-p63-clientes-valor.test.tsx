// @vitest-environment jsdom
//
// P63 (painel em computador) — o "Total já comprado" do cartão do cliente
// (lista detalhada, `grid-cols-12`) é `whitespace-nowrap text-xl`. A 1024 px a
// coluna do valor (`md:col-span-3`, menos o `p-3` da caixa) é estreita: um valor
// grande como R$ 123.456.789,89 passa da caixa e empurra o que está ao lado.
//
// Conserto SÓ de classes, SÓ no valor do cartão detalhado e SÓ a partir de 1024:
// `lg:whitespace-normal lg:break-words` deixa o valor quebrar depois do "R$"
// (e, em último caso, no meio, em vez de vazar), `lg:text-base` o faz caber na
// coluna estreita de 1024 e `xl:text-xl` devolve o tamanho de hoje a partir de
// 1280, onde a coluna comporta. NADA de `truncate`: um valor de dinheiro cortado
// ("R$ 123.456.7…") mostra um número errado.
//
// O celular não muda: só entram classes `lg:`/`xl:`. O que o valor tem SEM esses
// prefixos fica congelado como LISTA LITERAL (escrita à mão; nunca lida do
// histórico do git). O jsdom não mede layout; aqui a prova é o className do
// componente REAL e mutantes em CÓPIA do className, para as travas não serem
// decorativas.
import { CartaoCliente } from "@/components/admin/users/CartaoCliente";
import type { Customer } from "@/utils/admin_cache";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { classesDoCelular } from "./classes-do-celular";

vi.mock("@/lib/supabase", () => ({ supabase: { rpc: vi.fn() } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const tokens = (className: string) => className.split(/\s+/).filter(Boolean);

// ---------------------------------------------------------------------------
// Lista literal do que o valor tem no celular (sem `lg:`/`xl:`/`2xl:`).
// ---------------------------------------------------------------------------

const VALOR_DETALHADO_NO_CELULAR =
  "whitespace-nowrap font-bold tabular-nums text-emerald-400 text-xl";
const VALOR_COMPACTO_NO_CELULAR =
  "whitespace-nowrap text-lg font-bold leading-tight tabular-nums text-emerald-400";

const CLASSES_DO_COMPUTADOR = [
  "lg:whitespace-normal",
  "lg:break-words",
  "lg:text-base",
  "xl:text-xl",
];

// ---------------------------------------------------------------------------
// A regra, como função pura sobre o className. O teste a aplica ao className
// REAL; os mutantes a aplicam a uma CÓPIA adulterada e têm de falhar.
// ---------------------------------------------------------------------------

function violacoesDoValorDetalhado(className: string): string[] {
  const v: string[] = [];
  if (
    classesDoCelular(className).replace(/\s*xl:\S+/g, "") !==
    VALOR_DETALHADO_NO_CELULAR
  )
    v.push("celular mudou");
  for (const classe of CLASSES_DO_COMPUTADOR) {
    if (!tokens(className).includes(classe)) v.push(`falta ${classe}`);
  }
  // Dinheiro cortado mostra número errado.
  if (tokens(className).some((c) => /(^|:)(truncate|text-ellipsis)$/.test(c)))
    v.push("valor cortado");
  return v;
}

const semOToken = (className: string, token: string) =>
  tokens(className)
    .filter((c) => c !== token)
    .join(" ");
const semOPrefixo = (className: string, token: string) =>
  tokens(className)
    .map((c) => (c === token ? token.replace(/^(lg|xl):/, "") : c))
    .join(" ");

function cliente(sobrescreve: Partial<Customer>): Customer {
  return {
    id: "c-p63",
    full_name: "Maria Souza",
    email: "maria@exemplo.com",
    phone: null,
    role: "customer",
    created_at: "2026-02-07T12:00:00Z",
    orders_count: 3,
    total_spent: 123456789.89,
    ...sobrescreve,
  };
}

describe("P63 cartão do cliente: valor grande cabe na coluna a 1024 px", () => {
  let hospedeiro: HTMLDivElement;
  let raiz: Root;

  beforeEach(() => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });
  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
  });

  async function valorDoCartao(detalhado: boolean) {
    await act(async () => {
      raiz.render(
        <CartaoCliente
          customer={cliente({})}
          detalhado={detalhado}
          onNavigate={vi.fn()}
          onPrefetch={vi.fn()}
        />,
      );
    });
    const valor = Array.from(hospedeiro.querySelectorAll("span")).find((s) =>
      /^R\$\s*123\.456\.789,89$/.test(s.textContent ?? ""),
    );
    expect(valor).toBeDefined();
    return valor as HTMLElement;
  }

  it("lista detalhada: o valor ganha as classes de 1024 e o celular continua igual", async () => {
    const valor = await valorDoCartao(true);
    expect(violacoesDoValorDetalhado(valor.className)).toEqual([]);
    expect(classesDoCelular(valor.className).replace(/\s*xl:\S+/g, "")).toBe(
      VALOR_DETALHADO_NO_CELULAR,
    );
  });

  it("cartão compacto (grade): nenhuma classe de computador entra, nem a 1280", async () => {
    const valor = await valorDoCartao(false);
    expect(valor.className).toBe(VALOR_COMPACTO_NO_CELULAR);
  });

  it("mutantes em cópia: sem o token, sem prefixo ou com truncate, a regra cai", async () => {
    const { className } = await valorDoCartao(true);
    for (const classe of CLASSES_DO_COMPUTADOR) {
      expect(violacoesDoValorDetalhado(semOToken(className, classe))).toContain(
        `falta ${classe}`,
      );
    }
    expect(
      violacoesDoValorDetalhado(semOPrefixo(className, "lg:text-base")),
    ).toContain("celular mudou");
    expect(violacoesDoValorDetalhado(`${className} lg:truncate`)).toContain(
      "valor cortado",
    );
  });
});
