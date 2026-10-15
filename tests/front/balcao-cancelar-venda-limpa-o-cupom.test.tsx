// @vitest-environment jsdom
//
// Balcão — "Cancelar venda". Quando a cliente desiste no meio da conta, a
// lojista tinha de apagar item por item, e o cliente e a forma de pagamento já
// escolhidos ficavam para a PRÓXIMA venda: a venda seguinte entrava na conta da
// cliente anterior, que ainda recebia o comprovante por e-mail. Agora o cupom
// tem "Cancelar venda": pergunta antes (é um toque a menos de uma perda) e, ao
// confirmar, volta o caixa ao zero — itens, desconto, cliente, forma de
// pagamento e rascunho salvo.
//
// Molde de montagem: venda-presencial-fechamento.test.tsx (AdminPdvView real,
// máquina de estados real, leitor de câmera trocado por um botão).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { rpcMock, invokeMock, codigoBipadoRef, registrarImplRef } = vi.hoisted(
  () => ({
    rpcMock: vi.fn(),
    invokeMock: vi.fn(),
    codigoBipadoRef: { atual: "" },
    registrarImplRef: {
      atual: null as
        | ((params: any) => Promise<{ data: unknown; error: unknown }>)
        | null,
    },
  }),
);

vi.mock("@/lib/supabase", () => ({
  supabase: { rpc: rpcMock, functions: { invoke: invokeMock } },
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

vi.mock("@/components/admin/pdv/LeitorDeCodigo", () => ({
  LeitorDeCodigo: ({
    aberto,
    aoLer,
  }: {
    aberto: boolean;
    aoLer: (leitura: { codigo: string; formato: string }) => void;
  }) =>
    aberto ? (
      <button
        type="button"
        onClick={() =>
          aoLer({ codigo: codigoBipadoRef.atual, formato: "ean_13" })
        }
      >
        bipar
      </button>
    ) : null,
}));

import { AdminPdvView } from "@/views/admin/AdminPdvView";

const CHAVE_DO_RASCUNHO = "admin_pdv_venda_draft:lojista-1";

const PRODUTO_SIMPLES = {
  encontrado: true,
  origem: "produto" as const,
  codigo: "78912345",
  produto: {
    id: "produto-1",
    nome: "Camiseta Lisa",
    ativo: true,
    preco_venda: 39.9,
    estoque: 10,
    imagem: null,
    codigo_barras: "78912345",
    tem_variantes: false,
  },
  variante: null,
  preco: 39.9,
  estoque: 10,
  variacoes: [],
};

function digitarInput(id: string, valor: string): void {
  const el = document.getElementById(id) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value",
  )!.set!;
  setter.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function botao(
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

describe("Balcão — cancelar a venda limpa o cupom inteiro", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let armazem: Map<string, string>;

  beforeEach(() => {
    armazem = new Map();
    vi.stubGlobal("localStorage", {
      getItem: (chave: string) => armazem.get(chave) ?? null,
      setItem: (chave: string, valor: string) => {
        armazem.set(chave, valor);
      },
      removeItem: (chave: string) => {
        armazem.delete(chave);
      },
    });
    vi.useFakeTimers();
    rpcMock.mockReset();
    rpcMock.mockImplementation(async (nome: string, params: any) => {
      if (nome === "buscar_por_codigo_barras") {
        return { data: PRODUTO_SIMPLES, error: null };
      }
      if (nome === "registrar_venda_presencial") {
        return registrarImplRef.atual!(params);
      }
      throw new Error(`RPC inesperada: ${nome}`);
    });
    invokeMock.mockReset();
    invokeMock.mockResolvedValue({ data: { ok: true }, error: null });
    codigoBipadoRef.atual = PRODUTO_SIMPLES.codigo;
    registrarImplRef.atual = null;

    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function clicar(texto: string): Promise<void> {
    const alvo = botao(hospedeiro, texto);
    expect(alvo, `botão "${texto}" ausente`).toBeTruthy();
    await act(async () => {
      alvo!.click();
    });
    await avancar();
  }

  async function montar(): Promise<void> {
    await act(async () => {
      raiz.render(<AdminPdvView onNavigate={vi.fn()} />);
    });
    await avancar();
  }

  async function bipar(): Promise<void> {
    await clicar("bipar");
  }

  /** Cliente avulso "Fulano de Tal" escolhido pelo próprio passo da tela. */
  async function escolherClienteAvulso(): Promise<void> {
    await clicar("Cliente (opcional)");
    await clicar("Cliente avulso");
    await act(async () => {
      digitarInput("nome-do-cliente-avulso", "Fulano de Tal");
    });
    await avancar(200);
    await act(async () => {
      digitarInput("whatsapp-do-cliente-avulso", "11999998888");
    });
    await avancar(200);
    await clicar("Confirmar cliente avulso");
  }

  it("cupom vazio não oferece 'Cancelar venda' (não há o que cancelar)", async () => {
    await montar();
    expect(botao(hospedeiro, "Cancelar venda")).toBeUndefined();
  });

  it("pergunta antes e 'Voltar' deixa tudo como estava", async () => {
    await montar();
    await bipar();

    await clicar("Cancelar venda");
    expect(hospedeiro.textContent).toContain("Cancelar esta venda?");
    expect(hospedeiro.textContent).toContain(
      "Os itens e o cliente escolhido serão limpos",
    );
    // Só perguntou: nada foi limpo.
    expect(hospedeiro.textContent).toContain("Camiseta Lisa");
    // A ação padrão (foco) é a segura: "Voltar", nunca o que apaga.
    expect(document.activeElement).toBe(botao(hospedeiro, "Voltar"));

    await clicar("Voltar");
    expect(hospedeiro.textContent).not.toContain("Cancelar esta venda?");
    expect(hospedeiro.textContent).toContain("Camiseta Lisa");
    expect(botao(hospedeiro, "Cancelar venda")).toBeTruthy();
  });

  it("confirmar limpa itens, cliente, forma de pagamento e o rascunho salvo", async () => {
    await montar();
    await bipar();
    await escolherClienteAvulso();
    await clicar("Fechar venda");
    await clicar("Dinheiro");
    // Antes de cancelar: a venda está inteira e salva em disco.
    await avancar(400);
    expect(hospedeiro.textContent).toContain("Cliente: Fulano de Tal");
    expect(armazem.has(CHAVE_DO_RASCUNHO)).toBe(true);

    await clicar("Cancelar venda");
    await clicar("Sim, cancelar venda");
    await avancar(400);

    expect(hospedeiro.textContent).toContain("Bipe o primeiro produto");
    expect(hospedeiro.textContent).not.toContain("Camiseta Lisa");
    expect(hospedeiro.textContent).not.toContain("Fulano de Tal");
    expect(botao(hospedeiro, "Cliente (opcional)")).toBeTruthy();
    // Voltou para o cupom: a tela de fechar a venda saiu.
    expect(botao(hospedeiro, "Registrar venda")).toBeUndefined();
    expect(armazem.has(CHAVE_DO_RASCUNHO)).toBe(false);
    // Cancelar não registra nada no banco.
    expect(
      rpcMock.mock.calls.some(
        ([nome]) => nome === "registrar_venda_presencial",
      ),
    ).toBe(false);

    // A venda seguinte começa do zero: sem forma de pagamento escolhida.
    await bipar();
    await clicar("Fechar venda");
    expect(botao(hospedeiro, "Registrar venda")!.disabled).toBe(true);
    expect(hospedeiro.textContent).not.toContain("Fulano de Tal");
  });

  it("some o botão quando o cupom volta a ficar vazio", async () => {
    await montar();
    await bipar();
    await clicar("Cancelar venda");
    await clicar("Sim, cancelar venda");

    expect(botao(hospedeiro, "Cancelar venda")).toBeUndefined();
    expect(hospedeiro.textContent).not.toContain("Cancelar esta venda?");
  });

  it("só cliente escolhido (sem item) também pode ser cancelado", async () => {
    await montar();
    await escolherClienteAvulso();
    expect(hospedeiro.textContent).toContain("Cliente: Fulano de Tal");

    await clicar("Cancelar venda");
    await clicar("Sim, cancelar venda");

    expect(hospedeiro.textContent).not.toContain("Fulano de Tal");
    expect(botao(hospedeiro, "Cliente (opcional)")).toBeTruthy();
  });

  it("com a venda sendo gravada no banco, não dá para cancelar", async () => {
    registrarImplRef.atual = () => new Promise(() => {});
    await montar();
    await bipar();
    await clicar("Fechar venda");
    await clicar("Dinheiro");
    await clicar("Registrar venda");

    expect(botao(hospedeiro, "Cancelar venda")!.disabled).toBe(true);
  });

  it("com a pergunta já aberta, começar a gravar a venda fecha a pergunta e a tela não é zerada", async () => {
    let resolverVenda: (v: unknown) => void = () => {};
    registrarImplRef.atual = () =>
      new Promise((resolver) => {
        resolverVenda = resolver as (v: unknown) => void;
      });
    await montar();
    await bipar();
    await clicar("Cancelar venda");
    expect(hospedeiro.textContent).toContain("Cancelar esta venda?");

    await clicar("Fechar venda");
    await clicar("Dinheiro");
    await clicar("Registrar venda");

    // A venda está no ar: nada de "Sim, cancelar" para zerar a tela por cima.
    expect(botao(hospedeiro, "Sim, cancelar venda")).toBeUndefined();
    expect(hospedeiro.textContent).not.toContain("Cancelar esta venda?");
    expect(hospedeiro.textContent).toContain("Camiseta Lisa");

    await act(async () => {
      resolverVenda({
        data: {
          ja_existia: false,
          order: {
            id: "11111111-1111-1111-1111-111111111111",
            created_at: "2026-10-14T12:00:00.000Z",
            total: 39.9,
            subtotal: 39.9,
            discount: 0,
            payment_method: "cash",
            user_id: null,
            customer_name: "Venda no balcão",
            customer_data: {},
          },
          items: [
            {
              product_id: "produto-1",
              variant_id: null,
              quantity: 1,
              price: 39.9,
              product_name: "Camiseta Lisa",
            },
          ],
        },
        error: null,
      });
    });
    await avancar();
    expect(hospedeiro.textContent).toContain("Compra na loja");
  });

  it("a pergunta só diz 'Nada é registrado' quando não houve falha de envio", async () => {
    await montar();
    await bipar();
    await clicar("Cancelar venda");
    expect(hospedeiro.textContent).toContain("Nada é registrado");
    expect(hospedeiro.textContent).not.toContain(
      "Se a venda chegou a ser gravada",
    );
  });

  it("depois de uma falha de rede no envio, a pergunta não jura que nada foi registrado", async () => {
    registrarImplRef.atual = async () => {
      throw new TypeError("Failed to fetch");
    };
    await montar();
    await bipar();
    await clicar("Fechar venda");
    await clicar("Dinheiro");
    await clicar("Registrar venda");
    expect(hospedeiro.textContent).toContain(
      "Não consegui falar com o servidor",
    );

    await clicar("Cancelar venda");

    expect(hospedeiro.textContent).toContain(
      "Se a venda chegou a ser gravada, ela está em Pedidos.",
    );
    expect(hospedeiro.textContent).not.toContain("Nada é registrado");
  });

  it("depois de CONCLUIR uma venda, a seguinte não herda o cliente nem a forma de pagamento", async () => {
    registrarImplRef.atual = async () => ({
      data: {
        ja_existia: false,
        order: {
          id: "11111111-1111-1111-1111-111111111111",
          created_at: "2026-10-14T12:00:00.000Z",
          total: 39.9,
          subtotal: 39.9,
          discount: 0,
          payment_method: "cash",
          user_id: null,
          customer_name: "Fulano de Tal",
          customer_data: { whatsapp: "11999998888" },
        },
        items: [
          {
            product_id: "produto-1",
            variant_id: null,
            quantity: 1,
            price: 39.9,
            product_name: "Camiseta Lisa",
          },
        ],
      },
      error: null,
    });
    await montar();
    await bipar();
    await escolherClienteAvulso();
    await clicar("Fechar venda");
    await clicar("Dinheiro");
    await clicar("Registrar venda");
    expect(hospedeiro.textContent).toContain("Compra na loja");

    await clicar("Nova venda");

    expect(hospedeiro.textContent).toContain("Bipe o primeiro produto");
    expect(botao(hospedeiro, "Cliente (opcional)")).toBeTruthy();
    expect(hospedeiro.textContent).not.toContain("Fulano de Tal");
    await bipar();
    await clicar("Fechar venda");
    // Sem forma escolhida de novo: o "Registrar venda" nasce travado.
    expect(botao(hospedeiro, "Registrar venda")!.disabled).toBe(true);
  });
});
