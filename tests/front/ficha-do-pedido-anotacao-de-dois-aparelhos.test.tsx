// @vitest-environment jsdom
/**
 * Dois aparelhos na MESMA anotação interna do pedido (lote r75-a).
 *
 * Antes: salvar era um "grava por cima" (upsert por pedido, ou delete se o
 * texto ficava vazio) sem comparar nada. A lojista abre a anotação no celular,
 * a funcionária salva uma nova no computador, e quem salvar por último apagava
 * a primeira SEM aviso nenhum.
 *
 * Agora: ao abrir o editor a ficha guarda o carimbo (`updated_at`) lido; o
 * salvar só vale se a anotação ainda tiver esse carimbo. Se mudou, nada é
 * gravado, a ficha avisa em português simples, mostra a anotação como está
 * salva agora e MANTÉM o que ela digitou no editor.
 *
 * O "banco" abaixo faz o que o servidor faz: carimba um `updated_at` novo a
 * cada gravação e só aplica update/delete na linha que bate com os filtros.
 */
import type { Order } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { banco, carimbo, gravacoes, bloqueio } = vi.hoisted(() => ({
  banco: new Map<string, { note: string; updated_at: string }>(),
  carimbo: { n: 0 },
  // Enquanto houver uma espera aqui, a PRÓXIMA gravação fica "no ar" (a rede
  // pendurada) e só se aplica quando a espera é liberada.
  bloqueio: { espera: null as Promise<void> | null },
  gravacoes: [] as Array<{
    operacao: string;
    valores?: unknown;
    filtros: Array<[string, unknown]>;
  }>,
}));

function novoCarimbo() {
  carimbo.n += 1;
  return `2026-11-08T10:00:00.${String(carimbo.n).padStart(6, "0")}+00:00`;
}

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => {
      const consulta = (
        operacao: "update" | "delete" | "insert",
        valores?: unknown,
      ) => {
        const filtros: Array<[string, unknown]> = [];
        const aplicar = () => {
          gravacoes.push({ operacao, valores, filtros: [...filtros] });
          const id =
            (filtros.find(([c]) => c === "order_id")?.[1] as string) ??
            (valores as { order_id: string }).order_id;
          const atual = banco.get(id);
          if (operacao === "insert") {
            if (atual) {
              return {
                data: null,
                error: { code: "23505", message: "duplicate key" },
              };
            }
            const updated_at = novoCarimbo();
            banco.set(id, {
              note: (valores as { note: string }).note,
              updated_at,
            });
            return { data: [{ updated_at }], error: null };
          }
          const bate =
            atual &&
            filtros.every(([coluna, valor]) =>
              coluna === "updated_at" ? atual.updated_at === valor : true,
            );
          if (!atual || !bate) return { data: [], error: null };
          if (operacao === "delete") {
            banco.delete(id);
            return { data: [{ updated_at: atual.updated_at }], error: null };
          }
          const updated_at = novoCarimbo();
          banco.set(id, {
            note: (valores as { note: string }).note,
            updated_at,
          });
          return { data: [{ updated_at }], error: null };
        };
        const espera = bloqueio.espera;
        bloqueio.espera = null;
        const executar = () =>
          espera ? espera.then(aplicar) : Promise.resolve(aplicar());
        const cadeia: {
          eq: (coluna: string, valor: unknown) => typeof cadeia;
          select: () => Promise<unknown>;
        } = {
          eq: (coluna, valor) => {
            filtros.push([coluna, valor]);
            return cadeia;
          },
          select: () => executar(),
        };
        return cadeia;
      };
      return {
        select: () => ({
          eq: (_coluna: string, id: string) => ({
            maybeSingle: () =>
              tabela === "config_mototaxi"
                ? Promise.resolve({
                    data: { whatsapp: null, nome: null },
                    error: null,
                  })
                : Promise.resolve({ data: banco.get(id) ?? null, error: null }),
          }),
        }),
        insert: (valores: unknown) => consulta("insert", valores),
        // O caminho ANTIGO do app (grava por cima, sem comparar nada). Fica no
        // banco de mentira para o teste falhar pela asserção, não por método
        // ausente, se a ficha voltar a usá-lo.
        upsert: (valores: { order_id: string; note: string }) => {
          gravacoes.push({ operacao: "upsert", valores, filtros: [] });
          const updated_at = novoCarimbo();
          banco.set(valores.order_id, { note: valores.note, updated_at });
          return Promise.resolve({ data: null, error: null });
        },
        update: (valores: unknown) => consulta("update", valores),
        delete: () => consulta("delete"),
      };
    },
    functions: { invoke: vi.fn() },
  },
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

