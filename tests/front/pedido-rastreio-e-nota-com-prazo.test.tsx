// @vitest-environment jsdom
/**
 * Achado 13 — código de rastreio e anotação interna da ficha do pedido com
 * rede "pendurada": a conexão abre e não responde. Sem prazo o botão ficava
 * girando e o campo desabilitado (e o app adiava a atualização obrigatória)
 * até a lojista fechar a ficha, sem saber se o código/anotação tinha sido
 * gravado.
 *
 * O prazo só encerra a ESPERA DA TELA: a gravação segue no servidor e pode ter
 * dado certo. Por isso a frase NÃO diz que falhou ("Sem resposta da rede.
 * Confira o pedido antes de tentar de novo."), o campo solta COM o que a
 * lojista digitou, o valor gravado é relido em silêncio e a resposta tardia
 * não vira aviso nem fecha o editor. Repetir é seguro: os dois são "último
 * vale" (update do código, upsert/delete da anotação).
 *
 * A anotação entra numa fila por pedido: o prazo solta só a espera da TELA; o
 * envio pendurado continua na fila, então um novo salvar não passa na frente
 * (nada duplica nem se reordena).
 */
import type { Order } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { atualizar, salvar, ler, gravarNota, banco } = vi.hoisted(() => ({
  atualizar: vi.fn(),
  salvar: vi.fn(),
  ler: vi.fn(),
  gravarNota: vi.fn(),
  banco: new Map<string, string>(),
}));

