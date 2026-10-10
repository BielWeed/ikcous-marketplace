// @vitest-environment jsdom
//
// O SKU da VARIAÇÃO é único na loja inteira (`product_variants_sku_key`). O
// cadastro de produto NOVO já conferia os SKUs antes de gravar; a EDIÇÃO não:
// `upsertVariants` mandava o lote e, se um SKU já era de outro produto, o
// banco recusava com uma frase genérica no fim do salvar. Agora `upsertVariants`
// confere antes de gravar qualquer linha — e sabe que as variações que ELE MESMO
// vai regravar já têm o SKU delas no banco (`ignorarProdutoId`: o produto não
// pode ser recusado por causa dele mesmo).
//
// As bordas que este arquivo prova:
//  - variação já salva, com o SKU que ela mesma tem no banco: NÃO é recusada
//    (sem isso, toda edição de produto com SKU recusaria a si mesma);
//  - SKU de variação NOVA que é de outro produto: recusa antes de gravar nada,
//    dizendo o SKU e de quem é;
//  - SKU de uma irmã do MESMO produto que não está no lote: continua recusado
//    (ignorar o produto inteiro deixaria isso passar para o 23505 do banco);
//  - dois SKUs iguais no próprio lote; produto excluído que reserva o SKU;
//  - consulta que falha NÃO bloqueia; variação sem SKU nem consulta.
//
// Mesmo molde de use-products-sku-de-variacao-repetido-diz-o-motivo.test.tsx:
// o dublê de `@/lib/supabase` OBSERVA cada chamada, em ordem.
import { useProducts } from "@/hooks/useProducts";
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Chamada = {
  tabela: string;
  op: "insert" | "upsert" | "select";
  payload: unknown;
};

const mock = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  fetchProductsContext: vi.fn().mockResolvedValue(undefined),
  chamadas: [] as Chamada[],
  consultaDeSku: { data: [], error: null } as { data: unknown; error: unknown },
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ isAdmin: true }),
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    products: [],
    loadingProducts: false,
    fetchProducts: mock.fetchProductsContext,
  }),
}));

vi.mock("@/lib/mappers", () => ({
  mapProductFromDB: (row: unknown) => row,
  mapVariantFromDB: (row: unknown) => row,
}));

