// @vitest-environment jsdom
//
// Tarefa C3.2 (plano §5.3) — as seções `CupomDaVenda` e `ClienteDaVenda`,
// testadas juntas através da view fina `AdminPdvView` (que é quem injeta as
// buscas por Supabase). `LeitorDeCodigo` é mocado por um dublê com um botão
// "bipar" (molde exato pedido pela tarefa) — este arquivo não testa câmera
// nenhuma, isso é do teste de C2.3.
//
// Sem `@testing-library/react`: `createRoot` + `act` do React puro, mesmo
// padrão da casa (molde: tests/front/leitor-de-codigo-componente.test.tsx).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// `vi.hoisted` porque as duas fábricas de mock abaixo (`@/lib/supabase` e
// `@/components/admin/pdv/LeitorDeCodigo`) são IÇADAS para o topo do módulo
// pelo Vitest — sem isto, referenciar `rpcMock`/`codigoBipadoRef` dentro
// delas veria uma variável ainda não inicializada.
const { rpcMock, codigoBipadoRef } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  codigoBipadoRef: { atual: "" },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: { rpc: rpcMock },
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { storeName: "Loja Teste" } }),
}));

// O dublê pedido pela tarefa: um botão "bipar" que chama `aoLer` com o
// código que o teste armou em `codigoBipadoRef` — a tela não precisa de
// câmera nenhuma para ser testada.
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

// Importado DEPOIS dos `vi.mock` acima (içados de qualquer forma, mas a
// ordem de leitura humana segue a convenção da casa).
import { AdminPdvView } from "@/views/admin/AdminPdvView";

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

const CODIGO_NAO_CADASTRADO = {
  encontrado: false,
  origem: null,
  codigo: "00000",
  produto: null,
  variante: null,
  preco: null,
  estoque: null,
  variacoes: [],
};

const PRODUTO_COM_VARIACOES = {
  encontrado: true,
  origem: "produto" as const,
  codigo: "55555",
  produto: {
    id: "produto-2",
    nome: "Camiseta Estampada",
    ativo: true,
    preco_venda: 49.9,
    estoque: 0,
    imagem: null,
    codigo_barras: "55555",
    tem_variantes: true,
  },
  variante: null,
  preco: 49.9,
  estoque: 0,
  variacoes: [
    {
      variant_id: "variante-p",
      nome: "Tamanho",
      valor: "P",
      preco: 49.9,
      estoque: 5,
      imagem: null,
      codigo_barras: null,
    },
    {
      variant_id: "variante-m",
      nome: "Tamanho",
      valor: "M",
      preco: 52,
      estoque: 3,
      imagem: null,
      codigo_barras: null,
    },
  ],
};

const CLIENTE_ENCONTRADO = {
  id: "cliente-1",
  full_name: "Maria Cliente",
  whatsapp: "11999999999",
  email: "maria@example.com",
};

function respostaDoCodigo(codigo: string) {
  if (codigo === PRODUTO_SIMPLES.codigo) return PRODUTO_SIMPLES;
  if (codigo === PRODUTO_COM_VARIACOES.codigo) return PRODUTO_COM_VARIACOES;
  return { ...CODIGO_NAO_CADASTRADO, codigo };
}

function digitarInput(id: string, valor: string): void {
  const el = document.getElementById(id) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value",
  )!.set!;
  setter.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
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

async function bipar(codigo: string): Promise<void> {
  codigoBipadoRef.atual = codigo;
  const botao = localizarBotaoPorTexto(document.body, "bipar")!;
  await act(async () => {
    botao.click();
  });
  await avancar();
}

