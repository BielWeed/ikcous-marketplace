// @vitest-environment jsdom
//
// Fechar a folha de devolução/troca apagava TUDO o que a cliente tinha
// preenchido (itens, motivo, texto, fotos) sem perguntar: o conteúdo da folha
// é desmontado ao fechar, por toque fora, Esc ou o X. Agora, havendo algo
// preenchido, fechar pede confirmação ("Descartar o que você preencheu?");
// sem nada preenchido, fecha direto, como sempre.
//
// A pergunta é um painel DENTRO do conteúdo da folha, nunca um AlertDialog em
// portal: no navegador real o AlertDialog (z-50) ficava ATRÁS da folha
// (z-[130]) e o "guardião do clique pós-fecho" do sheet.tsx engolia o clique
// dos botões do portal — a tela travava. Por isso os cliques aqui são de
// verdade (pointerdown + pointerup + click) e os botões da pergunta têm de
// estar dentro de [data-slot="sheet-content"].
import { act, useState } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ElegibilidadeDevolucao } from "@/types/devolucao";

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
}));

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
    texto_politica: "Trocas em até 30 dias, com etiqueta.",
    endereco_devolucao: null,
    updated_at: null,
  },
};

// Um item só, com uma unidade: já vem marcado.
const ELEGIBILIDADE_UMA_UNIDADE: ElegibilidadeDevolucao = {
  ...ELEGIBILIDADE,
  itens: [{ ...ELEGIBILIDADE.itens[0], quantidade: 1, disponivel: 1 }],
};

const solicitar = vi.fn();
const enviarFoto = vi.fn();
const descartarFotos = vi.fn();
const onAbertoMudou = vi.fn();

let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  solicitar.mockReset();
  enviarFoto.mockReset();
  descartarFotos.mockReset();
  descartarFotos.mockResolvedValue(undefined);
  onAbertoMudou.mockReset();
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

// Dono do `aberto`, como a tela do pedido: fechar de verdade desmonta a folha.
async function montar(elegibilidade = ELEGIBILIDADE) {
  const { SolicitarDevolucaoSheet } = await import(
    "@/components/devolucao/SolicitarDevolucaoSheet"
  );
  function Dono() {
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
        enderecoDaLoja="Rua A, 10"
        horarioDaLoja="Seg a Sex, 9h às 18h"
        solicitar={solicitar}
        enviarFoto={enviarFoto}
        descartarFotos={descartarFotos}
      />
    );
  }
  await act(async () => {
    raiz.render(<Dono />);
  });
}

const folha = () =>
  document.querySelector<HTMLElement>('[data-testid="folha-devolucao"]');
const aviso = () => document.querySelector<HTMLElement>('[role="alertdialog"]');