vi.mock("sonner", () => ({
  toast: {
    success: mock.toastSuccess,
    error: mock.toastError,
    loading: vi.fn(),
  },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => ({
      select: (colunas: string) => {
        mock.chamadas.push({ tabela, op: "select", payload: colunas });
        const resposta = Promise.resolve(mock.consultaDeSku);
        return Object.assign(resposta, { in: () => resposta });
      },
      insert: (payload: unknown) => {
        mock.chamadas.push({ tabela, op: "insert", payload });
        return Promise.resolve({ error: null });
      },
      upsert: (payload: unknown) => {
        mock.chamadas.push({ tabela, op: "upsert", payload });
        return Promise.resolve({ error: null });
      },
    }),
    auth: { refreshSession: vi.fn() },
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type ApiUseProducts = ReturnType<typeof useProducts>;

function Sonda({ onReady }: { onReady: (api: ApiUseProducts) => void }) {
  const api = useProducts({ autoFetch: false });
  useEffect(() => {
    onReady(api);
  });
  return null;
}

const chamadasDe = (op: Chamada["op"]) =>
  mock.chamadas.filter((c) => c.tabela === "product_variants" && c.op === op);

// A variação JÁ SALVA do produto em edição (id real) e uma nova (id temp-).
const salva = (id: string, sku: string) => ({
  id,
  productId: "prod-1",
  name: "Tamanho",
  value: id,
  sku,
  stockIncrement: 1,
  active: true,
});
const nova = (value: string, sku?: string) => ({
  id: `temp-${value}`,
  productId: "prod-1",
  name: "Tamanho",
  value,
  sku,
  stockIncrement: 1,
  active: true,
});

describe("useProducts.upsertVariants -- SKU conferido na EDIÇÃO, antes de gravar", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let apiRef: ApiUseProducts | undefined;
  let consoleSpies: Array<ReturnType<typeof vi.spyOn>>;

  beforeEach(() => {
    vi.clearAllMocks();
    mock.fetchProductsContext.mockResolvedValue(undefined);
    mock.chamadas.length = 0;
    mock.consultaDeSku = { data: [], error: null };
    apiRef = undefined;
    consoleSpies = [
      vi.spyOn(console, "error").mockImplementation(() => {}),
      vi.spyOn(console, "warn").mockImplementation(() => {}),
    ];
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    for (const espiao of consoleSpies) espiao.mockRestore();
  });

  async function salvar(lote: unknown[]) {
    await act(async () => {
      raiz.render(
        <Sonda
          onReady={(api) => {
            apiRef = api;
          }}
        />,
      );
    });
    let erro: unknown;
    let resultado: unknown;
    await act(async () => {
      try {
        resultado = await apiRef?.upsertVariants("prod-1", lote);
      } catch (e) {
        erro = e;
      }
    });
    return { erro, resultado };
  }

  it("a variação já salva, com o SKU que ELA MESMA tem no banco, NÃO é recusada", async () => {
    mock.consultaDeSku = {
      data: [
        {
          id: "v-p",
          sku: "CAM-P",
          product_id: "prod-1",
          produtos: { nome: "Camiseta", deleted_at: null },
        },
      ],
      error: null,
    };
    const { erro } = await salvar([salva("v-p", "CAM-P")]);

    expect(erro).toBeUndefined();
    expect(mock.toastError).not.toHaveBeenCalled();
    expect(chamadasDe("upsert")).toHaveLength(1);
  });

  it("SKU de variação NOVA que já é de OUTRO produto: recusa antes de gravar, dizendo o SKU e de quem é", async () => {
    mock.consultaDeSku = {
      data: [
        {
          id: "v-outro",
          sku: "CAM-G",
          product_id: "prod-2",
          produtos: { nome: "Camiseta Antiga", deleted_at: null },
        },
      ],
      error: null,
    };
    const { erro } = await salvar([salva("v-p", "CAM-P"), nova("G", "CAM-G")]);

    expect(erro).toBeDefined();
    // NADA foi gravado: nem a fase das existentes, nem a das novas.
    expect(chamadasDe("upsert")).toHaveLength(0);
    expect(chamadasDe("insert")).toHaveLength(0);
    const [frase] = mock.toastError.mock.calls[0] as [string];
    expect(frase).toContain("CAM-G");
    expect(frase).toContain("Camiseta Antiga");
  });

  it("SKU de uma irmã do MESMO produto que NÃO está no lote continua recusado", async () => {
    // "v-irma" é do produto em edição mas não vai ser regravada por este lote:
    // o SKU dela segue ocupado depois do salvar. Ignorar o produto inteiro
    // deixaria isto passar e o banco recusaria no fim, com frase genérica.
    mock.consultaDeSku = {
      data: [
        {
          id: "v-irma",
          sku: "CAM-M",
          product_id: "prod-1",
          produtos: { nome: "Camiseta", deleted_at: null },
        },
      ],
      error: null,
    };
    const { erro } = await salvar([nova("M2", "CAM-M")]);

    expect(erro).toBeDefined();
    expect(chamadasDe("insert")).toHaveLength(0);
    const [frase] = mock.toastError.mock.calls[0] as [string];
    expect(frase).toContain("CAM-M");
  });

  it("dois SKUs iguais no PRÓPRIO lote: recusa antes de gravar, sem consultar o banco", async () => {
    const { erro } = await salvar([nova("P", "CAM"), nova("M", "CAM")]);

    expect(erro).toBeDefined();
    expect(chamadasDe("select")).toHaveLength(0);
    expect(chamadasDe("insert")).toHaveLength(0);
    const [frase] = mock.toastError.mock.calls[0] as [string];
    expect(frase).toContain("CAM");
    expect(frase).toMatch(/mais de uma varia/i);
  });

  it("SKU preso a produto EXCLUÍDO: diz que o SKU segue reservado", async () => {
    mock.consultaDeSku = {
      data: [
        {
          id: "v-velha",
          sku: "CAM-G",
          product_id: "prod-apagado",
          produtos: {
            nome: "Camiseta Velha",
            deleted_at: "2026-09-01T10:00:00Z",
          },
        },
      ],
      error: null,
    };
    const { erro } = await salvar([nova("G", "CAM-G")]);

    expect(erro).toBeDefined();
    expect(chamadasDe("insert")).toHaveLength(0);
    const [frase] = mock.toastError.mock.calls[0] as [string];
    expect(frase).toMatch(/exclu[ií]d/i);
  });

  it("a consulta de SKU falhou (rede): NÃO bloqueia, o salvar segue", async () => {
    mock.consultaDeSku = {
      data: null,
      error: { code: "57014", message: "canceling statement due to timeout" },
    };
    const { erro } = await salvar([nova("G", "CAM-G")]);

    expect(erro).toBeUndefined();
    expect(chamadasDe("insert")).toHaveLength(1);
  });

  it("variações SEM SKU não colidem e nem consultam o banco", async () => {
    const { erro } = await salvar([nova("P", ""), nova("M", undefined)]);

    expect(erro).toBeUndefined();
    expect(chamadasDe("select")).toHaveLength(0);
    expect(chamadasDe("insert")).toHaveLength(1);
  });

  it("lote vazio não consulta nem grava", async () => {
    const { erro } = await salvar([]);

    expect(erro).toBeUndefined();
    expect(chamadasDe("select")).toHaveLength(0);
    expect(chamadasDe("insert")).toHaveLength(0);
    expect(chamadasDe("upsert")).toHaveLength(0);
  });
});