describe("AdminPdvView — CupomDaVenda e ClienteDaVenda (C3.2)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  // O localStorage global deste runner (Node >= 25 traz o experimental do
  // Node por cima do do jsdom) não tem clear/removeItem confiáveis — o
  // rascunho do `useVendaPresencial` é limpo num dublê Map-based, o MESMO
  // padrão dos outros testes da casa.
  let armazem: Map<string, string>;

  beforeEach(() => {
    // Cada teste começa com um cupom NOVO — sem isto, o rascunho gravado
    // por `useVendaPresencial` (C3.1) no `localStorage` de um teste
    // anterior seria restaurado no próximo mount (F5 é para o lojista, não
    // para o teste seguinte).
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
        return { data: respostaDoCodigo(params.p_codigo), error: null };
      }
      if (nome === "get_admin_customers_paged") {
        const termo = (params.p_search as string).toLowerCase();
        const linhas = termo.includes("maria") ? [CLIENTE_ENCONTRADO] : [];
        return { data: { data: linhas }, error: null };
      }
      if (nome === "get_admin_products_paged") {
        return { data: { data: [] }, error: null };
      }
      throw new Error(`RPC não mockada neste teste: ${nome}`);
    });

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

  async function montar(): Promise<void> {
    await act(async () => {
      raiz.render(<AdminPdvView onNavigate={vi.fn()} active />);
    });
    await avancar();
  }

  it("caso 1 — bipar código conhecido mostra o item, o preço e o subtotal", async () => {
    await montar();

    await bipar(PRODUTO_SIMPLES.codigo);

    expect(hospedeiro.textContent).toContain("Camiseta Lisa");
    expect(hospedeiro.textContent).toContain("39,90");
    // Um item, quantidade 1: subtotal do cupom == preço do item.
    const ocorrencias = hospedeiro.textContent?.match(/39,90/g) ?? [];
    expect(ocorrencias.length).toBeGreaterThanOrEqual(2); // preço unitário + subtotal
  });

  it("caso 2 — bipar de novo o mesmo código soma quantidade (fora da janela de repetição)", async () => {
    await montar();

    await bipar(PRODUTO_SIMPLES.codigo);
    // Mais que JANELA_DE_REPETICAO_MS (1500ms) para não cair na guarda de
    // "leitura repetida" — é outra unidade do mesmo produto, não um eco.
    await avancar(2000);
    await bipar(PRODUTO_SIMPLES.codigo);

    expect(hospedeiro.textContent).toContain("79,80"); // 2 × 39,90
    // Uma linha só na lista (mesma chave), não duas.
    const linhas = hospedeiro.querySelectorAll("li");
    expect(linhas.length).toBe(1);
  });

  it("caso 3 — código não cadastrado mostra o cartão de cadastro e NÃO põe item", async () => {
    await montar();

    await bipar("00000");

    expect(hospedeiro.textContent).toContain("não está cadastrado");
    expect(
      localizarBotaoPorTexto(hospedeiro, "Cadastrar produto"),
    ).toBeTruthy();
    expect(hospedeiro.textContent).toContain("Bipe o primeiro produto");
  });

  it("caso 4 — produto com variações abre a folha e escolher a combinação põe o item com a variação no nome", async () => {
    await montar();

    await bipar(PRODUTO_COM_VARIACOES.codigo);

    expect(hospedeiro.textContent).toContain("Qual combinação");
    const botaoP = localizarBotaoPorTexto(hospedeiro, "Tamanho P")!;
    expect(botaoP).toBeTruthy();

    await act(async () => {
      botaoP.click();
    });
    await avancar();

    expect(hospedeiro.textContent).not.toContain("Qual combinação");
    expect(hospedeiro.textContent).toContain("Camiseta Estampada");
    expect(hospedeiro.textContent).toContain("Tamanho P");
  });

  it("caso 5 — '−' em quantidade 1 remove o item", async () => {
    await montar();
    await bipar(PRODUTO_SIMPLES.codigo);
    expect(hospedeiro.textContent).toContain("Camiseta Lisa");

    const botaoMenos = hospedeiro.querySelector(
      'button[aria-label="Diminuir quantidade de Camiseta Lisa"]',
    ) as HTMLButtonElement;
    expect(botaoMenos).toBeTruthy();

    await act(async () => {
      botaoMenos.click();
    });
    await avancar();

    expect(hospedeiro.textContent).toContain("Bipe o primeiro produto");
    expect(hospedeiro.querySelectorAll("li").length).toBe(0);
  });

  it("caso 6 — busca de cliente lista e escolher preenche o cliente", async () => {
    await montar();

    const botaoCliente = localizarBotaoPorTexto(
      hospedeiro,
      "Cliente (opcional)",
    )!;
    await act(async () => {
      botaoCliente.click();
    });
    await avancar();

    const botaoBuscar = localizarBotaoPorTexto(hospedeiro, "Buscar cliente")!;
    await act(async () => {
      botaoBuscar.click();
    });
    await avancar();

    await act(async () => {
      digitarInput("busca-de-cliente-do-balcao", "maria");
    });
    await avancar(300);

    expect(hospedeiro.textContent).toContain("Maria Cliente");
    const botaoResultado = localizarBotaoPorTexto(hospedeiro, "Maria Cliente")!;

    await act(async () => {
      botaoResultado.click();
    });
    await avancar();

    // Escolher volta para o cupom (picker) e o botão de cliente reflete a
    // escolha.
    expect(hospedeiro.textContent).toContain("Cliente: Maria Cliente");
  });

  it("caso 7 — cliente avulso com WhatsApp inválido avisa mas não bloqueia", async () => {
    await montar();

    const botaoCliente = localizarBotaoPorTexto(
      hospedeiro,
      "Cliente (opcional)",
    )!;
    await act(async () => {
      botaoCliente.click();
    });
    await avancar();

    const botaoAvulso = localizarBotaoPorTexto(hospedeiro, "Cliente avulso")!;
    await act(async () => {
      botaoAvulso.click();
    });
    await avancar();

    await act(async () => {
      digitarInput("nome-do-cliente-avulso", "Fulano de Tal");
    });
    await avancar(200);
    await act(async () => {
      digitarInput("whatsapp-do-cliente-avulso", "123");
    });
    await avancar(200);

    expect(hospedeiro.textContent).toContain("não abre conversa no WhatsApp");

    const botaoConfirmar = localizarBotaoPorTexto(
      hospedeiro,
      "Confirmar cliente avulso",
    ) as HTMLButtonElement;
    expect(botaoConfirmar.disabled).toBe(false);

    await act(async () => {
      botaoConfirmar.click();
    });
    await avancar();

    expect(hospedeiro.textContent).toContain("Cliente: Fulano de Tal");
  });
});