// A anotação só é gravada se o carimbo (`updated_at`) lido ao abrir o editor
// ainda for o do banco; aqui o carimbo é derivado do texto (`v-<texto>`).
const carimboDe = (nota: string) => `v-${nota}`;

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => {
      const cadeiaDaNota = (operacao: "update" | "delete", note?: string) => {
        const filtros = new Map<string, unknown>();
        const cadeia = {
          eq: (coluna: string, valor: unknown) => {
            filtros.set(coluna, valor);
            return cadeia;
          },
          select: () => {
            const id = filtros.get("order_id") as string;
            if (operacao === "update")
              gravarNota(tabela, { order_id: id, note });
            return Promise.resolve(salvar("nota", id)).then(
              (resposta: { error: Error | null }) => {
                if (resposta.error) return resposta;
                const bate =
                  banco.has(id) &&
                  filtros.get("updated_at") === carimboDe(banco.get(id) ?? "");
                if (!bate) return { data: [], error: null };
                if (operacao === "delete") banco.delete(id);
                else banco.set(id, note as string);
                return {
                  data: [{ updated_at: carimboDe(note ?? "") }],
                  error: null,
                };
              },
            );
          },
        };
        return cadeia;
      };
      return {
        select: (colunas: string) => ({
          eq: (coluna: string, id: string) => ({
            maybeSingle: () =>
              tabela === "config_mototaxi"
                ? Promise.resolve({
                    data: { whatsapp: null, nome: null },
                    error: null,
                  })
                : ler(tabela, colunas, coluna, id),
          }),
        }),
        insert: (valores: { order_id: string; note: string }) => ({
          select: () => {
            gravarNota(tabela, valores);
            return Promise.resolve(salvar("nota", valores.order_id)).then(
              (resposta: { error: Error | null }) => {
                if (resposta.error) return resposta;
                if (banco.has(valores.order_id)) {
                  return { data: null, error: { code: "23505" } };
                }
                banco.set(valores.order_id, valores.note);
                return {
                  data: [{ updated_at: carimboDe(valores.note) }],
                  error: null,
                };
              },
            );
          },
        }),
        delete: () => cadeiaDaNota("delete"),
        update: (valores: { note?: string }) => {
          if (tabela === "marketplace_order_internal_notes") {
            return cadeiaDaNota("update", valores.note);
          }
          atualizar(tabela, valores);
          return {
            eq: (_coluna: string, id: string) => salvar("rastreio", id),
          };
        },
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
import { haOperacaoSensivel } from "@/lib/atualizacao/operacao-sensivel";
import { PRAZO_DAS_ACOES_DO_PEDIDO_MS } from "@/lib/prazo-da-requisicao";
import { toast } from "sonner";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const FRASE = "Sem resposta da rede. Confira o pedido antes de tentar de novo.";

function pedido(id = "A"): Order {
  return {
    id,
    notes: `Nota de ${id}`,
    trackingCode: `CODIGO-${id}`,
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
}

type Resposta = { error: Error | null };
// Todo envio pendurado é respondido no fim do teste: a fila de anotações é
// estado de MÓDULO (por pedido) e um envio que nunca responde travaria os
// testes seguintes do mesmo pedido.
const enviosPendurados: Array<(resposta: Resposta) => void> = [];
function envioPendente() {
  let concluir!: (resposta: Resposta) => void;
  const resposta = new Promise<Resposta>((resolve) => {
    concluir = resolve;
  });
  enviosPendurados.push(concluir);
  return { resposta, concluir };
}

describe("ficha do pedido — rastreio e anotação: a espera da tela tem prazo", () => {
  let hospedeiro: HTMLDivElement;
  let raiz: Root;
  const onStatusChange = vi.fn();
  /** Código de rastreio que o "servidor" tem agora (para a releitura). */
  let rastreioNoServidor: string | null;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    salvar.mockReset().mockResolvedValue({ error: null });
    banco.clear();
    banco.set("A", "Interna de A");
    rastreioNoServidor = "CODIGO-A";
    ler
      .mockReset()
      .mockImplementation(
        (tabela: string, _colunas: string, _coluna: string, id: string) =>
          Promise.resolve(
            tabela === "marketplace_orders"
              ? { data: { tracking_code: rastreioNoServidor }, error: null }
              : {
                  data: banco.has(id)
                    ? {
                        note: banco.get(id),
                        updated_at: carimboDe(banco.get(id) ?? ""),
                      }
                    : null,
                  error: null,
                },
          ),
      );
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(async () => {
    await act(async () => {
      for (const concluir of enviosPendurados.splice(0)) {
        concluir({ error: null });
      }
      await vi.advanceTimersByTimeAsync(10);
    });
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.useRealTimers();
  });

  async function mostrar(order: Order) {
    await act(async () => {
      raiz.render(
        <OrderDetail order={order} onStatusChange={onStatusChange} />,
      );
    });
  }

  function campo(seletor: string) {
    const elemento = hospedeiro.querySelector<
      HTMLInputElement | HTMLTextAreaElement
    >(seletor);
    if (!elemento) throw new Error(`Campo ausente: ${seletor}`);
    return elemento;
  }

  function clicar(texto: string) {
    const botao = [...hospedeiro.querySelectorAll("button")].find(
      (b) => b.textContent === texto || b.getAttribute("title") === texto,
    );
    if (!botao) throw new Error(`Botão ausente: ${texto}`);
    act(() => botao.click());
  }

  function digitar(seletor: string, texto: string) {
    const elemento = campo(seletor);
    const prototipo =
      elemento instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototipo, "value")?.set;
    if (!setter) throw new Error("Campo sem setter de valor");
    act(() => {
      setter.call(elemento, texto);
      elemento.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(campo(seletor).value).toBe(texto);
  }

  async function avancar(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  async function editarNotas() {
    await act(async () => clicar("Editar notas"));
  }

  const chamadasDeRastreio = () =>
    salvar.mock.calls.filter(([tipo]) => tipo === "rastreio");

  // ---------------------------------------------------------------- rastreio

  it("rastreio pendurado: depois do prazo o campo solta COM o que foi digitado, com a frase honesta, e a operação sensível acaba", async () => {
    const envio = envioPendente();
    salvar.mockImplementation((tipo: string) =>
      tipo === "rastreio" ? envio.resposta : Promise.resolve({ error: null }),
    );
    await mostrar(pedido("A"));
    clicar("Editar Código");
    digitar("#tracking-input", "NOVO-CODIGO");
    await act(async () => clicar("Salvar"));

    await avancar(PRAZO_DAS_ACOES_DO_PEDIDO_MS - 1);
    // um instante antes do prazo: ainda salvando
    expect(campo("#tracking-input").disabled).toBe(true);
    expect(toast.error).not.toHaveBeenCalled();
    expect(haOperacaoSensivel()).toBe(true);

    await avancar(1);
    expect(campo("#tracking-input").disabled).toBe(false);
    expect(campo("#tracking-input").value).toBe("NOVO-CODIGO");
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith(FRASE);
    expect(toast.success).not.toHaveBeenCalled();
    // não dá o código por salvo (o editor continua aberto) e uma só gravação
    expect(chamadasDeRastreio()).toHaveLength(1);
    expect(atualizar).toHaveBeenCalledTimes(1);
  });

  it("estourou o prazo do rastreio: relê o código gravado e, se o servidor já o tem, ele passa a ser o valor salvo", async () => {
    const envio = envioPendente();
    salvar.mockImplementation((tipo: string) =>
      tipo === "rastreio" ? envio.resposta : Promise.resolve({ error: null }),
    );
    // O servidor chegou a gravar (só a resposta se perdeu).
    rastreioNoServidor = "NOVO-CODIGO";
    await mostrar(pedido("A"));
    clicar("Editar Código");
    digitar("#tracking-input", "NOVO-CODIGO");
    await act(async () => clicar("Salvar"));
    await avancar(PRAZO_DAS_ACOES_DO_PEDIDO_MS);

    expect(
      ler.mock.calls.some(
        ([tabela, colunas]) =>
          tabela === "marketplace_orders" && colunas === "tracking_code",
      ),
    ).toBe(true);
    // Cancelar a edição mostra o valor SALVO: já é o novo.
    act(() =>
      hospedeiro
        .querySelector<HTMLButtonElement>(
          '[aria-label="Cancelar edição do código"]',
        )!
        .click(),
    );
    expect(hospedeiro.textContent).toContain("NOVO-CODIGO");
    expect(hospedeiro.textContent).not.toContain("CODIGO-A");
  });

  it("borda: a resposta do rastreio que chega DEPOIS do prazo não vira aviso nem fecha o editor", async () => {
    const envio = envioPendente();
    salvar.mockImplementation((tipo: string) =>
      tipo === "rastreio" ? envio.resposta : Promise.resolve({ error: null }),
    );
    await mostrar(pedido("A"));
    clicar("Editar Código");
    digitar("#tracking-input", "NOVO-CODIGO");
    await act(async () => clicar("Salvar"));
    await avancar(PRAZO_DAS_ACOES_DO_PEDIDO_MS);
    vi.mocked(toast.error).mockClear();

    await act(async () => envio.concluir({ error: null }));
    await avancar(10);

    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    expect(campo("#tracking-input").value).toBe("NOVO-CODIGO");
    expect(campo("#tracking-input").disabled).toBe(false);
  });

  it("borda: tocar em Salvar de novo depois do estouro manda uma gravação nova do mesmo código, e vale o sucesso dela", async () => {
    const envio = envioPendente();
    salvar.mockImplementationOnce(() => envio.resposta);
    await mostrar(pedido("A"));
    clicar("Editar Código");
    digitar("#tracking-input", "NOVO-CODIGO");
    await act(async () => clicar("Salvar"));
    await avancar(PRAZO_DAS_ACOES_DO_PEDIDO_MS);
    expect(toast.error).toHaveBeenCalledWith(FRASE);

    await act(async () => clicar("Salvar"));
    expect(chamadasDeRastreio()).toHaveLength(2);
    expect(atualizar).toHaveBeenNthCalledWith(1, "marketplace_orders", {
      tracking_code: "NOVO-CODIGO",
    });
    expect(atualizar).toHaveBeenNthCalledWith(2, "marketplace_orders", {
      tracking_code: "NOVO-CODIGO",
    });
    expect(toast.success).toHaveBeenCalledWith("Código de rastreio salvo!");
    expect(hospedeiro.querySelector("#tracking-input")).toBeNull();
    expect(hospedeiro.textContent).toContain("NOVO-CODIGO");
  });

  it("borda: erro DE VERDADE do rastreio (antes do prazo) segue com a frase de sempre", async () => {
    salvar.mockImplementationOnce(() =>
      Promise.resolve({ error: new Error("Falha simulada") }),
    );
    await mostrar(pedido("A"));
    clicar("Editar Código");
    digitar("#tracking-input", "NOVO-CODIGO");
    await act(async () => clicar("Salvar"));
    expect(toast.error).toHaveBeenCalledWith(
      "Erro ao salvar código de rastreio.",
    );
    expect(toast.error).not.toHaveBeenCalledWith(FRASE);
  });

  // ---------------------------------------------------------------- anotação

  it("anotação pendurada: depois do prazo o campo solta COM o texto digitado, com a frase honesta", async () => {
    const envio = envioPendente();
    salvar.mockImplementation((tipo: string) =>
      tipo === "nota" ? envio.resposta : Promise.resolve({ error: null }),
    );
    await mostrar(pedido("A"));
    await editarNotas();
    digitar("#notes-textarea", "Nota nova");
    await act(async () => clicar("Salvar"));
    expect(gravarNota).toHaveBeenCalledTimes(1);

    await avancar(PRAZO_DAS_ACOES_DO_PEDIDO_MS - 1);
    expect(campo("#notes-textarea").disabled).toBe(true);
    expect(toast.error).not.toHaveBeenCalled();

    await avancar(1);
    expect(campo("#notes-textarea").disabled).toBe(false);
    expect(campo("#notes-textarea").value).toBe("Nota nova");
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith(FRASE);
    expect(toast.success).not.toHaveBeenCalled();
    expect(haOperacaoSensivel()).toBe(true); // texto ainda não salvo: segue protegido
  });

  it("borda: a resposta da anotação que chega DEPOIS do prazo não vira aviso nem fecha o editor", async () => {
    const envio = envioPendente();
    salvar.mockImplementation((tipo: string) =>
      tipo === "nota" ? envio.resposta : Promise.resolve({ error: null }),
    );
    await mostrar(pedido("A"));
    await editarNotas();
    digitar("#notes-textarea", "Nota nova");
    await act(async () => clicar("Salvar"));
    await avancar(PRAZO_DAS_ACOES_DO_PEDIDO_MS);
    vi.mocked(toast.error).mockClear();

    await act(async () => envio.concluir({ error: null }));
    await avancar(10);

    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    expect(campo("#notes-textarea").value).toBe("Nota nova");
    expect(campo("#notes-textarea").disabled).toBe(false);
  });

  it("borda: o envio pendurado CONTINUA na fila — salvar de novo não passa na frente, nem duplica, e sai depois que o primeiro responde", async () => {
    const primeiro = envioPendente();
    salvar.mockImplementationOnce(() => primeiro.resposta);
    await mostrar(pedido("A"));
    await editarNotas();
    digitar("#notes-textarea", "Nota nova");
    await act(async () => clicar("Salvar"));
    await avancar(PRAZO_DAS_ACOES_DO_PEDIDO_MS);
    expect(toast.error).toHaveBeenCalledWith(FRASE);
    expect(gravarNota).toHaveBeenCalledTimes(1);

    // Segundo toque: entra na fila ATRÁS do primeiro (que ainda não respondeu).
    await act(async () => clicar("Salvar"));
    await avancar(1000);
    expect(gravarNota).toHaveBeenCalledTimes(1);
    // ...e a espera da tela dele também tem prazo, com a mesma frase.
    await avancar(PRAZO_DAS_ACOES_DO_PEDIDO_MS);
    expect(toast.error).toHaveBeenCalledTimes(2);
    expect(campo("#notes-textarea").disabled).toBe(false);
    expect(gravarNota).toHaveBeenCalledTimes(1);

    // O primeiro finalmente responde: só então o segundo sai (ordem mantida).
    await act(async () => primeiro.concluir({ error: null }));
    await avancar(10);
    expect(gravarNota).toHaveBeenCalledTimes(2);
    expect(gravarNota).toHaveBeenNthCalledWith(
      2,
      "marketplace_order_internal_notes",
      { order_id: "A", note: "Nota nova" },
    );
    // respostas tardias: nenhum aviso novo
    expect(toast.error).toHaveBeenCalledTimes(2);
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("borda: erro DE VERDADE da anotação (antes do prazo) segue com a frase de sempre", async () => {
    salvar.mockImplementationOnce(() =>
      Promise.resolve({ error: new Error("Falha simulada") }),
    );
    await mostrar(pedido("A"));
    await editarNotas();
    digitar("#notes-textarea", "Nota nova");
    await act(async () => clicar("Salvar"));
    expect(toast.error).toHaveBeenCalledWith(
      "Erro ao salvar anotação interna.",
    );
    expect(toast.error).not.toHaveBeenCalledWith(FRASE);
  });

  it("borda: trocar de pedido com o envio pendurado não deixa o prazo mexer na ficha nova", async () => {
    const envio = envioPendente();
    salvar.mockImplementation((tipo: string) =>
      tipo === "nota" ? envio.resposta : Promise.resolve({ error: null }),
    );
    await mostrar(pedido("A"));
    await editarNotas();
    digitar("#notes-textarea", "Nota nova de A");
    await act(async () => clicar("Salvar"));
    await mostrar(pedido("B"));

    await avancar(PRAZO_DAS_ACOES_DO_PEDIDO_MS + 10);
    // O estouro de A não avisa sobre a ficha de B.
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });
});
