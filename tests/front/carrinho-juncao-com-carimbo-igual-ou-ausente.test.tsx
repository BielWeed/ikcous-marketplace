// @vitest-environment jsdom
//
// Caça de provas fracas (carrinho, 24/11/2026): a junção do carrinho do
// aparelho com o do banco decide "quem escreveu por último vence" comparando
// carimbos de hora, e nenhum teste olhava os EMPATES nem a linha SEM carimbo.
// Seis trocas de operador/valor nessa conta (`>=` por `>`, `0` por `agora`...)
// passavam a suíte inteira. O que isto protege, na conta salva:
//   - carimbo IGUAL (local e banco): vale o que está aqui, e a cliente não vê
//     a quantidade voltar para a do banco;
//   - linha do banco SEM hora (updated_at nulo) é a mais velha de todas: não
//     ganha da quantidade que a cliente acabou de mexer aqui;
//   - linha adotada do banco que veio sem hora ganha uma hora de verdade (senão
//     qualquer lápide antiga a esconderia na próxima junção);
//   - lápide EMPATADA com a hora da linha não a apaga (a linha vale, a lápide
//     só vale se for mais nova);
//   - a lápide gravada por outra aba vale também quando o carrinho daqui e o
//     do banco são idênticos: o produto que a outra aba tirou sai daqui.
//
// 27/11/2026: a hora do aparelho deixou de decidir entre a linha daqui e a do
// banco (o relógio de um aparelho adiantado fazia a edição do outro sumir; ver
// carrinho-dois-aparelhos-com-relogios-diferentes.test.tsx). Decide se a linha
// foi MEXIDA aqui desde a última conversa com o banco. O "controle" abaixo
// passou a provar isso; os casos de lápide sem `confirmada` (formato de antes)
// seguem a regra antiga até a próxima gravação confirmá-las.
import { CartProvider, useCartContext } from "@/contexts/CartContext";
import { mapProductFromDB } from "@/lib/mappers";
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { comPaginacao } from "./duble-consulta-paginada";

const mundo = vi.hoisted(() => ({
  itens: [] as Record<string, unknown>[],
  rpc: vi.fn(),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { shippingFee: 0, freeShippingMin: 0 } }),
}));
const usuario = { id: "u1" };
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: usuario, loading: false }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: true }),
}));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));
const produtos = [
  { id: "p1", nome: "Camiseta", preco_venda: 10, estoque: 20 },
  { id: "p2", nome: "Bermuda", preco_venda: 30, estoque: 20 },
].map((p) => ({ ...p, ativo: true, imagens: [] }));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => ({
      select: () => ({
        eq: async () => ({ data: mundo.itens.slice(), error: null }),
        in: comPaginacao(async (_coluna: string, ids: string[]) =>
          tabela === "product_variants"
            ? { data: [], error: null }
            : {
                data: produtos.filter((p) => ids.includes(p.id)),
                error: null,
              },
        ),
      }),
    }),
    auth: {
      getSession: async () => ({ data: { session: { user: usuario } } }),
    },
    rpc: mundo.rpc,
    channel: () => ({
      on: () => ({ subscribe: () => ({}) }),
    }),
    removeChannel: async () => {},
  },
}));
// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const CHAVE_DO_CARRINHO = "marketplace_cart_v1";
const CHAVE_DAS_LAPIDES = "marketplace_cart_account_tombstones_v1";

let atual: ReturnType<typeof useCartContext>;
function Sonda() {
  const contexto = useCartContext();
  useEffect(() => {
    atual = contexto;
  }, [contexto]);
  return <output>{contexto.cartCount}</output>;
}
let raiz: Root;
let hospedeiro: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mundo.itens = [];
  mundo.rpc.mockResolvedValue({ error: null });
  localStorage.clear();
  sessionStorage.clear();
  vi.stubGlobal(
    "BroadcastChannel",
    class {
      postMessage() {}
      close() {}
    },
  );
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});
afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const produto = (id: string) =>
  mapProductFromDB({
    ...produtos.find((p) => p.id === id),
    product_variants: [],
  });
