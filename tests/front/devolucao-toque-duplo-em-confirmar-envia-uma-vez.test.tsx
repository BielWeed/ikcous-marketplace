// @vitest-environment jsdom
//
// TOQUE DUPLO EM "CONFIRMAR DEVOLUÇÃO" ENVIA UMA VEZ SÓ (r136-b).
//
// No passo 4, a cliente que toca duas vezes em "Confirmar devolução" não pode
// subir a foto duas vezes nem abrir dois pedidos de devolução (dois
// protocolos, duas etiquetas). Duas travas em fila, uma atrás da outra:
//   1. `disabled={enviando}` no botão (o React nem entrega o clique);
//   2. `if (enviando || ...) return;` no começo de `confirmar()`.
// Cada uma esconde a falta da outra, então o teste as prova SEPARADAS: o botão
// tem de estar desabilitado de verdade (trava 1), e `confirmar()` chamado
// DIRETO -- pelo mesmo `onClick` que o React guarda, pulando o `disabled` --
// tem de se recusar sozinho (trava 2).
import { act } from "react";
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
// jsdom não decodifica imagens; só a conferência de abertura é dublada.
vi.mock("@/lib/imagem-abre", () => ({ imagemAbre: async () => true }));

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

const solicitar = vi.fn();
const enviarFoto = vi.fn();
const descartarFotos = vi.fn();
let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.resetAllMocks();
  descartarFotos.mockResolvedValue(undefined);
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

const folha = () =>
  document.querySelector<HTMLElement>('[data-testid="folha-devolucao"]');

function botao(texto: string): HTMLButtonElement | undefined {
  return Array.from(folha()?.querySelectorAll("button") ?? []).find(
    (b) =>
      b.textContent?.trim() === texto || b.getAttribute("aria-label") === texto,
  );
}

