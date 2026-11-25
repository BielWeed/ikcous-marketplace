// @vitest-environment jsdom
//
// Bordas da folha de pedido de devolução/troca da cliente
// (SolicitarDevolucaoSheet) que a mutação achou sem teste:
//  - os botões de quantidade travam nos limites (zero e o que ainda pode voltar);
//  - o prazo de desistência encerrado continua na lista de prazos, riscado;
//  - a sexta foto fecha a vaga de "Adicionar" e a sétima não é nem conferida;
//  - o recado de 'troca' no passo da solução e o prazo citado na nota legal
//    seguem o tipo (desistência, problema no produto, troca por gosto);
//  - com duas formas de devolver, nenhuma vem marcada por conta própria;
//  - só texto em branco não conta como rascunho, mas o motivo e a foto contam;
//  - "Entregar na loja" mostra endereço e horário mesmo quando só um existe;
//  - o prazo que vence com a folha aberta tira o reembolso das opções e o envio
//    não sai com a escolha velha.
import { act, useState } from "react";
import { type Root, createRoot } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SolicitarDevolucaoSheet } from "@/components/devolucao/SolicitarDevolucaoSheet";
import type { DadosDaSolicitacao, Desfecho } from "@/hooks/useDevolucaoCliente";
import type {
  ElegibilidadeDevolucao,
  ResultadoSolicitacao,
} from "@/types/devolucao";

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
}));

// O jsdom não decodifica imagem: a conferência "a foto abre?" é dublada.
vi.mock("@/lib/imagem-abre", () => ({ imagemAbre: async () => true }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const ELEGIBILIDADE: ElegibilidadeDevolucao = {
  pode: true,
  motivo_bloqueio: null,
  entregue_em: "2026-09-24T15:00:00Z",
  dias_desde_entrega: 2,
  modalidade: "nacional",
  metodos: ["etiqueta_reversa", "envio_proprio"],
  prazos: {
    arrependimento_ate: "2026-10-01",
    troca_ate: "2026-10-24",
    vicio_ate: "2026-12-23",
  },
  janelas: { arrependimento: true, troca: true, vicio: true },
  itens: [
    {
      order_item_id: "oi-1",
      product_id: "p-1",
      product_name: "Tênis",
      image_url: null,
      quantidade: 2,
      ja_devolvida: 0,
      disponivel: 2,
      valor_unitario: 100,
    },
  ],
  politica: {
    prazo_arrependimento_dias: 7,
    prazo_troca_dias: 30,
    prazo_vicio_dias: 90,
    aceita_troca: true,
    aceita_vale: true,
    exige_fotos_vicio: true,
    metodos_locais: ["entrega_na_loja", "coleta"],
    metodos_nacionais: ["etiqueta_reversa", "envio_proprio"],
    reembolso_momento: "ao_receber",
    frete_troca_pago_por: "cliente",
    categorias_sem_troca: [],
    texto_politica: null,
    endereco_devolucao: null,
    updated_at: null,
  },
};

// Um único item com UMA unidade já vem marcado: o rascunho começa vazio.
const UMA_UNIDADE: ElegibilidadeDevolucao = {
  ...ELEGIBILIDADE,
  itens: ELEGIBILIDADE.itens.map((item) => ({
    ...item,
    quantidade: 1,
    disponivel: 1,
  })),
};

const NA_LOJA: ElegibilidadeDevolucao = {
  ...UMA_UNIDADE,
  modalidade: "local",
  metodos: ["entrega_na_loja", "coleta"],
};

const solicitar =
  vi.fn<(d: DadosDaSolicitacao) => Promise<Desfecho<ResultadoSolicitacao>>>();
const enviarFoto = vi.fn<(a: File, u: string) => Promise<Desfecho<string>>>();
const onAbertoMudou = vi.fn<(aberto: boolean) => void>();

interface DonoProps {
  readonly elegibilidade: ElegibilidadeDevolucao;
  readonly enderecoDaLoja: string | null;
  readonly horarioDaLoja: string | null;
}

// Dono do `aberto`, como a tela do pedido: o mesmo componente recebe a
// elegibilidade nova sem perder o que a cliente já escolheu.
function Dono({ elegibilidade, enderecoDaLoja, horarioDaLoja }: DonoProps) {
  const [aberto, setAberto] = useState(true);
  return (
    <SolicitarDevolucaoSheet
      aberto={aberto}
      onAbertoMudou={(valor) => {
        onAbertoMudou(valor);
        setAberto(valor);
      }}
      elegibilidade={elegibilidade}
      userId="u-1"
      enderecoDaLoja={enderecoDaLoja}
      horarioDaLoja={horarioDaLoja}
      solicitar={solicitar}
      enviarFoto={enviarFoto}
    />
  );
}

let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  solicitar.mockReset();
  enviarFoto.mockReset();
  onAbertoMudou.mockReset();
  vi.mocked(toast.error).mockClear();
  vi.mocked(toast.info).mockClear();
  solicitar.mockResolvedValue({
    ok: true,
    valor: {
      id: "d-1",
      protocolo: "DV260926-ABCDE",
      tipo: "arrependimento",
      status: "solicitada",
    },
  });
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  document.body.innerHTML = "";
});

