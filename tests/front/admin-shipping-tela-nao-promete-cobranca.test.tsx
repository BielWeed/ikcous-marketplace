// @vitest-environment jsdom
//
// A prova de que a TELA usa a regra — não só de que a regra existe.
//
// HISTÓRICO: a suíte original (auditoria de 20/08) prendia as frases da taxa
// fixa e o aviso de "entrega grátis para qualquer CEP" quando taxa e grátis
// estavam em zero. Esse estado MORREU na frente frete-v2-0309 (03/09/2026,
// ordem do dono: "entrega fixa não faz sentido existir") — o card de taxa
// fixa saiu da tela, `shippingFee` não é mais enviado, e fora da cidade o
// preço é SÓ o da cotação real da transportadora.
//
// O que esta suíte prende AGORA, mesma lei de antes (a tela não promete
// cobrança que o app não faz, nem esconde cobrança que faz):
//   - sem preset de grátis, a tela NÃO diz que "todo pedido terá cobrança
//     de entrega" como desfecho garantido (fora da cidade sem transportadora
//     o cliente nem consegue comprar — afirmar cobrança seria mentir duas
//     vezes);
//   - nenhuma frase de grátis exige mais "entrar na conta": a trava de
//     login da regra antiga morreu junto (frente FRETE B — convidado
//     também tem direito); se a frase voltar a mencionar conta, está
//     descrevendo uma trava que não existe;
//   - a consequência do preset escolhido aparece NA HORA, antes de salvar.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockConfig } = vi.hoisted(() => ({
  mockConfig: {
    freeShippingMin: 100,
    shippingCoverage: "national" as "local" | "national",
    shippingProvider: "melhor_envio" as "flat_fee" | "melhor_envio" | "frenet",
    originCep: "38500-000",
    enabledShippingMethods: ["sedex", "pac"] as string[],
    localDeliveryFee: 10,
    localCepRange: "",
  },
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: mockConfig,
    isLoaded: true,
    updateConfig: vi.fn(),
  }),
}));

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => Promise.resolve({ data: [], error: null }),
    }),
    functions: { invoke: vi.fn() },
  },
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("AdminShippingView — a tela não promete cobrança que o app não faz", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    mockConfig.freeShippingMin = 100;
    mockConfig.shippingCoverage = "national";
    mockConfig.shippingProvider = "melhor_envio";
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.restoreAllMocks();
  });

  async function abrirTela() {
    const { AdminShippingView } = await import(
      "@/views/admin/AdminShippingView"
    );
    await act(async () => {
      raiz.render(<AdminShippingView active={true} onSetDirty={vi.fn()} />);
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
  }

  const texto = () => hospedeiro.textContent ?? "";

  it("com grátis por valor ativo: mostra o valor e NÃO exige mais 'entrar na conta' (a trava de login morreu)", async () => {
    await abrirTela();

    expect(texto()).toContain("R$ 100");
    // A regra nova (FRETE B) vale para TODO cliente, inclusive convidado.
    // Uma frase que condicionasse o grátis a login estaria descrevendo a
    // trava antiga — o mesmo defeito de origem desta suíte, do outro lado.
    expect(texto()).not.toMatch(/entr(ou|ar) na conta/i);
  });

  it("com tudo desligado: NÃO diz que todo pedido paga entrega, e a taxa fixa morta não é citada", async () => {
    mockConfig.freeShippingMin = 0;
    await abrirTela();

    // A frase exata que a auditoria de 20/08 pegou — ela não volta nem
    // disfarçada: sem preset e sem transportadora, fora da cidade o cliente
    // não compra; afirmar "cobrança de entrega" para todo pedido seria a
    // tela prometendo o que não acontece.
    expect(texto()).not.toMatch(/Todos os pedidos ter[aã]o cobran[çc]a/i);
    // E a taxa aposentada não é citada como se existisse.
    expect(texto()).not.toMatch(/taxa de entrega fixa|taxa fixa/i);
  });

  it("escolher um preset mostra a consequência NA HORA (selo de não salvas), sem tocar em Salvar", async () => {
    // O sucessor do teste do interruptor: quem desliga/liga o grátis precisa
    // ver a consequência ANTES de salvar. O hero continua descrevendo o
    // config SALVO (a realidade) — por isso o selo de pendência é o que
    // avisa, na hora, que há escolha nova não salva.
    mockConfig.freeShippingMin = 0;
    await abrirTela();

    expect(texto()).not.toMatch(/altera[çc][õo]es n[ãa]o salvas/i);

    const sempre = [...hospedeiro.querySelectorAll('[role="radio"]')].find(
      (r) => /Sempre grátis/.test(r.textContent || ""),
    );
    expect(sempre).toBeDefined();
    await act(async () => {
      (sempre as HTMLElement).click();
    });
    await act(async () => {
      await esperarMicrotarefas();
    });

    expect(
      hospedeiro.querySelector('[role="radio"][aria-checked="true"]')
        ?.textContent,
    ).toMatch(/Sempre grátis/);
    expect(texto()).toMatch(/altera[çc][õo]es n[ãa]o salvas/i);
  });

  it("o hero descreve o config SALVO, não a escolha pendente — e o selo marca a diferença", async () => {
    // Se o hero lesse o formulário, a tela contaria uma realidade que ainda
    // não existe (o lojista pode desistir de salvar). O pendente tem selo.
    mockConfig.freeShippingMin = 100;
    await abrirTela();

    const hero = () =>
      hospedeiro.querySelector('[aria-label="Como a entrega funciona hoje"]')
        ?.textContent ?? "";
    expect(hero()).toContain("Acima de R$ 100");

    const sempre = [...hospedeiro.querySelectorAll('[role="radio"]')].find(
      (r) => /Sempre grátis/.test(r.textContent || ""),
    ) as HTMLElement;
    await act(async () => {
      sempre.click();
    });
    await act(async () => {
      await esperarMicrotarefas();
    });

    // Realidade salva, não a pendente:
    expect(hero()).toContain("Acima de R$ 100");
    expect(hero()).not.toContain("Em toda a loja");
    // …com o selo de que há diferença.
    expect(texto()).toMatch(/altera[çc][õo]es n[ãa]o salvas/i);
  });
});