function guardarAqui(id: string, quantity: number, lastModifiedAt: number) {
  const atuais = JSON.parse(localStorage.getItem(CHAVE_DO_CARRINHO) ?? "[]");
  localStorage.setItem(
    CHAVE_DO_CARRINHO,
    JSON.stringify([
      ...atuais,
      { product: produto(id), quantity, lastModifiedAt },
    ]),
  );
}
function guardarLapide(id: string, deletedAt: number) {
  localStorage.setItem(
    CHAVE_DAS_LAPIDES,
    JSON.stringify({
      uid: "u1",
      marcas: [{ key: `${id}-`, deletedAt }],
    }),
  );
}
function linhaDoBanco(
  productId: string,
  quantity: number,
  updatedAt: number | null,
) {
  return {
    product_id: productId,
    variant_id: "",
    quantity,
    updated_at: updatedAt === null ? null : new Date(updatedAt).toISOString(),
  };
}
async function abrir() {
  await act(async () =>
    raiz.render(
      <CartProvider>
        <Sonda />
      </CartProvider>,
    ),
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(50);
  });
}
const linhas = () => atual.cart.map((i) => [i.product.id, i.quantity]);

describe("carrinho: junção com carimbo igual ou ausente", () => {
  it("controle: sem saber o que o banco confirmou, vale a linha daqui -- a hora não decide", async () => {
    const t = Date.now() - 5000;
    guardarAqui("p1", 3, t);
    guardarAqui("p2", 3, t + 1000);
    mundo.itens = [linhaDoBanco("p1", 5, t + 1000), linhaDoBanco("p2", 5, t)];
    await abrir();

    // Sem a lista do que o banco confirmou, a linha daqui pode ter edição não
    // enviada: fica a daqui nas duas, com o banco mais novo ou mais velho.
    expect(linhas()).toEqual([
      ["p1", 3],
      ["p2", 3],
    ]);
  });

  it("controle: linha que este aparelho não mexeu segue o banco; a mexida aqui fica -- com qualquer hora", async () => {
    const t = Date.now() - 5000;
    // O banco confirmou p1=3 e p2=2; aqui p2 virou 3 e não foi enviado.
    localStorage.setItem(
      "marketplace_cart_confirmado_v1",
      JSON.stringify({ uid: "u1", entradas: ["p1-=3", "p2-=2"] }),
    );
    // A hora daqui é a MAIS NOVA em p1 e a mais velha em p2: não importa.
    guardarAqui("p1", 3, t + 4000);
    guardarAqui("p2", 3, t);
    mundo.itens = [linhaDoBanco("p1", 5, t), linhaDoBanco("p2", 5, t + 4000)];
    await abrir();

    expect(linhas()).toEqual([
      ["p1", 5],
      ["p2", 3],
    ]);
  });

  it("carimbo IGUAL: vale a quantidade daqui, não a do banco", async () => {
    const t = Date.now() - 5000;
    guardarAqui("p1", 3, t);
    mundo.itens = [linhaDoBanco("p1", 5, t)];
    await abrir();

    expect(linhas()).toEqual([["p1", 3]]);
  });

  it("linha do banco SEM hora é a mais velha: não ganha da quantidade mexida aqui", async () => {
    guardarAqui("p1", 3, Date.now() - 5000);
    mundo.itens = [linhaDoBanco("p1", 5, null)];
    await abrir();

    expect(linhas()).toEqual([["p1", 3]]);
  });

  it("linha adotada do banco que veio SEM hora ganha uma hora de verdade", async () => {
    mundo.itens = [linhaDoBanco("p1", 2, null)];
    await abrir();

    expect(linhas()).toEqual([["p1", 2]]);
    expect(atual.cart[0]?.lastModifiedAt).toBeGreaterThan(0);
  });

  it("lápide com a MESMA hora da linha daqui não a apaga", async () => {
    const t = Date.now() - 5000;
    guardarAqui("p1", 3, t);
    guardarLapide("p1", t);
    mundo.itens = [linhaDoBanco("p2", 1, t - 1000)];
    await abrir();

    expect(linhas()).toEqual([
      ["p1", 3],
      ["p2", 1],
    ]);
  });

  it("lápide com a MESMA hora da linha do banco não a esconde", async () => {
    const t = Date.now() - 5000;
    guardarLapide("p1", t);
    mundo.itens = [linhaDoBanco("p1", 4, t)];
    await abrir();

    expect(linhas()).toEqual([["p1", 4]]);
  });

  it("carrinho daqui IGUAL ao do banco, mas com lápide mais nova (outra aba tirou): a linha sai", async () => {
    const t = Date.now() - 5000;
    guardarAqui("p1", 1, t);
    guardarLapide("p1", Date.now());
    mundo.itens = [linhaDoBanco("p1", 1, t)];
    await abrir();

    expect(linhas()).toEqual([]);
  });
});