async function clicar(el: HTMLElement | null | undefined) {
  expect(el).toBeTruthy();
  await act(async () => {
    el?.click();
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
}

/**
 * Chama o `onClick` que o React guarda no botão, PULANDO o `disabled` (o React
 * e o DOM nem entregam clique a botão desabilitado). É o que isola a trava de
 * dentro de `confirmar()`.
 */
async function chamarOnClickPulandoODisabled(el: HTMLElement | undefined) {
  const chave = Object.keys(el ?? {}).find((k) =>
    k.startsWith("__reactProps$"),
  );
  expect(chave, "props do React no botão").toBeTruthy();
  const onClick = (el as unknown as Record<string, { onClick?: () => void }>)[
    chave as string
  ].onClick;
  expect(onClick).toBeTypeOf("function");
  await act(async () => {
    onClick?.();
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
}

const radio = (valor: string) =>
  folha()?.querySelector<HTMLInputElement>(
    `input[type="radio"][value="${valor}"]`,
  );

async function ateARevisaoComFoto() {
  const { SolicitarDevolucaoSheet } = await import(
    "@/components/devolucao/SolicitarDevolucaoSheet"
  );
  await act(async () => {
    raiz.render(
      <SolicitarDevolucaoSheet
        aberto
        onAbertoMudou={vi.fn()}
        elegibilidade={ELEGIBILIDADE}
        userId="u-1"
        enderecoDaLoja="Rua de Teste, 10"
        horarioDaLoja="Seg a Sex, 9h às 18h"
        solicitar={solicitar}
        enviarFoto={enviarFoto}
        descartarFotos={descartarFotos}
      />,
    );
  });
  await clicar(botao("Aumentar Tênis"));
  await clicar(botao("Continuar"));
  await clicar(radio("avariado_no_transporte"));
  const entrada = folha()?.querySelector<HTMLInputElement>(
    '[data-testid="entrada-fotos-devolucao"]',
  );
  expect(entrada).toBeTruthy();
  Object.defineProperty(entrada, "files", {
    configurable: true,
    value: [new File(["x"], "foto.jpg", { type: "image/jpeg" })],
  });
  await act(async () => {
    entrada?.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await clicar(botao("Continuar"));
  await clicar(radio("reembolso"));
  await clicar(radio("envio_proprio"));
  await clicar(botao("Continuar"));
  expect(folha()?.textContent).toContain("Passo 4 de 4");
}

const CAMINHO = "u-1/o-1/abc.jpg";
const RESULTADO = {
  id: "dev-1",
  protocolo: "DEV-0001",
  tipo: "devolucao",
  status: "solicitada",
};

// Promessa que o teste resolve na hora que quiser.
function pendurada<T>() {
  let resolver!: (v: T) => void;
  const promessa = new Promise<T>((resolve) => {
    resolver = resolve;
  });
  return { promessa, resolver };
}

const confirmar = () => botao("Confirmar devolução");

describe("Devolução — toque duplo em Confirmar", () => {
  it("foto subindo: o segundo toque não sobe a foto de novo nem chama o pedido", async () => {
    const foto = pendurada<{ ok: true; valor: string }>();
    enviarFoto.mockReturnValue(foto.promessa);
    solicitar.mockResolvedValue({ ok: true, valor: RESULTADO });
    await ateARevisaoComFoto();

    const botaoDeConfirmar = confirmar();
    await clicar(botaoDeConfirmar);
    await clicar(botaoDeConfirmar);

    expect(enviarFoto).toHaveBeenCalledTimes(1);
    expect(solicitar).not.toHaveBeenCalled();
    // Mesmo botão, agora com o texto de andamento, e desabilitado.
    expect(botaoDeConfirmar?.disabled).toBe(true);

    await act(async () => {
      foto.resolver({ ok: true, valor: CAMINHO });
    });
    expect(enviarFoto).toHaveBeenCalledTimes(1);
    expect(solicitar).toHaveBeenCalledTimes(1);
  });

  it("pedido sendo registrado: o segundo toque não abre outro pedido, e só UM protocolo aparece", async () => {
    const pedido = pendurada<{ ok: true; valor: typeof RESULTADO }>();
    enviarFoto.mockResolvedValue({ ok: true, valor: CAMINHO });
    solicitar.mockReturnValue(pedido.promessa);
    await ateARevisaoComFoto();

    const botaoDeConfirmar = confirmar();
    await clicar(botaoDeConfirmar);
    expect(solicitar).toHaveBeenCalledTimes(1);
    await clicar(botaoDeConfirmar);

    expect(enviarFoto).toHaveBeenCalledTimes(1);
    expect(solicitar).toHaveBeenCalledTimes(1);
    expect(botaoDeConfirmar?.disabled).toBe(true);
    expect(
      document.querySelector('[data-testid="devolucao-sucesso"]'),
    ).toBeNull();

    await act(async () => {
      pedido.resolver({ ok: true, valor: RESULTADO });
    });

    expect(solicitar).toHaveBeenCalledTimes(1);
    const sucesso = document.querySelectorAll(
      '[data-testid="devolucao-sucesso"]',
    );
    expect(sucesso).toHaveLength(1);
    expect(sucesso[0].textContent).toContain("DEV-0001");
  });

  it("a trava de dentro de confirmar() vale sozinha: onClick chamado pulando o disabled, com a foto subindo, não sobe de novo", async () => {
    const foto = pendurada<{ ok: true; valor: string }>();
    enviarFoto.mockReturnValue(foto.promessa);
    solicitar.mockResolvedValue({ ok: true, valor: RESULTADO });
    await ateARevisaoComFoto();

    const botaoDeConfirmar = confirmar();
    await clicar(botaoDeConfirmar);
    expect(botaoDeConfirmar?.disabled).toBe(true);
    await chamarOnClickPulandoODisabled(botaoDeConfirmar);
    await chamarOnClickPulandoODisabled(botaoDeConfirmar);

    expect(enviarFoto).toHaveBeenCalledTimes(1);
    expect(solicitar).not.toHaveBeenCalled();

    await act(async () => {
      foto.resolver({ ok: true, valor: CAMINHO });
    });
    expect(solicitar).toHaveBeenCalledTimes(1);
  });

  it("a trava de dentro de confirmar() vale sozinha: onClick pulando o disabled, com o pedido sendo registrado, não abre outro", async () => {
    const pedido = pendurada<{ ok: true; valor: typeof RESULTADO }>();
    enviarFoto.mockResolvedValue({ ok: true, valor: CAMINHO });
    solicitar.mockReturnValue(pedido.promessa);
    await ateARevisaoComFoto();

    const botaoDeConfirmar = confirmar();
    await clicar(botaoDeConfirmar);
    expect(solicitar).toHaveBeenCalledTimes(1);
    await chamarOnClickPulandoODisabled(botaoDeConfirmar);

    expect(enviarFoto).toHaveBeenCalledTimes(1);
    expect(solicitar).toHaveBeenCalledTimes(1);

    await act(async () => {
      pedido.resolver({ ok: true, valor: RESULTADO });
    });
    expect(solicitar).toHaveBeenCalledTimes(1);
    expect(
      document.querySelectorAll('[data-testid="devolucao-sucesso"]'),
    ).toHaveLength(1);
  });

  it("CONTROLE: antes do primeiro toque o botão está habilitado e UM toque envia uma vez", async () => {
    enviarFoto.mockResolvedValue({ ok: true, valor: CAMINHO });
    solicitar.mockResolvedValue({ ok: true, valor: RESULTADO });
    await ateARevisaoComFoto();

    expect(confirmar()?.disabled).toBe(false);
    await clicar(confirmar());

    expect(enviarFoto).toHaveBeenCalledTimes(1);
    expect(solicitar).toHaveBeenCalledTimes(1);
    expect(
      document.querySelectorAll('[data-testid="devolucao-sucesso"]'),
    ).toHaveLength(1);
  });

  it("CONTROLE: a loja recusa o pedido -- o botão volta a valer e um novo toque tenta de novo (a trava solta)", async () => {
    enviarFoto.mockResolvedValue({ ok: true, valor: CAMINHO });
    solicitar
      .mockResolvedValueOnce({ ok: false, erro: "Tente de novo." })
      .mockResolvedValueOnce({ ok: true, valor: RESULTADO });
    await ateARevisaoComFoto();

    await clicar(confirmar());
    expect(solicitar).toHaveBeenCalledTimes(1);
    expect(confirmar()?.disabled).toBe(false);

    await clicar(confirmar());
    expect(solicitar).toHaveBeenCalledTimes(2);
    // A foto já subiu na primeira tentativa e não sobe de novo.
    expect(enviarFoto).toHaveBeenCalledTimes(1);
  });
});