import { OrderDetail } from "@/components/admin/orders/OrderDetail";
import { PRAZO_DAS_ACOES_DO_PEDIDO_MS } from "@/lib/prazo-da-requisicao";
import { toast } from "sonner";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function pedido(id: string): Order {
  return {
    id,
    notes: "",
    trackingCode: "",
    customer: { name: "Cliente Teste", whatsapp: "34999999999" },
    items: [],
    subtotal: 100,
    shipping: 0,
    discount: 0,
    total: 100,
    paymentMethod: "pix",
    paymentStatus: "pago",
    status: "processing",
    createdAt: "2026-11-08T09:00:00Z",
    updatedAt: "2026-11-08T09:00:00Z",
    cancelledAfterShipping: false,
  };
}

describe("ficha do pedido — anotação interna salva de dois aparelhos", () => {
  let hospedeiro: HTMLDivElement;
  let raiz: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    banco.clear();
    gravacoes.length = 0;
    carimbo.n = 0;
    bloqueio.espera = null;
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    vi.useRealTimers();
    act(() => raiz.unmount());
    hospedeiro.remove();
  });

  async function mostrar(order: Order) {
    await act(async () => {
      raiz.render(<OrderDetail order={order} onStatusChange={vi.fn()} />);
    });
  }

  function clicar(texto: string) {
    const botao = [...hospedeiro.querySelectorAll("button")].find(
      (b) => b.textContent === texto,
    );
    if (!botao) throw new Error(`Botão ausente: ${texto}`);
    act(() => botao.click());
  }

  function campo() {
    const elemento =
      hospedeiro.querySelector<HTMLTextAreaElement>("#notes-textarea");
    if (!elemento) throw new Error("Editor de anotação ausente");
    return elemento;
  }

  function digitar(texto: string) {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    if (!setter) throw new Error("Campo sem setter de valor");
    act(() => {
      setter.call(campo(), texto);
      campo().dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  async function abrirEditor(rotulo: "Editar notas" | "Adicionar anotação") {
    await act(async () => clicar(rotulo));
  }

  // O outro aparelho salvou: o servidor carimba de novo.
  function outroAparelhoSalva(id: string, note: string) {
    banco.set(id, { note, updated_at: novoCarimbo() });
  }

  it("caminho feliz: ninguém mexeu, o salvar vale e grava condicionado ao carimbo lido", async () => {
    outroAparelhoSalva("A", "Nota original");
    const carimboLido = banco.get("A")?.updated_at;
    await mostrar(pedido("A"));
    await abrirEditor("Editar notas");
    digitar("Nota da lojista");
    await act(async () => clicar("Salvar"));

    expect(banco.get("A")?.note).toBe("Nota da lojista");
    expect(gravacoes).toHaveLength(1);
    expect(gravacoes[0].filtros).toContainEqual(["updated_at", carimboLido]);
    expect(toast.success).toHaveBeenCalledWith("Anotação interna salva!");
    expect(toast.error).not.toHaveBeenCalled();
    expect(hospedeiro.querySelector("#notes-textarea")).toBeNull();
  });

  it("outro aparelho salvou depois que o editor abriu: NÃO sobrescreve, avisa e mantém o que ela digitou", async () => {
    outroAparelhoSalva("A", "Nota original");
    await mostrar(pedido("A"));
    await abrirEditor("Editar notas");
    digitar("O que a lojista digitou");
    outroAparelhoSalva("A", "Nota da funcionária");

    await act(async () => clicar("Salvar"));

    // Nada do que ela digitou foi para o banco; a anotação da outra segue lá.
    expect(banco.get("A")?.note).toBe("Nota da funcionária");
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(vi.mocked(toast.error).mock.calls[0][0]).toContain(
      "Esta anotação mudou em outro aparelho",
    );
    // O rascunho continua no editor, destravado, com a nova à vista.
    expect(campo().value).toBe("O que a lojista digitou");
    expect(campo().disabled).toBe(false);
    expect(hospedeiro.textContent).toContain("Nota da funcionária");
  });

  it("depois de ver a nova, salvar de novo grava (ela decidiu com a anotação nova à vista)", async () => {
    outroAparelhoSalva("A", "Nota original");
    await mostrar(pedido("A"));
    await abrirEditor("Editar notas");
    digitar("O que a lojista digitou");
    outroAparelhoSalva("A", "Nota da funcionária");
    await act(async () => clicar("Salvar"));
    expect(banco.get("A")?.note).toBe("Nota da funcionária");

    await act(async () => clicar("Salvar"));

    expect(banco.get("A")?.note).toBe("O que a lojista digitou");
    expect(toast.success).toHaveBeenCalledWith("Anotação interna salva!");
    expect(hospedeiro.querySelector("#notes-textarea")).toBeNull();
  });

  it("não havia anotação e outro aparelho criou uma: o salvar não a apaga", async () => {
    await mostrar(pedido("A"));
    await abrirEditor("Adicionar anotação");
    digitar("Minha anotação");
    outroAparelhoSalva("A", "Anotação criada no outro aparelho");

    await act(async () => clicar("Salvar"));

    expect(banco.get("A")?.note).toBe("Anotação criada no outro aparelho");
    expect(toast.success).not.toHaveBeenCalled();
    expect(vi.mocked(toast.error).mock.calls[0][0]).toContain(
      "Esta anotação mudou em outro aparelho",
    );
    expect(campo().value).toBe("Minha anotação");
    expect(hospedeiro.textContent).toContain(
      "Anotação criada no outro aparelho",
    );
  });

  it("ela esvazia o texto para apagar, mas o outro aparelho mudou antes: não apaga", async () => {
    outroAparelhoSalva("A", "Nota original");
    await mostrar(pedido("A"));
    await abrirEditor("Editar notas");
    digitar("");
    outroAparelhoSalva("A", "Nota nova do outro aparelho");

    await act(async () => clicar("Salvar"));

    expect(banco.get("A")?.note).toBe("Nota nova do outro aparelho");
    expect(toast.success).not.toHaveBeenCalled();
    expect(vi.mocked(toast.error).mock.calls[0][0]).toContain(
      "Esta anotação mudou em outro aparelho",
    );
    expect(campo().value).toBe("");
  });

  it("apagar com a anotação intacta apaga a linha", async () => {
    outroAparelhoSalva("A", "Nota original");
    await mostrar(pedido("A"));
    await abrirEditor("Editar notas");
    digitar("   ");

    await act(async () => clicar("Salvar"));

    expect(banco.has("A")).toBe(false);
    expect(toast.success).toHaveBeenCalledWith("Anotação interna salva!");
  });

  it("dois salvamentos seguidos do MESMO aparelho não se acusam de conflito", async () => {
    outroAparelhoSalva("A", "Nota original");
    await mostrar(pedido("A"));
    await abrirEditor("Editar notas");
    digitar("Primeira");
    await act(async () => clicar("Salvar"));
    await abrirEditor("Editar notas");
    digitar("Segunda");
    await act(async () => clicar("Salvar"));

    expect(banco.get("A")?.note).toBe("Segunda");
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("segundo salvar atrás de um primeiro ainda no ar usa o carimbo que o primeiro deixou (nenhum conflito falso)", async () => {
    vi.useFakeTimers();
    outroAparelhoSalva("A", "Nota original");
    await mostrar(pedido("A"));
    await abrirEditor("Editar notas");
    digitar("Primeira");
    let liberar!: () => void;
    bloqueio.espera = new Promise<void>((resolve) => {
      liberar = resolve;
    });
    await act(async () => clicar("Salvar"));
    // Passou o prazo da tela: o editor solta com o texto, a gravação segue no ar.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PRAZO_DAS_ACOES_DO_PEDIDO_MS);
    });
    vi.mocked(toast.error).mockClear();
    digitar("Segunda");
    await act(async () => clicar("Salvar"));

    // A primeira finalmente chega ao servidor; só então a segunda sai.
    await act(async () => {
      liberar();
      await vi.advanceTimersByTimeAsync(100);
    });

    expect(banco.get("A")?.note).toBe("Segunda");
    expect(toast.error).not.toHaveBeenCalled();
  });
});
