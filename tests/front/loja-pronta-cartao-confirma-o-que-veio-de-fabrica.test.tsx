// @vitest-environment jsdom
//
// "Loja pronta" no Início (27/11/2026, decisão do sócio): a loja nova traz de
// fábrica a entrega na cidade (R$ 10, 1 dia) e Pix, cartão e dinheiro na
// entrega. O cartão não marca mais esses dois passos como feitos sozinho: mostra
// o que vale hoje, com os valores REAIS da loja, e pede um toque — "Está certo"
// confirma ali mesmo; "Mudar" leva ao Frete ou a Pagamentos pela MESMA
// navegação do checklist.
import { LojaProntaEEstoqueBaixo } from "@/components/admin/dashboard/LojaProntaEEstoqueBaixo";
import { montarEnderecoDaLoja } from "@/lib/endereco-da-loja";
import { type ComponentProps, act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type Props = ComponentProps<typeof LojaProntaEEstoqueBaixo>;
type OnConfirmar = NonNullable<Props["onConfirmar"]>;
type OnNavigate = Props["onNavigate"];

const ENDERECO_PRONTO = montarEnderecoDaLoja({
  cep: "38500000",
  rua: "Rua Rui Barbosa",
  numero: "10",
  complemento: "",
  bairro: "Centro",
  cidade: "Monte Carmelo",
  uf: "MG",
});

/** Tudo pronto (CEP 000 de cidade pequena); cada teste liga a confirmação que quer. */
const CONFIG: Props["config"] = {
  storeName: "Ateliê da Serra",
  logoUrl: "https://exemplo.test/logo.png",
  originCep: ENDERECO_PRONTO.originCep,
  storeAddress: ENDERECO_PRONTO.storeAddress,
  whatsappNumber: "(34) 99999-9999",
  localDeliveryFee: 10,
  localDeliveryDays: 1,
};

let hospedeiro: HTMLDivElement;
let raiz: Root;

async function montar(parcial: Partial<Props> = {}) {
  const props: Props = {
    stats: { inventoryAlerts: 0 },
    config: CONFIG,
    ligado: false,
    chaveOk: false,
    formasNaEntrega: ["pix", "card", "cash"],
    produtos: [{ isActive: true, stock: 5 }],
    configCarregando: false,
    produtosCarregando: false,
    onNavigate: vi.fn<OnNavigate>(),
    onTentarDeNovo: vi.fn<() => void>(),
    ...parcial,
  };
  await act(async () => {
    raiz.render(<LojaProntaEEstoqueBaixo {...props} />);
  });
}

function botoes(texto: string): HTMLButtonElement[] {
  return Array.from(
    hospedeiro.querySelectorAll<HTMLButtonElement>("button"),
  ).filter((b) => (b.textContent ?? "").trim() === texto);
}

async function clicar(botao: HTMLButtonElement) {
  await act(async () => {
    botao.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

beforeEach(() => {
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => {
    raiz.unmount();
  });
  hospedeiro.remove();
});

describe("Loja pronta — confirmar o que veio de fábrica", () => {
  it("entrega a confirmar: mostra o valor e o prazo reais e 'Está certo' confirma a entrega", async () => {
    const onConfirmar = vi.fn<OnConfirmar>().mockResolvedValue(true);
    await montar({
      config: {
        ...CONFIG,
        entregaConfirmada: false,
        localDeliveryFee: 12.5,
        localDeliveryDays: 2,
      },
      onConfirmar,
    });
    expect(hospedeiro.textContent).toContain(
      "Entrega na sua cidade: R$ 12,50, em 2 dias.",
    );
    expect(hospedeiro.textContent).toContain("5 de 6 passos concluídos");
    const [estaCerto] = botoes("Está certo");
    expect(estaCerto).toBeTruthy();
    await clicar(estaCerto);
    expect(onConfirmar).toHaveBeenCalledExactlyOnceWith("entrega");
  });

  it("'Mudar' da entrega leva ao Frete", async () => {
    const onNavigate = vi.fn<OnNavigate>();
    await montar({
      config: { ...CONFIG, entregaConfirmada: false },
      onNavigate,
      onConfirmar: vi.fn<OnConfirmar>(),
    });
    const [mudar] = botoes("Mudar");
    expect(mudar).toBeTruthy();
    await clicar(mudar);
    expect(onNavigate).toHaveBeenCalledExactlyOnceWith("admin-shipping");
  });

  it("pagamento a confirmar: lista as formas reais; 'Mudar' abre Pagamentos e 'Está certo' confirma o pagamento", async () => {
    const onNavigate = vi.fn<OnNavigate>();
    const onConfirmar = vi.fn<OnConfirmar>().mockResolvedValue(true);
    await montar({
      config: { ...CONFIG, pagamentoConfirmado: false },
      formasNaEntrega: ["pix", "cash"],
      onNavigate,
      onConfirmar,
    });
    expect(hospedeiro.textContent).toContain(
      "Na entrega você aceita: Pix e dinheiro.",
    );
    await clicar(botoes("Mudar")[0]);
    expect(onNavigate).toHaveBeenCalledExactlyOnceWith(
      "admin-settings",
      "pagamentos",
    );
    await clicar(botoes("Está certo")[0]);
    expect(onConfirmar).toHaveBeenCalledExactlyOnceWith("recebe");
  });

  it("enquanto confirma, 'Está certo' fica travado (dois toques não mandam duas vezes)", async () => {
    let soltar: (ok: boolean) => void = () => {};
    const onConfirmar = vi
      .fn<OnConfirmar>()
      .mockReturnValue(new Promise<boolean>((r) => (soltar = r)));
    await montar({
      config: { ...CONFIG, entregaConfirmada: false },
      onConfirmar,
    });
    const [estaCerto] = botoes("Está certo");
    await clicar(estaCerto);
    expect(botoes("Está certo")[0].disabled).toBe(true);
    await clicar(botoes("Está certo")[0]);
    expect(onConfirmar).toHaveBeenCalledTimes(1);
    await act(async () => {
      soltar(false);
    });
    expect(botoes("Está certo")[0].disabled).toBe(false);
  });

  it("na lista dos seis, o passo a confirmar mostra o texto e os dois botões", async () => {
    await montar({
      config: {
        ...CONFIG,
        entregaConfirmada: false,
        pagamentoConfirmado: false,
      },
      onConfirmar: vi.fn<OnConfirmar>(),
    });
    const abrir = hospedeiro.querySelector<HTMLButtonElement>(
      "button[aria-expanded]",
    );
    await clicar(abrir!);
    const linhas = Array.from(hospedeiro.querySelectorAll("ul > li"));
    const entrega = linhas.find((l) =>
      l.textContent?.includes("Entrega na sua cidade: R$ 10,00, em 1 dia."),
    );
    const recebe = linhas.find((l) =>
      l.textContent?.includes(
        "Na entrega você aceita: Pix, cartão (maquininha) e dinheiro.",
      ),
    );
    for (const linha of [entrega, recebe]) {
      expect(linha).toBeTruthy();
      const nomes = Array.from(linha!.querySelectorAll("button")).map((b) =>
        b.textContent?.trim(),
      );
      expect(nomes).toEqual(["Está certo", "Mudar"]);
    }
  });

  it("confirmado (ou coluna ausente): nada de 'Está certo', o passo é feito", async () => {
    await montar({
      config: { ...CONFIG, entregaConfirmada: true },
      onConfirmar: vi.fn<OnConfirmar>(),
    });
    expect(botoes("Está certo")).toHaveLength(0);
    expect(hospedeiro.textContent).toContain("6 de 6 passos concluídos");
  });

  // A loja nova só vende o que confirmou (28/11/2026, migration 20261655000000): enquanto não confirma, a cliente não
  // vê a entrega na cidade / não paga na entrega. O cartão diz isso embaixo do que vale hoje.
  it("entrega a confirmar: diz o que acontece com as clientes enquanto não confirmar", async () => {
    await montar({
      config: { ...CONFIG, entregaConfirmada: false },
      onConfirmar: vi.fn<OnConfirmar>(),
    });
    expect(hospedeiro.textContent).toContain(
      "Enquanto você não confirmar, a entrega na cidade não aparece para as clientes.",
    );
    expect(hospedeiro.textContent).not.toContain(
      "Enquanto você não confirmar, a cliente não consegue pagar na entrega.",
    );
  });

  it("pagamento a confirmar: diz que a cliente não consegue pagar na entrega enquanto não confirmar", async () => {
    await montar({
      config: { ...CONFIG, pagamentoConfirmado: false },
      onConfirmar: vi.fn<OnConfirmar>(),
    });
    expect(hospedeiro.textContent).toContain(
      "Enquanto você não confirmar, a cliente não consegue pagar na entrega.",
    );
    expect(hospedeiro.textContent).not.toContain(
      "a entrega na cidade não aparece para as clientes",
    );
  });

  it("confirmado: nenhuma das duas frases de consequência", async () => {
    await montar({
      config: { ...CONFIG, entregaConfirmada: true, pagamentoConfirmado: true },
      onConfirmar: vi.fn<OnConfirmar>(),
    });
    expect(hospedeiro.textContent).not.toContain("Enquanto você não confirmar");
  });
});
