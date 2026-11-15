// @vitest-environment jsdom
//
// P60 (painel em computador) — dois campos esticados medidos em Chromium:
//
// 1) Validade do cupom: o campo de data (`w-full`) ocupava a largura inteira do
//    formulário (728 px a 1024, 984 a 1280, 1240 a 1536/1920), a 708-1220 px do
//    seletor do calendário. O invólucro `relative` (ícone + input) ganha
//    `lg:max-w-sm` (384 px): ícone, dica e "Limpar validade" ficam no lugar.
// 2) Rastreio do pedido: o campo ia de 518 px (1024) a 1198 px (1536+) para um
//    código de 13 caracteres, e "Salvar" ficava a mais de 400 px do campo.
//    `lg:max-w-lg` (512 px) entra SÓ no `Input` e SÓ na linha dos botões — nunca
//    no invólucro `space-y-3`, porque ali a linha divisória acima do editor
//    encolheria para 512 px (medido e descartado).
//
// O celular não muda: só entram classes `lg:`. O que cada elemento tocado tem
// SEM prefixo fica congelado como LISTA LITERAL (escrita à mão; nunca lida do
// histórico do git, que no CI vem com 1 commit). O jsdom não mede layout (os
// pixels acima vêm do Chromium); aqui a prova é o className dos componentes
// REAIS e mutantes em CÓPIA do className, para as travas não serem decorativas.
import type { Order } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { classesDoCelular } from "./classes-do-celular";

