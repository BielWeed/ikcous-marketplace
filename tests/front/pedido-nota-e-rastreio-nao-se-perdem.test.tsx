// @vitest-environment jsdom
import type { Order } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { salvar, atualizar, ler, gravarNota, apagarNota, banco } = vi.hoisted(
  () => ({
    salvar: vi.fn(),
    atualizar: vi.fn(),
    ler: vi.fn(),
    gravarNota: vi.fn(),
    apagarNota: vi.fn(),
    // "Banco" das anotações internas: a escrita só vale quando a resposta
    // chega (é nessa ordem que o servidor real a aplicaria).
    banco: new Map<string, string>(),
  }),
);

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => ({
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
      upsert: (
        valores: { order_id: string; note: string },
        opcoes: unknown,
      ) => {
        gravarNota(tabela, valores, opcoes);
        return Promise.resolve(salvar("order_id", valores.order_id)).then(
          (resposta: { error: Error | null }) => {
            if (!resposta.error) banco.set(valores.order_id, valores.note);
            return resposta;
          },
        );
      },
      delete: () => ({
        eq: (coluna: string, id: string) => {
          apagarNota(tabela, coluna, id);
          return Promise.resolve(salvar(coluna, id)).then(
            (resposta: { error: Error | null }) => {
              if (!resposta.error) banco.delete(id);
              return resposta;
            },
          );
        },
      }),
      update: (valores: unknown) => {
        atualizar(tabela, valores);
        return { eq: salvar };
      },
    }),
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
import { toast } from "sonner";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

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

function envioPendente() {
  let concluir!: (resposta: { error: Error | null }) => void;
  const resposta = new Promise<{ error: Error | null }>((resolve) => {
    concluir = resolve;
  });
  return { resposta, concluir };
}

