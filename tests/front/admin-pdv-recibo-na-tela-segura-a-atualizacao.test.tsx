// @vitest-environment jsdom
//
// Recibo da venda do balcão na tela + atualização do app esperando.
//
// O DEFEITO: depois de registrar a venda, `dirty` cai de propósito (o recibo
// não é "venda em aberto" e não pode reativar o aviso de sair da página). Só
// que o recibo vive SÓ em memória: a lojista toca em "Enviar por WhatsApp", o
// app vai para segundo plano (ponto de parada do momento seguro), a
// atualização que estava esperando se instala e recarrega, e o recibo some
// antes de ser enviado/impresso. Agora, enquanto o recibo está na tela, a
// view marca uma operação sensível ("recibo-do-pdv") — a atualização espera
// até "Nova venda" (ou até a tela ser fechada).
//
// Molde: tests/front/admin-pdv-recibo-cliente-cadastrada-sem-nome.test.tsx.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { rpcMock, invokeMock, fromMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  invokeMock: vi.fn(),
  fromMock: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: rpcMock,
    from: fromMock,
    functions: { invoke: invokeMock },
  },
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { storeName: "Loja Teste" } }),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "lojista-1" }, isAdmin: true }),
}));

import {
  estadoInicialDaVenda,
  serializarRascunho,
} from "@/hooks/useVendaPresencial";
import { decidirMomentoSeguro } from "@/lib/atualizacao/momento-seguro";
import {
  haOperacaoSensivel,
  motivosDeOperacaoSensivel,
} from "@/lib/atualizacao/operacao-sensivel";
import { AdminPdvView } from "@/views/admin/AdminPdvView";

const ITEM = {
  chave: "produto-1::",
  productId: "produto-1",
  variantId: null,
  nome: "Camiseta",
  variacao: null,
  preco: 40,
  quantidade: 1,
  estoque: 10,
  imagem: "",
};

const GRAVADO = {
  id: "item-1",
  product_id: "produto-1",
  variant_id: null,
  quantity: 1,
  price: 40,
  product_name: "Camiseta",
};

function respostaDaVenda() {
  return {
    ja_existia: false,
    order: {
      id: "99999999-9999-9999-9999-999999999999",
      created_at: "2026-09-17T12:00:00.000Z",
      total: 40,
      subtotal: 40,
      discount: 0,
      payment_method: "cash" as const,
      user_id: null,
      customer_name: "Venda no balcão",
      customer_data: null,
    },
    items: [GRAVADO],
  };
}

function localizarBotaoPorTexto(
  raizDom: ParentNode,
  texto: string,
): HTMLButtonElement | undefined {
  return [...raizDom.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  ) as HTMLButtonElement | undefined;
}

async function avancar(ms = 0): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);
  });
}

describe("AdminPdvView — o recibo na tela segura a atualização do app", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let onSetDirty: ReturnType<typeof vi.fn<(dirty: boolean) => void>>;

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    rpcMock.mockReset();
    rpcMock.mockImplementation(async (nome: string) => {
      if (nome === "registrar_venda_presencial") {
        return { data: respostaDaVenda(), error: null };
      }
      throw new Error(`RPC inesperada: ${nome}`);
    });
    invokeMock.mockReset();
    invokeMock.mockResolvedValue({ data: { ok: true }, error: null });
    fromMock.mockReset();
    onSetDirty = vi.fn<(dirty: boolean) => void>();
    localStorage.setItem(
      "admin_pdv_venda_draft:lojista-1",
      serializarRascunho({
        ...estadoInicialDaVenda(() => "chave-da-venda-teste"),
        etapa: "fechamento",
        itens: [ITEM],
        pagamento: "cash",
      }),
    );
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    localStorage.clear();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function montarERegistrar() {
    await act(async () => {
      raiz.render(
        <AdminPdvView onNavigate={vi.fn()} onSetDirty={onSetDirty} />,
      );
    });
    await avancar();
    await act(async () => {
      localizarBotaoPorTexto(hospedeiro, "Registrar venda")!.click();
    });
    await avancar();
  }

  const reciboNaTela = () =>
    document.querySelector("[data-tema-fixo]") !== null;

  it("controle: com a venda ainda em montagem (sem recibo) não há operação sensível do recibo", async () => {
    await act(async () => {
      raiz.render(
        <AdminPdvView onNavigate={vi.fn()} onSetDirty={onSetDirty} />,
      );
    });
    await avancar();

    expect(reciboNaTela()).toBe(false);
    expect(motivosDeOperacaoSensivel()).not.toContain("recibo-do-pdv");
  });

  it("com o recibo na tela: há operação sensível e o app em segundo plano NÃO instala a atualização", async () => {
    await montarERegistrar();

    expect(reciboNaTela()).toBe(true);
    expect(haOperacaoSensivel()).toBe(true);
    expect(motivosDeOperacaoSensivel()).toContain("recibo-do-pdv");

    // O cenário do achado: a lojista tocou em "Enviar por WhatsApp", o app
    // foi para segundo plano, `dirty` está falso (de propósito).
    const decisao = decidirMomentoSeguro({
      view: "admin-pdv",
      adminDirty: false,
      pedidoPendenteDoCheckout: false,
      documentoOculto: true,
      trocouDeTela: false,
    });
    expect(decisao.instalarAgora).toBe(false);
    expect(decisao.livre).toBe(false);
    expect(decisao.bloqueio).toBe("operacao-sensivel");
  });

  it("o recibo NÃO reativa o aviso de sair da página: dirty continua falso depois da venda", async () => {
    await montarERegistrar();

    expect(reciboNaTela()).toBe(true);
    // O balcão não liga o aviso de "alterações não salvas" em momento nenhum
    // (nem com a venda em montagem, nem com o recibo na tela).
    const chamadas = onSetDirty.mock.calls.map((c) => c[0]);
    expect(chamadas).not.toContain(true);
  });

  it("'Nova venda' solta a marca: a atualização pode instalar de novo", async () => {
    await montarERegistrar();
    expect(haOperacaoSensivel()).toBe(true);

    await act(async () => {
      localizarBotaoPorTexto(hospedeiro, "Nova venda")!.click();
    });
    await avancar();

    expect(reciboNaTela()).toBe(false);
    expect(haOperacaoSensivel()).toBe(false);
    expect(
      decidirMomentoSeguro({
        view: "admin-pdv",
        adminDirty: false,
        pedidoPendenteDoCheckout: false,
        documentoOculto: true,
        trocouDeTela: false,
      }).instalarAgora,
    ).toBe(true);
  });

  it("fechar a tela com o recibo aberto solta a marca (nunca fica presa)", async () => {
    await montarERegistrar();
    expect(haOperacaoSensivel()).toBe(true);

    act(() => {
      raiz.unmount();
    });
    // O afterEach desmonta de novo: recria a raiz para ele não reclamar.
    raiz = createRoot(hospedeiro);

    expect(haOperacaoSensivel()).toBe(false);
  });
});