vi.mock("@/lib/supabase", () => ({
  supabase: { from: () => ({}), functions: { invoke: vi.fn() } },
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock("@/components/admin/orders/EtiquetaDoPedidoCard", () => ({
  EtiquetaDoPedidoCard: () => null,
}));
vi.mock("@/components/admin/orders/EstornoCard", () => ({
  EstornoCard: () => null,
}));
vi.mock("@/components/admin/orders/DevolucaoDoPedidoAdminCard", () => ({
  DevolucaoDoPedidoAdminCard: () => null,
}));
vi.mock("@/hooks/useCoupons", () => ({
  useCoupons: () => ({
    coupons: [],
    addCoupon: vi.fn(),
    updateCoupon: vi.fn(),
  }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { formasPagamentoEntrega: ["pix", "card", "cash"] },
  }),
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const tokens = (className: string) => className.split(/\s+/).filter(Boolean);

// ---------------------------------------------------------------------------
// Lista literal do que cada elemento tocado tem no celular (sem `lg:`/`xl:`).
// ---------------------------------------------------------------------------

const INVOLUCRO_DA_VALIDADE_NO_CELULAR = "relative";
const CAMPO_DO_RASTREIO_NO_CELULAR =
  "file:text-foreground placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground dark:bg-input/30 w-full min-w-0 border px-3 py-1 shadow-xs transition-[color,box-shadow] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive h-11 rounded-xl border-admin-border bg-zinc-950 font-mono text-sm text-white focus:border-admin-gold/30";
const BOTOES_DO_RASTREIO_NO_CELULAR = "flex justify-end gap-2";
const INVOLUCRO_DO_EDITOR_NO_CELULAR =
  "space-y-3 px-4 py-3.5 duration-300 animate-in fade-in";

// ---------------------------------------------------------------------------
// As regras, como funções puras sobre o className. Os testes as aplicam ao
// className REAL; os mutantes as aplicam a uma CÓPIA adulterada e têm de falhar.
// ---------------------------------------------------------------------------

function violacoesDoInvolucroDaValidade(className: string): string[] {
  const v: string[] = [];
  if (classesDoCelular(className) !== INVOLUCRO_DA_VALIDADE_NO_CELULAR)
    v.push("celular mudou");
  if (!tokens(className).includes("lg:max-w-sm")) v.push("falta lg:max-w-sm");
  return v;
}

function violacoesDoCampoDoRastreio(className: string): string[] {
  const v: string[] = [];
  if (classesDoCelular(className) !== CAMPO_DO_RASTREIO_NO_CELULAR)
    v.push("celular mudou");
  if (!tokens(className).includes("lg:max-w-lg")) v.push("falta lg:max-w-lg");
  return v;
}

function violacoesDosBotoesDoRastreio(className: string): string[] {
  const v: string[] = [];
  if (classesDoCelular(className) !== BOTOES_DO_RASTREIO_NO_CELULAR)
    v.push("celular mudou");
  if (!tokens(className).includes("lg:max-w-lg")) v.push("falta lg:max-w-lg");
  return v;
}

function violacoesDoInvolucroDoEditor(className: string): string[] {
  const v: string[] = [];
  if (classesDoCelular(className) !== INVOLUCRO_DO_EDITOR_NO_CELULAR)
    v.push("celular mudou");
  // Largura no invólucro encolheria a divisória: nada de `max-w` aqui.
  if (tokens(className).some((c) => /(^|:)max-w-/.test(c)))
    v.push("invólucro com max-w");
  return v;
}

const semOToken = (className: string, token: string) =>
  tokens(className)
    .filter((c) => c !== token)
    .join(" ");
const semOPrefixo = (className: string, token: string) =>
  tokens(className)
    .map((c) => (c === token ? token.replace(/^lg:/, "") : c))
    .join(" ");

// ---------------------------------------------------------------------------
// 1) Validade do cupom
// ---------------------------------------------------------------------------

describe("P60 validade do cupom: o campo de data tem largura de leitura no PC", () => {
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

  async function involucroDaValidade() {
    const { AdminCouponFormView } = await import(
      "@/views/admin/AdminCouponFormView"
    );
    await act(async () => {
      raiz.render(
        <AdminCouponFormView couponId={undefined} onNavigate={vi.fn()} />,
      );
    });
    const campo = hospedeiro.querySelector(
      "#coupon-valid-until",
    ) as HTMLInputElement;
    return { campo, involucro: campo.parentElement as HTMLElement };
  }

  it("o invólucro do ícone + input ganha `lg:max-w-sm` e o celular continua só `relative`", async () => {
    const { campo, involucro } = await involucroDaValidade();
    // É mesmo o invólucro certo: o `relative` que guarda o ícone e o input.
    expect(involucro.querySelector("svg")).not.toBeNull();
    expect(involucro.contains(campo)).toBe(true);
    expect(violacoesDoInvolucroDaValidade(involucro.className)).toEqual([]);
    expect(classesDoCelular(involucro.className)).toBe(
      INVOLUCRO_DA_VALIDADE_NO_CELULAR,
    );
  });

  it("mutantes em cópia: sem o token, ou sem prefixo, a regra cai", async () => {
    const { involucro } = await involucroDaValidade();
    expect(
      violacoesDoInvolucroDaValidade(
        semOToken(involucro.className, "lg:max-w-sm"),
      ),
    ).toContain("falta lg:max-w-sm");
    expect(
      violacoesDoInvolucroDaValidade(
        semOPrefixo(involucro.className, "lg:max-w-sm"),
      ),
    ).toContain("celular mudou");
  });
});

// ---------------------------------------------------------------------------
// 2) Editor de rastreio do pedido
// ---------------------------------------------------------------------------

const pedido: Order = {
  id: "pedido-p60",
  notes: "",
  trackingCode: "BR123456789BR",
  customer: { name: "Cliente Teste", whatsapp: "34999999999" },
  items: [],
  subtotal: 100,
  shipping: 0,
  discount: 0,
  total: 100,
  paymentMethod: "pix",
  paymentStatus: "pago",
  status: "processing",
  createdAt: "2026-10-16T10:00:00Z",
  updatedAt: "2026-10-16T10:00:00Z",
  cancelledAfterShipping: false,
};

describe("P60 rastreio do pedido: campo e botões com largura de leitura no PC", () => {
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

  async function abrirEditor() {
    const { OrderDetail } = await import(
      "@/components/admin/orders/OrderDetail"
    );
    await act(async () => {
      raiz.render(<OrderDetail order={pedido} onStatusChange={vi.fn()} />);
    });
    const editar = [...hospedeiro.querySelectorAll("button")].find(
      (b) =>
        b.textContent?.trim() === "Editar Código" ||
        b.getAttribute("title") === "Editar Código" ||
        b.getAttribute("aria-label") === "Editar Código",
    ) as HTMLButtonElement;
    await act(async () => editar.click());
    const campo = hospedeiro.querySelector("#tracking-input") as HTMLElement;
    const botoes = campo.nextElementSibling as HTMLElement;
    const involucro = campo.parentElement as HTMLElement;
    return { campo, botoes, involucro };
  }

  it("só o `Input` e a linha dos botões ganham `lg:max-w-lg`; o celular fica literal", async () => {
    const { campo, botoes } = await abrirEditor();
    // A linha dos botões é a irmã logo abaixo do campo e guarda Cancelar/Salvar.
    expect(botoes.textContent).toContain("Salvar");
    expect(
      botoes.querySelector('[aria-label="Cancelar edição do código"]'),
    ).not.toBeNull();
    expect(violacoesDoCampoDoRastreio(campo.className)).toEqual([]);
    expect(violacoesDosBotoesDoRastreio(botoes.className)).toEqual([]);
    expect(classesDoCelular(campo.className)).toBe(
      CAMPO_DO_RASTREIO_NO_CELULAR,
    );
    expect(classesDoCelular(botoes.className)).toBe(
      BOTOES_DO_RASTREIO_NO_CELULAR,
    );
    // `w-full` do componente segue no celular e `lg:max-w-lg` convive com ele.
    expect(tokens(campo.className)).toContain("w-full");
  });

  it("o invólucro `space-y-3` NÃO ganha largura (a divisória acima fica inteira)", async () => {
    const { involucro } = await abrirEditor();
    expect(violacoesDoInvolucroDoEditor(involucro.className)).toEqual([]);
    expect(classesDoCelular(involucro.className)).toBe(
      INVOLUCRO_DO_EDITOR_NO_CELULAR,
    );
  });

  it("mutantes em cópia: sem o token, sem prefixo, ou largura no invólucro, a regra cai", async () => {
    const { campo, botoes, involucro } = await abrirEditor();
    for (const [classe, regra] of [
      [campo.className, violacoesDoCampoDoRastreio],
      [botoes.className, violacoesDosBotoesDoRastreio],
    ] as const) {
      expect(regra(semOToken(classe, "lg:max-w-lg"))).toContain(
        "falta lg:max-w-lg",
      );
      expect(regra(semOPrefixo(classe, "lg:max-w-lg"))).toContain(
        "celular mudou",
      );
    }
    expect(
      violacoesDoInvolucroDoEditor(`${involucro.className} lg:max-w-lg`),
    ).toContain("invólucro com max-w");
  });
});