async function montar(
  elegibilidade = ELEGIBILIDADE,
  enderecoDaLoja: string | null = "Rua A, 10",
  horarioDaLoja: string | null = "Seg a Sex, 9h às 18h",
) {
  await act(async () => {
    raiz.render(
      <Dono
        elegibilidade={elegibilidade}
        enderecoDaLoja={enderecoDaLoja}
        horarioDaLoja={horarioDaLoja}
      />,
    );
  });
}

async function trocarElegibilidade(elegibilidade: ElegibilidadeDevolucao) {
  await act(async () => {
    raiz.render(
      <Dono
        elegibilidade={elegibilidade}
        enderecoDaLoja="Rua A, 10"
        horarioDaLoja="Seg a Sex, 9h às 18h"
      />,
    );
  });
}

const folha = () =>
  document.querySelector<HTMLElement>('[data-testid="folha-devolucao"]');
const aviso = () => document.querySelector<HTMLElement>('[role="alertdialog"]');

function botao(texto: string): HTMLButtonElement | undefined {
  return Array.from(folha()?.querySelectorAll("button") ?? []).find(
    (b) =>
      b.textContent?.trim() === texto || b.getAttribute("aria-label") === texto,
  );
}

// Toque de verdade: o guardião do sheet.tsx arma no pointerdown/pointerup de
// quem está FORA do conteúdo da folha e engole o click seguinte.
async function clicar(el: HTMLElement | null | undefined) {
  expect(el).toBeTruthy();
  await act(async () => {
    el?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    el?.dispatchEvent(new MouseEvent("pointerup", { bubbles: true }));
    el?.click();
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
}

const radio = (valor: string) =>
  folha()?.querySelector<HTMLInputElement>(
    `input[type="radio"][value="${valor}"]`,
  );

const quantidadeNaTela = () =>
  folha()?.querySelector('[aria-live="polite"]')?.textContent;

async function escolherFotos(quantas: number) {
  const entrada = folha()?.querySelector<HTMLInputElement>(
    '[data-testid="entrada-fotos-devolucao"]',
  );
  expect(entrada).toBeTruthy();
  const arquivos = Array.from(
    { length: quantas },
    (_, i) => new File(["x"], `foto-${i}.jpg`, { type: "image/jpeg" }),
  );
  Object.defineProperty(entrada, "files", {
    configurable: true,
    value: arquivos,
  });
  await act(async () => {
    entrada?.dispatchEvent(new Event("change", { bubbles: true }));
    for (let i = 0; i < 20; i++) await Promise.resolve();
  });
}

async function escreverNoDetalhe(texto: string) {
  const campo =
    folha()?.querySelector<HTMLTextAreaElement>("#devolucao-detalhe");
  expect(campo).toBeTruthy();
  const escrever = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value",
  )?.set;
  await act(async () => {
    escrever?.call(campo, texto);
    campo?.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("quantidade: os botões travam nos limites", () => {
  it("'Diminuir' trava em zero e 'Aumentar' trava no que ainda pode voltar", async () => {
    await montar();
    expect(botao("Diminuir Tênis")?.disabled).toBe(true);
    expect(botao("Aumentar Tênis")?.disabled).toBe(false);

    await clicar(botao("Aumentar Tênis"));
    expect(botao("Diminuir Tênis")?.disabled).toBe(false);
    expect(botao("Aumentar Tênis")?.disabled).toBe(false);

    await clicar(botao("Aumentar Tênis"));
    expect(quantidadeNaTela()).toBe("2");
    expect(botao("Aumentar Tênis")?.disabled).toBe(true);

    await clicar(botao("Diminuir Tênis"));
    await clicar(botao("Diminuir Tênis"));
    expect(quantidadeNaTela()).toBe("0");
    expect(botao("Diminuir Tênis")?.disabled).toBe(true);
  });
});

describe("prazos mostrados no primeiro passo", () => {
  it("desistência encerrada continua na lista, marcada como encerrada; troca aberta não", async () => {
    await montar({
      ...ELEGIBILIDADE,
      janelas: { arrependimento: false, troca: true, vicio: true },
    });
    const linhas = Array.from(
      folha()?.querySelectorAll('ul[aria-label="Prazos"] li') ?? [],
    );
    const desistir = linhas.find((li) =>
      li.textContent?.includes("Desistir da compra (7 dias)"),
    );
    const troca = linhas.find((li) =>
      li.textContent?.includes("Troca por tamanho ou gosto"),
    );
    expect(desistir?.textContent).toContain("até 01/10/2026");
    expect(desistir?.textContent).toContain("(encerrado)");
    expect(troca?.textContent).toContain("até 24/10/2026");
    expect(troca?.textContent).not.toContain("(encerrado)");
  });
});

describe("fotos: o limite de seis", () => {
  it("com seis fotos escolhidas some o botão 'Adicionar'", async () => {
    await montar();
    await clicar(botao("Aumentar Tênis"));
    await clicar(botao("Continuar"));
    expect(botao("Adicionar")).toBeDefined();

    await escolherFotos(6);
    expect(folha()?.textContent).toContain("6/6");
    expect(botao("Adicionar")).toBeUndefined();
  });
});

describe("o que conta como rascunho ao fechar", () => {
  it("só espaços no texto não pergunta nada: o X fecha direto", async () => {
    await montar(UMA_UNIDADE);
    await clicar(botao("Continuar"));
    await escreverNoDetalhe("   ");
    await clicar(botao("Fechar"));

    expect(onAbertoMudou).toHaveBeenCalledWith(false);
    expect(aviso()).toBeNull();
  });

  it("só o motivo escolhido já é rascunho: o X pergunta antes de descartar", async () => {
    await montar(UMA_UNIDADE);
    await clicar(botao("Continuar"));
    await clicar(radio("desisti"));
    await clicar(botao("Fechar"));

    expect(onAbertoMudou).not.toHaveBeenCalled();
    expect(aviso()?.textContent).toContain("Descartar o que você preencheu?");
  });
  it("só uma foto escolhida (antes do motivo) já é rascunho: o X pergunta", async () => {
    await montar(UMA_UNIDADE);
    await clicar(botao("Continuar"));
    await escolherFotos(1);
    await clicar(botao("Fechar"));

    expect(onAbertoMudou).not.toHaveBeenCalled();
    expect(aviso()?.textContent).toContain("Descartar o que você preencheu?");
  });
});

describe("'Entregar na loja': endereço e horário aparecem mesmo com só um deles", () => {
  async function ateOPassoDaForma(
    enderecoDaLoja: string | null,
    horarioDaLoja: string | null,
  ) {
    await montar(NA_LOJA, enderecoDaLoja, horarioDaLoja);
    await clicar(botao("Continuar"));
    await clicar(radio("desisti"));
    await clicar(botao("Continuar"));
    return radio("entrega_na_loja")?.closest("label")?.textContent ?? "";
  }

  it("só o endereço", async () => {
    const opcao = await ateOPassoDaForma("Rua A, 10", null);
    expect(opcao).toContain("Rua A, 10");
    expect(opcao).not.toContain("Horário:");
  });

  it("só o horário", async () => {
    const opcao = await ateOPassoDaForma(null, "Seg a Sex, 9h às 18h");
    expect(opcao).toContain("Horário: Seg a Sex, 9h às 18h");
  });

  it("nenhum dos dois: a opção não inventa bloco de endereço", async () => {
    const opcao = await ateOPassoDaForma(null, null);
    expect(opcao).not.toContain("Horário:");
    expect(opcao).not.toContain("Rua A");
  });
});

describe("fotos que não cabem não são nem conferidas", () => {
  it("a sétima foto, inválida, não gera erro: só avisa que ficou de fora", async () => {
    await montar();
    await clicar(botao("Aumentar Tênis"));
    await clicar(botao("Continuar"));
    const entrada = folha()?.querySelector<HTMLInputElement>(
      '[data-testid="entrada-fotos-devolucao"]',
    );
    const arquivos = [
      ...Array.from(
        { length: 6 },
        (_, i) => new File(["x"], `foto-${i}.jpg`, { type: "image/jpeg" }),
      ),
      new File(["x"], "animacao.gif", { type: "image/gif" }),
    ];
    Object.defineProperty(entrada, "files", {
      configurable: true,
      value: arquivos,
    });
    await act(async () => {
      entrada?.dispatchEvent(new Event("change", { bubbles: true }));
      for (let i = 0; i < 20; i++) await Promise.resolve();
    });

    expect(folha()?.textContent).toContain("6/6");
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.info).toHaveBeenCalledWith(
      "1 foto ficou de fora. Envie no máximo 6 fotos.",
    );
  });
});

describe("forma de devolver: sem escolha automática quando há mais de uma", () => {
  async function ateAForma(elegibilidade: ElegibilidadeDevolucao) {
    await montar(elegibilidade);
    await clicar(botao("Continuar"));
    await clicar(radio("desisti"));
    await clicar(botao("Continuar"));
    await clicar(radio("reembolso"));
  }

  it("duas formas: nenhuma vem marcada e continuar sem escolher pede a escolha", async () => {
    await ateAForma(UMA_UNIDADE);
    expect(radio("etiqueta_reversa")?.checked).toBe(false);
    expect(radio("envio_proprio")?.checked).toBe(false);

    await clicar(botao("Continuar"));
    expect(folha()?.querySelector('[role="alert"]')?.textContent).toContain(
      "Escolha como o produto volta para a loja.",
    );
  });

  it("uma forma só já vem marcada", async () => {
    await ateAForma({ ...UMA_UNIDADE, metodos: ["envio_proprio"] });
    expect(radio("envio_proprio")?.checked).toBe(true);
  });
});

describe("passo da solução e nota legal seguem o tipo do pedido", () => {
  const SO_TROCA = {
    ...ELEGIBILIDADE,
    janelas: { arrependimento: false, troca: true, vicio: true },
  };

  async function ateOPasso3(
    elegibilidade: ElegibilidadeDevolucao,
    motivo: string,
  ) {
    await montar(elegibilidade);
    await clicar(botao("Aumentar Tênis"));
    await clicar(botao("Continuar"));
    await clicar(radio(motivo));
    if (motivo === "defeito") await escolherFotos(1);
    await clicar(botao("Continuar"));
  }

  it("só troca por gosto ganha o recado 'você pode solicitar uma troca'", async () => {
    await ateOPasso3(SO_TROCA, "nao_gostei");
    expect(folha()?.textContent).toContain(
      "O prazo de arrependimento terminou. Você pode solicitar uma troca.",
    );

    await act(async () => raiz.unmount());
    raiz = createRoot(hospedeiro);
    await ateOPasso3(ELEGIBILIDADE, "desisti");
    expect(folha()?.textContent).not.toContain("Você pode solicitar uma troca");

    await act(async () => raiz.unmount());
    raiz = createRoot(hospedeiro);
    await ateOPasso3(ELEGIBILIDADE, "defeito");
    expect(folha()?.textContent).not.toContain("Você pode solicitar uma troca");
  });

  it.each([
    ["desisti", ELEGIBILIDADE, "(até 01/10/2026)"],
    ["defeito", ELEGIBILIDADE, "(até 23/12/2026)"],
    ["nao_gostei", SO_TROCA, "(até 24/10/2026)"],
  ] as const)(
    "a nota legal de '%s' cita o prazo certo",
    async (motivo, elegibilidade, prazo) => {
      await ateOPasso3(elegibilidade, motivo);
      await clicar(radio("troca"));
      await clicar(radio("envio_proprio"));
      await clicar(botao("Continuar"));
      const nota = folha()?.querySelector("p.bg-emerald-50")?.textContent;
      expect(nota).toContain(prazo);
    },
  );
});

describe("prazo que vence com a folha aberta", () => {
  it("o reembolso sai das opções e o envio não vai com a escolha velha", async () => {
    await montar();
    await clicar(botao("Aumentar Tênis"));
    await clicar(botao("Continuar"));
    await clicar(radio("desisti"));
    await clicar(botao("Continuar"));
    await clicar(radio("reembolso"));
    await clicar(radio("etiqueta_reversa"));
    await clicar(botao("Continuar"));
    expect(botao("Confirmar devolução")).toBeDefined();

    // A janela de desistência fecha enquanto a cliente confere o pedido: o
    // motivo "desisti" passa a ser troca por gosto, que não aceita reembolso.
    await trocarElegibilidade({
      ...ELEGIBILIDADE,
      janelas: { arrependimento: false, troca: true, vicio: true },
    });
    await clicar(botao("Confirmar devolução"));

    expect(solicitar).not.toHaveBeenCalled();
  });
});
