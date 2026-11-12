// @vitest-environment jsdom
//
// Rede "pendurada" (conecta e não responde) na lista de Produtos:
//
// 1. Duplicar: a cópia de cada foto no armazenamento esperava sem prazo, e o
//    diálogo ficava preso em "Duplicando…" (Cancelar e Duplicar desativados)
//    até o navegador desistir da conexão. Agora cada cópia tem prazo, e o
//    estouro vira o erro "sem resposta" que a tela traduz (a frase NÃO diz que
//    falhou nem que deu certo: a cópia pode já existir).
// 2. Ler a lista: a consulta da página não tinha prazo; a tela ficava em
//    "Recarregando…" ou no esqueleto cinza para sempre, sem erro e sem o botão
//    "Tentar Novamente". Agora o estouro devolve `null` — o mesmo desfecho de
//    qualquer falha de leitura, que a tela já desenha como "Erro ao Carregar
//    Produtos" com o botão.
//
// O prazo só encerra a ESPERA DA TELA. Hook REAL, Supabase simulado, relógio
// simulado. (O lado da tela — soltar o diálogo e o texto — está em
// admin-products-duplicar-sem-resposta-solta-o-dialogo.test.tsx.)
import { copiarImagemParaDuplicacao, useProducts } from "@/hooks/useProducts";
import {
  MENSAGEM_PRODUTO_DUPLICAR_SEM_RESPOSTA,
  PRAZO_DA_CONSULTA_DO_PAINEL_MS,
  PRAZO_DE_COPIAR_A_FOTO_PARA_DUPLICAR_MS,
  ehConsultaSemResposta,
} from "@/lib/prazo-da-requisicao";
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const banco = vi.hoisted(() => ({
  rpc: vi.fn(),
  copy: vi.fn(),
  erro: vi.fn(),
  sucesso: vi.fn(),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ isAdmin: true, user: { id: "u-1" } }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    products: [],
    loadingProducts: false,
    fetchProducts: vi.fn(),
  }),
}));
vi.mock("@/hooks/useAnalytics", () => ({ clearAnalyticsCache: vi.fn() }));
vi.mock("@/lib/mappers", () => ({
  mapProductFromDB: (linha: any) => ({
    ...linha,
    variants: linha.product_variants ?? [],
  }),
}));
vi.mock("sonner", () => ({
  toast: { success: banco.sucesso, error: banco.erro },
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: (...args: unknown[]) => ({
      abortSignal: () => banco.rpc(...args),
    }),
    auth: { refreshSession: vi.fn() },
    storage: {
      from: () => ({
        copy: banco.copy,
        getPublicUrl: () => ({
          data: {
            publicUrl:
              "https://loja.test/storage/v1/object/public/products/a_copia_x.jpg",
          },
        }),
      }),
    },
  },
}));

// @ts-expect-error flag interna do React.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const FOTO = "https://loja.test/storage/v1/object/public/products/a.jpg";
const PENDURADO = () => new Promise<never>(() => {});

let api: ReturnType<typeof useProducts>;
let raiz: Root;
let host: HTMLDivElement;
function Sonda() {
  const produtos = useProducts({ autoFetch: false });
  useEffect(() => {
    api = produtos;
  });
  return null;
}

/** Dispara a ação e devolve como ela terminou (resolve, rejeita ou pendura). */
function disparar<T>(acao: () => Promise<T>) {
  const desfecho: { settled: boolean; valor?: T; erro?: unknown } = {
    settled: false,
  };
  acao().then(
    (valor) => {
      desfecho.settled = true;
      desfecho.valor = valor;
    },
    (erro: unknown) => {
      desfecho.settled = true;
      desfecho.erro = erro;
    },
  );
  return desfecho;
}

