// @vitest-environment jsdom
//
// Tarefa C3.2 (plano §5.3) — as seções `FechamentoDaVenda` e `ReciboDaVenda`,
// montadas em isolamento (sem a view inteira): estas duas seções não
// dependem de busca nenhuma, só de `estado`/`despachar` da máquina de C3.1
// (que aqui é a de verdade, via `useVendaPresencial`, com um componente
// hospedeiro fininho que só repassa as props).
//
// Sem `@testing-library/react`: `createRoot` + `act` do React puro, mesmo
// padrão da casa.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { isOfflineRef } = vi.hoisted(() => ({
  isOfflineRef: { atual: false },
}));

// ⚠️ ARMADILHA DE NOME medida na tarefa: `useOnlineStatus` devolve `true`
// quando está OFFLINE. O dublê segue a mesma convenção.
vi.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => isOfflineRef.atual,
}));

import { FechamentoDaVenda } from "@/components/admin/pdv/FechamentoDaVenda";
import { ReciboDaVenda } from "@/components/admin/pdv/ReciboDaVenda";
import type {
  FormaDePagamentoDoBalcao,
  ItemDoCupom,
  ReciboDaVendaRegistrada,
} from "@/hooks/useVendaPresencial";
import { useVendaPresencial } from "@/hooks/useVendaPresencial";
import { useEffect, useRef } from "react";

const ITEM: ItemDoCupom = {
  chave: "produto-1::",
  productId: "produto-1",
  variantId: null,
  nome: "Camiseta Lisa",
  variacao: null,
  preco: 39.9,
  quantidade: 2,
  estoque: 10,
  imagem: "",
};

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