function botao(
  texto: string,
  dentro: ParentNode | null | undefined = document,
): HTMLButtonElement | undefined {
  return Array.from(dentro?.querySelectorAll("button") ?? []).find(
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

async function apertarEsc() {
  await act(async () => {
    document.dispatchEvent(
      // `cancelable` como o teclado de verdade: sem ele `preventDefault` é nulo.
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
}

const fecharPeloX = () => clicar(botao("Fechar", folha()));

async function escolherFoto() {
  const entrada = folha()?.querySelector<HTMLInputElement>(
    '[data-testid="entrada-fotos-devolucao"]',
  );
  expect(entrada).toBeTruthy();
  const arquivo = new File(["x"], "foto.jpg", { type: "image/jpeg" });
  Object.defineProperty(entrada, "files", {
    configurable: true,
    value: [arquivo],
  });
  await act(async () => {
    entrada?.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

const radio = (valor: string) =>
  folha()?.querySelector<HTMLInputElement>(
    `input[type="radio"][value="${valor}"]`,
  );

async function ateARevisao(motivo: string, resolucao: string, metodo: string) {
  await clicar(botao("Aumentar Tênis", folha()));
  await clicar(botao("Continuar", folha()));
  await clicar(radio(motivo));
  if (motivo === "defeito") await escolherFoto();
  await clicar(botao("Continuar", folha()));
  await clicar(radio(resolucao));
  await clicar(radio(metodo));
  await clicar(botao("Continuar", folha()));
}

describe("SolicitarDevolucaoSheet — fechar não joga fora o que foi preenchido", () => {
  it("nada preenchido: o X fecha direto, sem pergunta", async () => {
    await montar();
    await fecharPeloX();

    expect(onAbertoMudou).toHaveBeenCalledWith(false);
    expect(aviso()).toBeNull();
  });

  it("item marcado: o X pergunta antes e não fecha", async () => {
    await montar();
    await clicar(botao("Aumentar Tênis", folha()));
    await fecharPeloX();

    expect(onAbertoMudou).not.toHaveBeenCalled();
    expect(aviso()?.textContent).toContain("Descartar o que você preencheu?");
    expect(folha()).not.toBeNull();
  });

  it("a pergunta e os dois botões ficam DENTRO da folha (nada em portal)", async () => {
    await montar();
    await clicar(botao("Aumentar Tênis", folha()));
    await fecharPeloX();

    const dentro = (el: Element | null | undefined) =>
      el?.closest('[data-slot="sheet-content"]') ?? null;
    expect(dentro(aviso())).not.toBeNull();
    expect(dentro(botao("Continuar preenchendo", aviso()))).not.toBeNull();
    expect(dentro(botao("Descartar", aviso()))).not.toBeNull();
    // E nenhum AlertDialog do Radix (portal no body) foi aberto.
    expect(
      document.querySelector('[data-slot="alert-dialog-content"]'),
    ).toBeNull();
  });

  it("o foco inicial da pergunta é o 'Continuar preenchendo'", async () => {
    await montar();
    await clicar(botao("Aumentar Tênis", folha()));
    await fecharPeloX();

    expect(document.activeElement).toBe(
      botao("Continuar preenchendo", aviso()),
    );
  });

  it("'Continuar preenchendo' mantém a folha e o que estava marcado, e nada é apagado", async () => {
    await montar();
    await clicar(botao("Aumentar Tênis", folha()));
    await fecharPeloX();
    await clicar(botao("Continuar preenchendo", aviso()));

    expect(onAbertoMudou).not.toHaveBeenCalled();
    expect(descartarFotos).not.toHaveBeenCalled();
    expect(aviso()).toBeNull();
    // A quantidade marcada continua lá: o passo 1 ainda deixa avançar.
    await clicar(botao("Continuar", folha()));
    expect(
      folha()?.querySelector('[data-testid="passo-motivo"]'),
    ).not.toBeNull();
  });

  it("'Descartar' fecha de verdade", async () => {
    await montar();
    await clicar(botao("Aumentar Tênis", folha()));
    await fecharPeloX();
    await clicar(botao("Descartar", aviso()));

    expect(onAbertoMudou).toHaveBeenCalledTimes(1);
    expect(onAbertoMudou).toHaveBeenCalledWith(false);
    expect(folha()).toBeNull();
  });

  it("Esc com algo preenchido pergunta; Esc dentro da pergunta volta a preencher", async () => {
    await montar();
    await clicar(botao("Aumentar Tênis", folha()));
    await apertarEsc();

    expect(onAbertoMudou).not.toHaveBeenCalled();
    expect(aviso()?.textContent).toContain("Descartar o que você preencheu?");

    await apertarEsc();
    expect(aviso()).toBeNull();
    expect(onAbertoMudou).not.toHaveBeenCalled();
    expect(folha()).not.toBeNull();
  });

  it("motivo escolhido e foto anexada pedem confirmação", async () => {
    await montar();
    await clicar(botao("Aumentar Tênis", folha()));
    await clicar(botao("Continuar", folha()));
    await clicar(radio("defeito"));
    await escolherFoto();
    await fecharPeloX();

    expect(onAbertoMudou).not.toHaveBeenCalled();
    expect(aviso()?.textContent).toContain("fotos");
  });

  it("foto já enviada: 'Continuar' não apaga nada; 'Descartar' apaga uma vez só", async () => {
    enviarFoto.mockResolvedValue({ ok: true, valor: "u-1/oi/abc.jpg" });
    solicitar.mockResolvedValue({ ok: false, erro: "O servidor recusou." });
    await montar();
    await ateARevisao("defeito", "troca", "etiqueta_reversa");
    await clicar(botao("Confirmar devolução", folha()));
    expect(enviarFoto).toHaveBeenCalledTimes(1);
    expect(folha()).not.toBeNull();

    await fecharPeloX();
    await clicar(botao("Continuar preenchendo", aviso()));
    expect(descartarFotos).not.toHaveBeenCalled();

    await fecharPeloX();
    await clicar(botao("Descartar", aviso()));
    expect(folha()).toBeNull();
    expect(descartarFotos).toHaveBeenCalledTimes(1);
    expect(descartarFotos).toHaveBeenCalledWith(["u-1/oi/abc.jpg"]);
  });

  it("desmarcar o item que já vinha marcado não conta como preenchido", async () => {
    await montar(ELEGIBILIDADE_UMA_UNIDADE);
    await clicar(botao("Diminuir Tênis", folha()));
    await fecharPeloX();

    expect(onAbertoMudou).toHaveBeenCalledWith(false);
    expect(aviso()).toBeNull();
  });

  it("com o item que já vinha marcado e nada mais, fecha direto", async () => {
    await montar(ELEGIBILIDADE_UMA_UNIDADE);
    await fecharPeloX();

    expect(onAbertoMudou).toHaveBeenCalledWith(false);
    expect(aviso()).toBeNull();
  });

  it("enviando o pedido: fechar não oferece 'Descartar' e não fecha", async () => {
    solicitar.mockReturnValue(new Promise(() => {}));
    await montar();
    await ateARevisao("tamanho_pequeno", "reembolso", "envio_proprio");
    await clicar(botao("Confirmar devolução", folha()));
    expect(solicitar).toHaveBeenCalledTimes(1);

    await fecharPeloX();

    expect(onAbertoMudou).not.toHaveBeenCalled();
    expect(aviso()?.textContent).toContain("enviando");
    expect(botao("Descartar", aviso())).toBeUndefined();
    await clicar(botao("Aguardar", aviso()));
    expect(aviso()).toBeNull();
    expect(onAbertoMudou).not.toHaveBeenCalled();
  });

  it("pedido enviado (protocolo na tela): fecha direto, nada a perder", async () => {
    await montar();
    await ateARevisao("tamanho_pequeno", "reembolso", "envio_proprio");
    await clicar(botao("Confirmar devolução", folha()));
    expect(
      document.querySelector('[data-testid="devolucao-sucesso"]'),
    ).not.toBeNull();

    await fecharPeloX();

    expect(onAbertoMudou).toHaveBeenCalledWith(false);
    expect(aviso()).toBeNull();
    expect(descartarFotos).not.toHaveBeenCalled();
  });
});