async function passar(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("Duplicar: a cópia de cada foto tem prazo", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("a cópia pendurada solta no prazo com o erro 'sem resposta' e a frase de conferir a lista", async () => {
    banco.copy.mockImplementation(PENDURADO);
    const desfecho = disparar(() => copiarImagemParaDuplicacao(FOTO));

    await passar(PRAZO_DE_COPIAR_A_FOTO_PARA_DUPLICAR_MS - 1);
    expect(desfecho.settled).toBe(false);
    await passar(1);

    expect(desfecho.settled).toBe(true);
    expect(ehConsultaSemResposta(desfecho.erro)).toBe(true);
    expect((desfecho.erro as Error).message).toBe(
      MENSAGEM_PRODUTO_DUPLICAR_SEM_RESPOSTA,
    );
    // Diz a verdade da etapa (fotos vêm antes de gravar): nada foi criado; repetir é seguro.
    expect(MENSAGEM_PRODUTO_DUPLICAR_SEM_RESPOSTA).toMatch(
      /ainda não foi duplicado/i,
    );
    expect(MENSAGEM_PRODUTO_DUPLICAR_SEM_RESPOSTA).not.toMatch(/deu certo/i);
  });

  it("resposta um instante ANTES do prazo é cópia normal (sem falso estouro)", async () => {
    banco.copy.mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(
            () => resolve({ data: { path: "x" }, error: null }),
            PRAZO_DE_COPIAR_A_FOTO_PARA_DUPLICAR_MS - 1,
          ),
        ),
    );
    const desfecho = disparar(() => copiarImagemParaDuplicacao(FOTO));
    await passar(PRAZO_DE_COPIAR_A_FOTO_PARA_DUPLICAR_MS - 1);

    expect(desfecho.erro).toBeUndefined();
    expect(desfecho.valor).toContain("a_copia_x.jpg");
  });

  it("a cópia que FALHA de verdade continua lançando o erro do storage (não vira 'sem resposta')", async () => {
    banco.copy.mockResolvedValue({
      data: null,
      error: { message: "storage/unexpected_failure" },
    });
    const desfecho = disparar(() => copiarImagemParaDuplicacao(FOTO));
    await passar(0);

    expect(desfecho.settled).toBe(true);
    expect(ehConsultaSemResposta(desfecho.erro)).toBe(false);
    expect((desfecho.erro as Error).message).toMatch(
      /storage\/unexpected_failure/,
    );
  });

  it("foto sem arquivo nosso atrás volta como está, sem prazo nem storage", async () => {
    const desfecho = disparar(() =>
      copiarImagemParaDuplicacao("https://placehold.co/600x400.png"),
    );
    await passar(0);
    expect(desfecho.valor).toBe("https://placehold.co/600x400.png");
    expect(banco.copy).not.toHaveBeenCalled();
    // Nada de relógio sobrando depois da cópia terminar.
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("Lista de Produtos: a leitura da página tem prazo", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    localStorage.clear();
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    vi.spyOn(console, "error").mockImplementation(() => {});
    host = document.createElement("div");
    document.body.appendChild(host);
    raiz = createRoot(host);
    await act(async () => raiz.render(<Sonda />));
  });
  afterEach(() => {
    act(() => raiz.unmount());
    host.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  const pagina = (nomes: string[]) => ({
    data: { data: nomes.map((id) => ({ id })), total_count: nomes.length },
    error: null,
  });

  it("a consulta pendurada solta no prazo: devolve null (a tela mostra o erro com 'Tentar Novamente') e o 'carregando' desliga", async () => {
    banco.rpc.mockImplementation(PENDURADO);
    const desfecho = disparar(() => api.loadProducts(0, 12, {}));
    await passar(0);
    expect(api.loading).toBe(true);

    await passar(PRAZO_DA_CONSULTA_DO_PAINEL_MS - 1);
    expect(desfecho.settled).toBe(false);
    await passar(1);

    expect(desfecho.settled).toBe(true);
    expect(desfecho.erro).toBeUndefined();
    expect(desfecho.valor).toBeNull();
    expect(api.loading).toBe(false);
    expect(banco.erro).toHaveBeenCalledWith("Erro ao listar produtos");
  });

  it("a leitura silenciosa (recarga de fundo) pendurada também solta, sem toast", async () => {
    banco.rpc.mockImplementation(PENDURADO);
    const desfecho = disparar(() => api.loadProducts(0, 12, { silent: true }));
    await passar(PRAZO_DA_CONSULTA_DO_PAINEL_MS);

    expect(desfecho.settled).toBe(true);
    expect(desfecho.valor).toBeNull();
    expect(banco.erro).not.toHaveBeenCalled();
  });

  it("resposta um instante ANTES do prazo é leitura normal (sem falso estouro)", async () => {
    banco.rpc.mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(
            () => resolve(pagina(["a", "b"])),
            PRAZO_DA_CONSULTA_DO_PAINEL_MS - 1,
          ),
        ),
    );
    const desfecho = disparar(() => api.loadProducts(0, 12, {}));
    await passar(PRAZO_DA_CONSULTA_DO_PAINEL_MS - 1);

    expect(desfecho.valor).toMatchObject({ total: 2 });
    expect(banco.erro).not.toHaveBeenCalled();
  });

  it("a leitura velha que estoura depois de uma mais nova ter vencido não avisa nem toca no 'carregando'", async () => {
    // 1ª leitura pendura; 2ª (busca nova) responde na hora e vence.
    banco.rpc.mockImplementationOnce(PENDURADO);
    banco.rpc.mockResolvedValueOnce(pagina(["x"]));
    const primeira = disparar(() => api.loadProducts(0, 12, {}));
    await passar(0);
    const segunda = disparar(() => api.loadProducts(0, 12, { search: "x" }));
    await passar(0);
    expect(segunda.valor).toMatchObject({ total: 1 });
    expect(api.loading).toBe(false);

    await passar(PRAZO_DA_CONSULTA_DO_PAINEL_MS);

    expect(primeira.settled).toBe(true);
    expect(primeira.valor).toBeNull();
    // O aviso de erro seria sobre uma leitura que já não importa.
    expect(banco.erro).not.toHaveBeenCalled();
    expect(api.loading).toBe(false);
  });
});