// Armazenamento em memória, só para não sujar o `localStorage` real do
// jsdom entre testes — este arquivo não testa rascunho (C3.1 já cobre).
function criarArmazenamentoEmMemoria() {
  const dados = new Map<string, string>();
  return {
    getItem: (chave: string) => dados.get(chave) ?? null,
    setItem: (chave: string, valor: string) => {
      dados.set(chave, valor);
    },
    removeItem: (chave: string) => {
      dados.delete(chave);
    },
  };
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

function reciboDeExemplo(
  parcial: Partial<ReciboDaVendaRegistrada> = {},
): ReciboDaVendaRegistrada {
  return {
    orderId: "11111111-1111-1111-1111-111111111111",
    numero: "111111".slice(-6).toUpperCase(),
    criadoEm: "2026-09-16T12:00:00.000Z",
    total: 79.8,
    subtotal: 79.8,
    desconto: 0,
    pagamento: "cash",
    cliente: { tipo: "sem_cliente" },
    itens: [ITEM],
    jaExistia: false,
    ...parcial,
  };
}

// Hospedeiro fininho: liga `FechamentoDaVenda` a uma instância REAL do
// reducer de C3.1, para o teste poder mudar o estado clicando nos botões da
// própria seção — sem isto, cada asserção teria de reimplementar a máquina.
// `itensIniciais`/`pagamentoInicial` são SEMEADOS por `despachar` uma única
// vez, no efeito de montagem — nunca sobrepostos ao `estado` do hook depois
// disso, senão os despachos que os testes disparam clicando nos campos
// (desconto, motivo) nunca apareceriam no `estado` que a seção recebe.
function HospedeiroDoFechamento({
  itensIniciais,
  pagamentoInicial,
  aoRegistrarVenda,
}: {
  itensIniciais?: readonly ItemDoCupom[];
  pagamentoInicial?: FormaDePagamentoDoBalcao;
  aoRegistrarVenda: () => Promise<void>;
}) {
  const { estado, despachar, limparCupom } = useVendaPresencial({
    armazenamento: criarArmazenamentoEmMemoria(),
  });
  const semeadoRef = useRef(false);
  useEffect(() => {
    if (semeadoRef.current) return;
    semeadoRef.current = true;
    for (const item of itensIniciais ?? []) {
      despachar({ tipo: "item_adicionado_manualmente", item, em: Date.now() });
    }
    if (pagamentoInicial) {
      despachar({ tipo: "pagamento_escolhido", pagamento: pagamentoInicial });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- semeadura roda só na montagem.
  }, []);
  return (
    <FechamentoDaVenda
      estado={estado}
      despachar={despachar}
      aoRegistrarVenda={aoRegistrarVenda}
      limparCupom={limparCupom}
    />
  );
}

describe("FechamentoDaVenda (C3.2)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers();
    isOfflineRef.atual = false;
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
  });

  it("caso 1 — sem forma de pagamento o botão está desabilitado", async () => {
    const aoRegistrarVenda = vi.fn().mockResolvedValue(undefined);
    await act(async () => {
      raiz.render(
        <HospedeiroDoFechamento aoRegistrarVenda={aoRegistrarVenda} />,
      );
    });
    await avancar();

    const botao = localizarBotaoPorTexto(
      hospedeiro,
      "Registrar venda",
    ) as HTMLButtonElement;
    expect(botao.disabled).toBe(true);
  });

  it("caso 2 — desconto > 0 sem motivo mantém o botão desabilitado e mostra o campo de motivo", async () => {
    const aoRegistrarVenda = vi.fn().mockResolvedValue(undefined);
    await act(async () => {
      raiz.render(
        <HospedeiroDoFechamento
          itensIniciais={[ITEM]}
          pagamentoInicial="cash"
          aoRegistrarVenda={aoRegistrarVenda}
        />,
      );
    });
    await avancar();

    await act(async () => {
      digitarInput("desconto-da-venda", "500"); // vira R$ 5,00 (mask currency)
    });
    await avancar(300);

    expect(document.getElementById("motivo-do-desconto")).toBeTruthy();
    const botao = localizarBotaoPorTexto(
      hospedeiro,
      "Registrar venda",
    ) as HTMLButtonElement;
    expect(botao.disabled).toBe(true);
    expect(hospedeiro.textContent).toContain("Informe o motivo do desconto.");
  });

  it("caso 3 — desconto maior que o subtotal é recusado com a frase em português", async () => {
    const aoRegistrarVenda = vi.fn().mockResolvedValue(undefined);
    await act(async () => {
      raiz.render(
        <HospedeiroDoFechamento
          itensIniciais={[ITEM]}
          pagamentoInicial="cash"
          aoRegistrarVenda={aoRegistrarVenda}
        />,
      );
    });
    await avancar();

    await act(async () => {
      digitarInput("desconto-da-venda", "100000"); // vira R$ 1.000,00
    });
    await avancar(300);
    await act(async () => {
      digitarInput("motivo-do-desconto", "teste");
    });
    await avancar(300);

    expect(hospedeiro.textContent).toContain(
      "O desconto não pode ser maior que o subtotal da venda.",
    );
    const botao = localizarBotaoPorTexto(
      hospedeiro,
      "Registrar venda",
    ) as HTMLButtonElement;
    expect(botao.disabled).toBe(true);
  });

  it("caso 4 — offline desabilita o botão, mostra a frase do D3 e o cupom continua na tela", async () => {
    isOfflineRef.atual = true; // `useOnlineStatus` devolve `true` quando está OFFLINE.
    const aoRegistrarVenda = vi.fn().mockResolvedValue(undefined);
    await act(async () => {
      raiz.render(
        <HospedeiroDoFechamento
          itensIniciais={[ITEM]}
          pagamentoInicial="cash"
          aoRegistrarVenda={aoRegistrarVenda}
        />,
      );
    });
    await avancar();

    expect(hospedeiro.textContent).toContain("Sem internet agora");
    const botao = localizarBotaoPorTexto(
      hospedeiro,
      "Registrar venda",
    ) as HTMLButtonElement;
    expect(botao.disabled).toBe(true);
    // O cupom (o item) continua presente — D3: recusa, não apaga nada. A
    // seção de fechamento não lista item por item, só o subtotal — 2 ×
    // R$ 39,90 do `ITEM`.
    expect(hospedeiro.textContent).toContain("79,80");
  });

  it("caso 5 — com aoRegistrarVenda que resolve, a tela vai para o recibo e mostra 'Compra na loja' e o total", async () => {
    function HospedeiroCompleto() {
      const venda = useVendaPresencial({
        armazenamento: criarArmazenamentoEmMemoria(),
      });
      const semeadoRef = useRef(false);
      useEffect(() => {
        if (semeadoRef.current) return;
        semeadoRef.current = true;
        venda.despachar({
          tipo: "item_adicionado_manualmente",
          item: ITEM,
          em: Date.now(),
        });
        venda.despachar({ tipo: "pagamento_escolhido", pagamento: "cash" });
        // eslint-disable-next-line react-hooks/exhaustive-deps -- semeadura roda só na montagem.
      }, []);

      async function aoRegistrarVenda(): Promise<void> {
        // Molde de C3.4: quem resolve o `Promise` dispara `venda_registrada`
        // por cima do MESMO `despachar` — `FechamentoDaVenda` só chama e
        // espera, não conhece o recibo.
        venda.despachar({
          tipo: "venda_registrada",
          recibo: reciboDeExemplo({
            total: venda.total,
            subtotal: venda.subtotal,
            itens: [...venda.estado.itens],
          }),
        });
      }
      if (venda.estado.etapa === "recibo" && venda.estado.recibo) {
        return (
          <ReciboDaVenda
            recibo={venda.estado.recibo}
            despachar={venda.despachar}
            limparCupom={venda.limparCupom}
            storeName="Loja Teste"
          />
        );
      }
      return (
        <FechamentoDaVenda
          estado={venda.estado}
          despachar={venda.despachar}
          aoRegistrarVenda={aoRegistrarVenda}
          limparCupom={venda.limparCupom}
        />
      );
    }

    await act(async () => {
      raiz.render(<HospedeiroCompleto />);
    });
    await avancar();

    const botao = localizarBotaoPorTexto(
      hospedeiro,
      "Registrar venda",
    ) as HTMLButtonElement;
    expect(botao.disabled).toBe(false);

    await act(async () => {
      botao.click();
    });
    await avancar();

    expect(hospedeiro.textContent).toContain("Compra na loja");
    expect(hospedeiro.textContent).toContain("79,80");
  });

  it("caso 6 — recibo com jaExistia:true não mostra erro nenhum", async () => {
    const recibo = reciboDeExemplo({ jaExistia: true });
    await act(async () => {
      raiz.render(
        <ReciboDaVenda
          recibo={recibo}
          despachar={vi.fn()}
          limparCupom={vi.fn()}
          storeName="Loja Teste"
        />,
      );
    });
    await avancar();

    expect(hospedeiro.textContent).toContain("Compra na loja");
    expect(hospedeiro.querySelector('[role="alert"]')).toBeNull();
  });

  it("caso 7 — recibo sem WhatsApp não mostra o botão de WhatsApp", async () => {
    const recibo = reciboDeExemplo({
      cliente: { tipo: "sem_cliente" },
    });
    await act(async () => {
      raiz.render(
        <ReciboDaVenda
          recibo={recibo}
          despachar={vi.fn()}
          limparCupom={vi.fn()}
          storeName="Loja Teste"
        />,
      );
    });
    await avancar();

    expect(
      localizarBotaoPorTexto(hospedeiro, "Enviar por WhatsApp"),
    ).toBeUndefined();
    expect(localizarBotaoPorTexto(hospedeiro, "Imprimir")).toBeTruthy();
  });
});