describe("pedido — anotações e rastreio não se perdem", () => {
  let hospedeiro: HTMLDivElement;
  let raiz: Root;
  const onStatusChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    salvar.mockReset().mockResolvedValue({ error: null });
    banco.clear();
    banco.set("A", "Interna de A");
    banco.set("B", "Interna de B");
    ler
      .mockReset()
      .mockImplementation(
        (_tabela: string, _colunas: string, _coluna: string, id: string) =>
          Promise.resolve({
            data: banco.has(id) ? { note: banco.get(id) } : null,
            error: null,
          }),
      );
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
  });

  async function mostrar(order: Order, isOffline = false) {
    // Reutiliza a instância, como a ficha do painel.
    await act(async () => {
      raiz.render(
        <OrderDetail
          order={order}
          onStatusChange={onStatusChange}
          isOffline={isOffline}
        />,
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

  // Abrir o editor RELÊ a anotação do banco: o editor só aparece depois.
  async function editarNotas() {
    await act(async () => clicar("Editar notas"));
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

  it.each([
    { resultado: "sucesso", error: null },
    { resultado: "erro", error: new Error("Falha simulada") },
  ])("resposta de A com $resultado não altera B", async ({ error }) => {
    const envioA = envioPendente();
    salvar.mockReturnValueOnce(envioA.resposta);
    await mostrar(pedido("A"));
    await editarNotas();
    digitar("#notes-textarea", "  Nova nota de A  ");
    await act(async () => clicar("Salvar"));

    expect(gravarNota).toHaveBeenCalledWith(
      "marketplace_order_internal_notes",
      { order_id: "A", note: "Nova nota de A" },
      { onConflict: "order_id" },
    );
    expect(atualizar).not.toHaveBeenCalled();
    expect(salvar).toHaveBeenCalledWith("order_id", "A");
    await mostrar(pedido("B"));
    await editarNotas();
    expect(campo("#notes-textarea").disabled).toBe(false);
    digitar("#notes-textarea", "Rascunho de B");

    await act(async () => envioA.concluir({ error }));

    expect(campo("#notes-textarea").value).toBe("Rascunho de B");
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
    const cancelar = hospedeiro.querySelector<HTMLButtonElement>(
      '[aria-label="Cancelar edição das anotações"]',
    );
    expect(cancelar).not.toBeNull();
    act(() => cancelar!.click());
    expect(hospedeiro.textContent).toContain("Nota de B");
    expect(hospedeiro.textContent).not.toContain("Nova nota de A");
  });

  it("a conclusão de A não libera o salvamento ainda pendente de B", async () => {
    const envioA = envioPendente();
    const envioB = envioPendente();
    salvar
      .mockReturnValueOnce(envioA.resposta)
      .mockReturnValueOnce(envioB.resposta);
    await mostrar(pedido("A"));
    await editarNotas();
    await act(async () => clicar("Salvar"));
    await mostrar(pedido("B"));
    await editarNotas();
    digitar("#notes-textarea", "Nova nota de B");
    await act(async () => clicar("Salvar"));
    expect(salvar).toHaveBeenLastCalledWith("order_id", "B");

    await act(async () => envioA.concluir({ error: null }));
    expect(campo("#notes-textarea").disabled).toBe(true);

    await act(async () => envioB.concluir({ error: null }));
    expect(hospedeiro.querySelector("#notes-textarea")).toBeNull();
    expect(hospedeiro.textContent).toContain("Nova nota de B");
  });

  it("ir de A para B e voltar a A não faz a resposta antiga de A fechar o editor novo", async () => {
    const envioA = envioPendente();
    salvar.mockReturnValueOnce(envioA.resposta);
    await mostrar(pedido("A"));
    await editarNotas();
    digitar("#notes-textarea", "Primeira nota de A");
    clicar("Salvar");
    await mostrar(pedido("B"));
    await mostrar(pedido("A"));
    await act(async () => envioA.concluir({ error: null }));
    await editarNotas();
    expect(campo("#notes-textarea").disabled).toBe(false);
    digitar("#notes-textarea", "Rascunho novo de A");

    expect(campo("#notes-textarea").value).toBe("Rascunho novo de A");
    expect(campo("#notes-textarea").disabled).toBe(false);
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("salvar no pedido atual mostra a nota salva e fecha o editor", async () => {
    await mostrar(pedido());
    await editarNotas();
    digitar("#notes-textarea", "  Entregar depois das 18h  ");
    await act(async () => clicar("Salvar"));

    expect(hospedeiro.querySelector("#notes-textarea")).toBeNull();
    expect(hospedeiro.textContent).toContain("Entregar depois das 18h");
    expect(toast.success).toHaveBeenCalledWith("Anotação interna salva!");
    expect(gravarNota).toHaveBeenCalledWith(
      "marketplace_order_internal_notes",
      { order_id: "A", note: "Entregar depois das 18h" },
      { onConflict: "order_id" },
    );
    expect(atualizar).not.toHaveBeenCalled();
  });

  it("atualizar só o rastreio preserva a anotação em edição", async () => {
    const order = pedido();
    await mostrar(order);
    await editarNotas();
    digitar("#notes-textarea", "Anotação ainda não salva");

    await mostrar({ ...order, trackingCode: "CODIGO-NOVO" });

    expect(campo("#notes-textarea").value).toBe("Anotação ainda não salva");
    expect(hospedeiro.textContent).toContain("CODIGO-NOVO");
  });

  it("atualizar a observação da cliente preserva os dois rascunhos", async () => {
    const order = pedido();
    await mostrar(order);
    await editarNotas();
    digitar("#notes-textarea", "Rascunho da equipe");
    clicar("Editar Código");
    digitar("#tracking-input", "RASTREIO-EM-EDICAO");

    const leiturasAntes = ler.mock.calls.length;

    await mostrar({ ...order, notes: "Anotação recebida ao vivo" });

    expect(campo("#tracking-input").value).toBe("RASTREIO-EM-EDICAO");
    expect(campo("#notes-textarea").value).toBe("Rascunho da equipe");
    expect(ler).toHaveBeenCalledTimes(leiturasAntes);
    expect(hospedeiro.textContent).toContain("Anotação recebida ao vivo");
  });

  it("trocar o id descarta ambos os rascunhos mesmo com valores salvos iguais", async () => {
    const order = pedido();
    await mostrar(order);
    await editarNotas();
    digitar("#notes-textarea", "Rascunho antigo");
    clicar("Editar Código");
    digitar("#tracking-input", "RASTREIO-ANTIGO");

    await mostrar({ ...order, id: "B" });

    await editarNotas();
    clicar("Editar Código");
    expect(campo("#notes-textarea").value).toBe("Interna de B");
    expect(campo("#tracking-input").value).toBe("CODIGO-A");
  });

  it("apagar o texto interno exclui só a linha privada", async () => {
    await mostrar(pedido());
    await editarNotas();
    digitar("#notes-textarea", "  \n  ");
    await act(async () => clicar("Salvar"));

    expect(apagarNota).toHaveBeenCalledWith(
      "marketplace_order_internal_notes",
      "order_id",
      "A",
    );
    expect(gravarNota).not.toHaveBeenCalled();
    expect(atualizar).not.toHaveBeenCalled();
    expect(hospedeiro.textContent).toContain("Nota de A");
    expect(hospedeiro.textContent).toContain("Adicionar anotação");
  });

  it("observação, variante e frete ficam somente leitura e intactos após salvar", async () => {
    const notes =
      "Sem embrulho\nProduto: Tamanho G\nFrete Escolhido: SEDEX (Prazo: 2 dias)";
    const order = { ...pedido(), notes };
    await mostrar(order);
    const rotulo = [...hospedeiro.querySelectorAll("h3")].find(
      (h) => h.textContent === "Observações do pedido",
    );
    const linha = rotulo?.parentElement;
    expect(linha).toBeDefined();
    expect(linha?.querySelector("p")?.textContent).toBe(notes);
    expect(linha?.querySelector("p")?.className).toContain(
      "whitespace-pre-line",
    );
    expect(linha?.querySelector("button, textarea, input")).toBeNull();
    await editarNotas();
    expect(campo("#notes-textarea").value).toBe("Interna de A");
    digitar("#notes-textarea", "Somente equipe");
    await act(async () => clicar("Salvar"));

    expect(hospedeiro.contains(linha ?? null)).toBe(true);
    expect(linha?.querySelector("p")?.textContent).toBe(notes);
    expect(
      hospedeiro.querySelector('[data-testid="forma-de-entrega"]')?.textContent,
    ).toContain("SEDEX");
    expect(order.notes).toBe(notes);
    expect(gravarNota).toHaveBeenCalledWith(
      "marketplace_order_internal_notes",
      { order_id: "A", note: "Somente equipe" },
      { onConflict: "order_id" },
    );
    expect(atualizar).not.toHaveBeenCalled();
  });

  it("erro de leitura impede editar e permite tentar novamente", async () => {
    ler.mockResolvedValueOnce({ data: null, error: new Error("Sem rede") });
    await mostrar(pedido());
    expect(hospedeiro.textContent).toContain(
      "Não consegui carregar a anotação interna",
    );
    expect(hospedeiro.textContent).not.toContain("Editar notas");
    expect(hospedeiro.textContent).not.toContain("Adicionar anotação");
    expect(hospedeiro.querySelector("#notes-textarea")).toBeNull();
    expect(atualizar).not.toHaveBeenCalled();
    await act(async () => clicar("Tentar de novo"));
    expect(hospedeiro.textContent).toContain("Interna de A");
    expect(ler).toHaveBeenCalledWith(
      "marketplace_order_internal_notes",
      "note",
      "order_id",
      "A",
    );
  });

  it("falha de gravação preserva o texto para tentar novamente", async () => {
    salvar.mockResolvedValueOnce({ error: new Error("Sem rede") });
    await mostrar(pedido());
    await editarNotas();
    digitar("#notes-textarea", "Rascunho a preservar");
    await act(async () => clicar("Salvar"));
    expect(campo("#notes-textarea").value).toBe("Rascunho a preservar");
    expect(campo("#notes-textarea").disabled).toBe(false);
    expect(toast.error).toHaveBeenCalled();
    expect(atualizar).not.toHaveBeenCalled();
    expect(gravarNota).toHaveBeenCalledWith(
      "marketplace_order_internal_notes",
      { order_id: "A", note: "Rascunho a preservar" },
      { onConflict: "order_id" },
    );
  });

  it("leitura atrasada de A não substitui a nota de B", async () => {
    let concluir!: (valor: { data: { note: string }; error: null }) => void;
    ler.mockReturnValueOnce(
      new Promise((resolve) => {
        concluir = resolve;
      }),
    );
    await mostrar(pedido("A"));
    expect(hospedeiro.textContent).toContain("Carregando anotação interna");
    expect(hospedeiro.textContent).not.toContain("Adicionar anotação");
    expect(hospedeiro.textContent).not.toContain("Editar notas");
    await mostrar(pedido("B"));
    expect(hospedeiro.textContent).toContain("Interna de B");
    await act(async () =>
      concluir({
        data: { note: "Interna antiga de A" },
        error: null,
      }),
    );
    expect(hospedeiro.textContent).not.toContain("Interna antiga de A");
    expect(hospedeiro.textContent).toContain("Interna de B");
    expect(ler).toHaveBeenLastCalledWith(
      "marketplace_order_internal_notes",
      "note",
      "order_id",
      "B",
    );
    await editarNotas();
    digitar("#notes-textarea", "Nova interna de B");
    await act(async () => clicar("Salvar"));
    expect(gravarNota).toHaveBeenCalledWith(
      "marketplace_order_internal_notes",
      { order_id: "B", note: "Nova interna de B" },
      { onConflict: "order_id" },
    );
    expect(atualizar).not.toHaveBeenCalled();
  });

  it("offline impede salvar mesmo se a edição já estava aberta", async () => {
    const order = pedido();
    await mostrar(order);
    await editarNotas();
    digitar("#notes-textarea", "Sem conexão");
    await mostrar(order, true);
    const botao = [...hospedeiro.querySelectorAll("button")].find(
      (b) => b.textContent === "Salvar",
    );
    expect(botao?.disabled).toBe(true);
    clicar("Salvar");
    expect(salvar).not.toHaveBeenCalled();
    expect(atualizar).not.toHaveBeenCalled();
    expect(campo("#notes-textarea").value).toBe("Sem conexão");
  });

  it("voltar a A não aceita uma leitura da abertura anterior de A", async () => {
    let concluir!: (valor: { data: { note: string }; error: null }) => void;
    ler.mockReturnValueOnce(
      new Promise((resolve) => {
        concluir = resolve;
      }),
    );
    await mostrar(pedido("A"));
    await mostrar(pedido("B"));
    await mostrar(pedido("A"));
    await editarNotas();
    digitar("#notes-textarea", "Rascunho atual de A");
    await act(async () =>
      concluir({
        data: { note: "Leitura antiga de A" },
        error: null,
      }),
    );
    expect(campo("#notes-textarea").value).toBe("Rascunho atual de A");
    await act(async () => clicar("Salvar"));
    expect(gravarNota).toHaveBeenCalledWith(
      "marketplace_order_internal_notes",
      { order_id: "A", note: "Rascunho atual de A" },
      { onConflict: "order_id" },
    );
    expect(atualizar).not.toHaveBeenCalled();
  });

  it("editar relê o banco: o que outra aba salvou antes aparece no editor e na ficha", async () => {
    await mostrar(pedido());
    expect(hospedeiro.textContent).toContain("Interna de A");
    // Outra aba salva depois que esta ficha foi aberta.
    banco.set("A", "Combinado novo");
    const leiturasAntes = ler.mock.calls.length;

    await editarNotas();

    expect(ler).toHaveBeenCalledTimes(leiturasAntes + 1);
    expect(ler).toHaveBeenLastCalledWith(
      "marketplace_order_internal_notes",
      "note",
      "order_id",
      "A",
    );
    expect(campo("#notes-textarea").value).toBe("Combinado novo");
    act(() =>
      hospedeiro
        .querySelector<HTMLButtonElement>(
          '[aria-label="Cancelar edição das anotações"]',
        )
        ?.click(),
    );
    expect(hospedeiro.textContent).toContain("Combinado novo");
    expect(hospedeiro.textContent).not.toContain("Interna de A");
  });

  it("editar uma anotação que outra aba apagou abre o editor vazio", async () => {
    await mostrar(pedido());
    banco.delete("A");

    await editarNotas();

    expect(campo("#notes-textarea").value).toBe("");
  });

  it("falha ao reler impede abrir o editor, avisa e deixa tentar de novo", async () => {
    await mostrar(pedido());
    ler.mockResolvedValueOnce({ data: null, error: new Error("Sem rede") });

    await editarNotas();

    expect(hospedeiro.querySelector("#notes-textarea")).toBeNull();
    expect(toast.error).toHaveBeenCalledWith(
      "Não consegui abrir a edição. Tente de novo.",
    );
    expect(hospedeiro.textContent).toContain("Interna de A");
    expect(atualizar).not.toHaveBeenCalled();
    expect(gravarNota).not.toHaveBeenCalled();

    await editarNotas();
    expect(campo("#notes-textarea").value).toBe("Interna de A");
  });

  it("enquanto relê, o botão fica em espera; a releitura de A não abre editor em B", async () => {
    await mostrar(pedido("A"));
    let concluir!: (valor: { data: { note: string }; error: null }) => void;
    ler.mockReturnValueOnce(
      new Promise((resolve) => {
        concluir = resolve;
      }),
    );

    await editarNotas();

    const botao = [...hospedeiro.querySelectorAll("button")].find(
      (b) => b.textContent === "Editar notas",
    );
    expect(botao?.disabled).toBe(true);
    expect(hospedeiro.querySelector("#notes-textarea")).toBeNull();

    await mostrar(pedido("B"));
    await act(async () =>
      concluir({ data: { note: "Texto velho de A" }, error: null }),
    );

    expect(hospedeiro.querySelector("#notes-textarea")).toBeNull();
    expect(hospedeiro.textContent).toContain("Interna de B");
    expect(hospedeiro.textContent).not.toContain("Texto velho de A");
    expect(toast.error).not.toHaveBeenCalled();
    const botaoB = [...hospedeiro.querySelectorAll("button")].find(
      (b) => b.textContent === "Editar notas",
    );
    expect(botaoB?.disabled).toBe(false);
  });

  it("gravação antiga que conclui por último não vence a nova (fila de gravações)", async () => {
    const primeira = envioPendente();
    salvar.mockReturnValueOnce(primeira.resposta);
    await mostrar(pedido("A"));
    await editarNotas();
    digitar("#notes-textarea", "Primeira versão");
    clicar("Salvar");
    await mostrar(pedido("B"));
    await mostrar(pedido("A"));
    await act(async () => primeira.concluir({ error: null }));
    await editarNotas();
    digitar("#notes-textarea", "Versão nova");
    await act(async () => clicar("Salvar"));

    expect(gravarNota).toHaveBeenCalledTimes(2);
    expect(banco.get("A")).toBe("Versão nova");
    expect(hospedeiro.textContent).toContain("Versão nova");
    expect(toast.success).toHaveBeenCalledTimes(1);
  });

  it("a segunda gravação só começa quando a primeira terminou, mesmo se a primeira falhar de vez (a rede cai)", async () => {
    let cair!: (motivo: Error) => void;
    salvar.mockReturnValueOnce(
      new Promise((_, rejeitar) => {
        cair = rejeitar;
      }),
    );
    await mostrar(pedido("A"));
    await editarNotas();
    digitar("#notes-textarea", "Primeira versão");
    clicar("Salvar");
    await mostrar(pedido("B"));
    await mostrar(pedido("A"));
    expect(gravarNota).toHaveBeenCalledTimes(1);
    await act(async () => cair(new Error("Caiu")));
    await editarNotas();
    digitar("#notes-textarea", "Versão nova");
    await act(async () => clicar("Salvar"));

    expect(gravarNota).toHaveBeenCalledTimes(2);
    expect(banco.get("A")).toBe("Versão nova");
    expect(hospedeiro.textContent).toContain("Versão nova");
  });

  it("voltar ao pedido espera a gravação pendente antes de reler a anotação", async () => {
    const envio = envioPendente();
    salvar.mockReturnValueOnce(envio.resposta);
    await mostrar(pedido("A"));
    await editarNotas();
    digitar("#notes-textarea", "Versão nova");
    await act(async () => clicar("Salvar"));
    await mostrar(pedido("B"));
    const leiturasAntes = ler.mock.calls.length;
    await mostrar(pedido("A"));
    const leiturasDurante = ler.mock.calls.length;
    const textoDurante = hospedeiro.textContent;

    await act(async () => envio.concluir({ error: null }));

    expect(leiturasDurante).toBe(leiturasAntes);
    expect(textoDurante).toContain("Carregando anotação interna");
    expect(hospedeiro.textContent).toContain("Versão nova");
    expect(hospedeiro.textContent).not.toContain("Interna de A");
    expect(banco.get("A")).toBe("Versão nova");
    await editarNotas();
    expect(campo("#notes-textarea").value).toBe("Versão nova");
  });

  it("releitura de edição de A que nunca termina não bloqueia editar B", async () => {
    await mostrar(pedido("A"));
    ler.mockReturnValueOnce(new Promise(() => {}));
    await editarNotas();

    await mostrar(pedido("B"));

    expect(hospedeiro.textContent).toContain("Interna de B");
    const botaoB = [...hospedeiro.querySelectorAll("button")].find(
      (b) => b.textContent === "Editar notas",
    );
    expect(botaoB?.disabled).toBe(false);
    await editarNotas();
    expect(campo("#notes-textarea").value).toBe("Interna de B");
  });

  it("concluir a releitura de A não libera o botão enquanto B ainda está relendo", async () => {
    await mostrar(pedido("A"));
    let concluirA!: () => void;
    ler.mockReturnValueOnce(
      new Promise((resolve) => {
        concluirA = () =>
          resolve({ data: { note: "Antiga de A" }, error: null });
      }),
    );
    await editarNotas();
    await mostrar(pedido("B"));
    let concluirB!: () => void;
    ler.mockReturnValueOnce(
      new Promise((resolve) => {
        concluirB = () =>
          resolve({ data: { note: "Atual de B" }, error: null });
      }),
    );
    await editarNotas();
    await act(async () => concluirA());
    const botaoB = [...hospedeiro.querySelectorAll("button")].find(
      (b) => b.textContent === "Editar notas",
    );
    const desabilitadoDurante = botaoB?.disabled;
    await act(async () => concluirB());

    expect(desabilitadoDurante).toBe(true);
    expect(campo("#notes-textarea").value).toBe("Atual de B");
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("desmontar e reabrir o pedido preserva a fila até a primeira gravação terminar", async () => {
    const primeira = envioPendente();
    salvar.mockReturnValueOnce(primeira.resposta);
    await mostrar(pedido("A"));
    await editarNotas();
    digitar("#notes-textarea", "Primeira versão");
    await act(async () => clicar("Salvar"));
    await act(async () => raiz.render(<div />));
    const leiturasAntes = ler.mock.calls.length;
    await mostrar(pedido("A"));
    const leiturasDurante = ler.mock.calls.length;
    const textoDurante = hospedeiro.textContent;
    const gravacoesDurante = gravarNota.mock.calls.length;

    await act(async () => primeira.concluir({ error: null }));
    await editarNotas();
    expect(campo("#notes-textarea").value).toBe("Primeira versão");
    digitar("#notes-textarea", "Versão nova");
    await act(async () => clicar("Salvar"));

    expect(leiturasDurante).toBe(leiturasAntes);
    expect(textoDurante).toContain("Carregando anotação interna");
    expect(gravacoesDurante).toBe(1);
    expect(gravarNota.mock.calls.map(([, valores]) => valores.note)).toEqual([
      "Primeira versão",
      "Versão nova",
    ]);
    expect(banco.get("A")).toBe("Versão nova");
    expect(hospedeiro.textContent).toContain("Versão nova");
  });

  it("o aviso de privacidade está ligado ao campo e a falha de gravação vai ao console", async () => {
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    salvar.mockResolvedValueOnce({ error: new Error("Sem rede") });
    await mostrar(pedido());
    await editarNotas();
    const ajuda = document.getElementById(
      campo("#notes-textarea").getAttribute("aria-describedby") ?? "",
    );
    expect(ajuda?.textContent).toBe(
      "Só você e sua equipe veem esta anotação. A cliente não vê.",
    );

    await act(async () => clicar("Salvar"));

    expect(erro).toHaveBeenCalled();
    erro.mockRestore();
  });

  it("fechar durante a leitura não contamina a próxima ficha", async () => {
    let concluir!: (valor: { data: { note: string }; error: null }) => void;
    ler.mockReturnValueOnce(
      new Promise((resolve) => {
        concluir = resolve;
      }),
    );
    await mostrar(pedido("A"));
    await act(async () => raiz.render(<div />));
    await mostrar(pedido("B"));
    await act(async () =>
      concluir({
        data: { note: "Nota da ficha fechada" },
        error: null,
      }),
    );
    expect(hospedeiro.textContent).not.toContain("Nota da ficha fechada");
    expect(hospedeiro.textContent).toContain("Interna de B");
    await editarNotas();
    digitar("#notes-textarea", "Nota da ficha atual");
    await act(async () => clicar("Salvar"));
    expect(gravarNota).toHaveBeenCalledWith(
      "marketplace_order_internal_notes",
      { order_id: "B", note: "Nota da ficha atual" },
      { onConflict: "order_id" },
    );
    expect(atualizar).not.toHaveBeenCalled();
  });
});
