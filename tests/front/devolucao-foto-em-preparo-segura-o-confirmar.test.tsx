// @vitest-environment jsdom
//
// FOTO AINDA SENDO PREPARADA SEGURA O "CONFIRMAR DEVOLUÇÃO" (r189-a).
//
// Ao escolher a foto, a folha a confere ANTES de colocá-la na lista (tipo,
// se o aparelho a abre, se passa de 5 MB depois de reduzida). Em aparelho lento
// e foto grande isso demora. Antes, a cliente que escolhia a foto, tocava em
// "Continuar" e confirmava ANTES da conferência acabar mandava o pedido SEM a
// foto: a prova que ela achou que enviou ficava de fora.
// Agora, enquanto houver foto em preparo, duas travas em fila:
//   1. o botão de confirmar fica desabilitado ("Preparando a foto…");
//   2. `confirmar()` se recusa sozinho (o onClick chamado pulando o `disabled`).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ElegibilidadeDevolucao } from "@/types/devolucao";

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
}));

// Promessa que o teste resolve na hora que quiser.
function pendurada<T>() {
  let resolver!: (v: T) => void;
  let rejeitar!: (e: unknown) => void;
  const promessa = new Promise<T>((resolve, reject) => {
    resolver = resolve;
    rejeitar = reject;
  });
  return { promessa, resolver, rejeitar };
}

// O jsdom não decodifica imagem: o teste segura a conferência de cada foto.
const imagemAbre = vi.fn(async (_arquivo: File) => true);
vi.mock("@/lib/imagem-abre", () => ({
  imagemAbre: (arquivo: File) => imagemAbre(arquivo),
}));
vi.mock("@/lib/redimensiona-imagem", () => ({
  redimensionarImagem: async (arquivo: File) => arquivo,
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
    texto_politica: null,
    endereco_devolucao: null,
    updated_at: null,
  },
};

const RESULTADO = {
  id: "dev-1",
  protocolo: "DEV-0001",
  tipo: "arrependimento",
  status: "solicitada",
};

const solicitar = vi.fn();
const enviarFoto = vi.fn();
const descartarFotos = vi.fn();
let raiz: Root;
let hospedeiro: HTMLDivElement;
let desmontada = false;

beforeEach(() => {
  desmontada = false;
  solicitar.mockReset().mockResolvedValue({ ok: true, valor: RESULTADO });
  enviarFoto.mockReset().mockImplementation(async (arquivo: File) => ({
    ok: true,
    valor: `u-1/o-1/${arquivo.name}`,
  }));
  descartarFotos.mockReset().mockResolvedValue(undefined);
  imagemAbre.mockReset().mockResolvedValue(true);
  vi.mocked(toast.error).mockClear();
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  if (!desmontada) act(() => raiz.unmount());
  hospedeiro.remove();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
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

/** Deixa as microtarefas pendentes correrem (sem destravar promessa segurada). */
async function assentar() {
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
}

/**
 * Chama o `onClick` que o React guarda no botão, PULANDO o `disabled`: é o que
 * isola a trava de dentro de `confirmar()` da trava do botão.
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

/** Abre a folha e vai ao passo do motivo (foto opcional: motivo "não gostei"). */
async function ateOPassoDasFotos() {
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
  await clicar(radio("nao_gostei"));
}

async function escolher(arquivos: File[]) {
  const entrada = folha()?.querySelector<HTMLInputElement>(
    '[data-testid="entrada-fotos-devolucao"]',
  );
  expect(entrada).toBeTruthy();
  Object.defineProperty(entrada, "files", {
    configurable: true,
    value: arquivos,
  });
  await act(async () => {
    entrada?.dispatchEvent(new Event("change", { bubbles: true }));
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
}

/** Do passo do motivo até o 4, onde fica o "Confirmar devolução". */
async function ateORevisar() {
  await clicar(botao("Continuar"));
  await clicar(radio("reembolso"));
  await clicar(radio("envio_proprio"));
  await clicar(botao("Continuar"));
  expect(folha()?.textContent).toContain("Passo 4 de 4");
}

const arquivo = (nome: string) => new File(["x"], nome, { type: "image/jpeg" });

/** O botão do passo 4: com o texto de confirmar, ou de preparo, ou de envio. */
const botaoFinal = () =>
  Array.from(folha()?.querySelectorAll("button") ?? []).find((b) =>
    /Confirmar devolução|Preparando a foto|Enviando|Registrando/.test(
      b.textContent ?? "",
    ),
  );

const fotosEnviadasAoPedido = (): string[] =>
  solicitar.mock.calls[0][0].fotos as string[];

describe("Devolução — foto em preparo segura o Confirmar", () => {
  it("foto ainda sendo conferida: botão desabilitado, confirmar não envia; ao terminar, o pedido leva a foto", async () => {
    const conferencia = pendurada<boolean>();
    imagemAbre.mockReturnValue(conferencia.promessa);
    await ateOPassoDasFotos();
    await escolher([arquivo("do-tenis.jpg")]);
    await ateORevisar();

    // A conferência não terminou: a foto ainda não está na lista.
    const final = botaoFinal();
    expect(final?.disabled).toBe(true);
    expect(final?.textContent).toContain("Preparando a foto");
    await clicar(final);
    // Trava de dentro de confirmar(), sem a ajuda do `disabled`.
    await chamarOnClickPulandoODisabled(final);
    expect(solicitar).not.toHaveBeenCalled();
    expect(enviarFoto).not.toHaveBeenCalled();

    await act(async () => {
      conferencia.resolver(true);
    });
    await assentar();

    // Foto entrou, o botão voltou: agora confirma COM a foto.
    expect(botaoFinal()?.disabled).toBe(false);
    expect(botaoFinal()?.textContent).toContain("Confirmar devolução");
    await clicar(botaoFinal());
    expect(enviarFoto).toHaveBeenCalledTimes(1);
    expect(solicitar).toHaveBeenCalledTimes(1);
    expect(fotosEnviadasAoPedido()).toEqual(["u-1/o-1/do-tenis.jpg"]);
  });

  it("controle: sem foto em preparo, o confirmar funciona como sempre", async () => {
    await ateOPassoDasFotos();
    await ateORevisar();

    expect(botaoFinal()?.disabled).toBe(false);
    expect(botaoFinal()?.textContent).toContain("Confirmar devolução");
    await clicar(botaoFinal());
    expect(solicitar).toHaveBeenCalledTimes(1);
    expect(fotosEnviadasAoPedido()).toEqual([]);
  });

  it("controle: foto já conferida e na lista não prende o botão", async () => {
    await ateOPassoDasFotos();
    await escolher([arquivo("pronta.jpg")]);
    await ateORevisar();

    expect(botaoFinal()?.disabled).toBe(false);
    await clicar(botaoFinal());
    expect(fotosEnviadasAoPedido()).toEqual(["u-1/o-1/pronta.jpg"]);
  });

  it("foto recusada na conferência: o preparo termina, o botão volta e o pedido segue sem ela", async () => {
    const conferencia = pendurada<boolean>();
    imagemAbre.mockReturnValue(conferencia.promessa);
    await ateOPassoDasFotos();
    await escolher([arquivo("estragada.jpg")]);
    await ateORevisar();
    expect(botaoFinal()?.disabled).toBe(true);

    await act(async () => {
      conferencia.resolver(false);
    });
    await assentar();

    expect(vi.mocked(toast.error)).toHaveBeenCalledTimes(1);
    expect(botaoFinal()?.disabled).toBe(false);
    await clicar(botaoFinal());
    expect(enviarFoto).not.toHaveBeenCalled();
    expect(fotosEnviadasAoPedido()).toEqual([]);
  });

  it("erro inesperado na conferência: o contador volta, o botão nunca fica preso", async () => {
    const conferencia = pendurada<boolean>();
    imagemAbre.mockReturnValue(conferencia.promessa);
    // `adicionarFotos` roda solto no onChange (`void`): o erro vira rejeição
    // não tratada, como já era antes desta correção. O teste a captura para
    // o Vitest não reprovar a rodada por ela, e confirma que ela aconteceu.
    const ouvintesDoVitest = process.listeners("unhandledRejection");
    process.removeAllListeners("unhandledRejection");
    const rejeicoes: unknown[] = [];
    const captura = (motivo: unknown) => rejeicoes.push(motivo);
    process.on("unhandledRejection", captura);
    try {
      await ateOPassoDasFotos();
      await escolher([arquivo("quebra.jpg")]);
      await ateORevisar();
      expect(botaoFinal()?.disabled).toBe(true);

      await act(async () => {
        conferencia.rejeitar(new Error("decodificador caiu"));
      });
      await assentar();
      await new Promise((r) => setTimeout(r, 0));
    } finally {
      process.off("unhandledRejection", captura);
      for (const ouvinte of ouvintesDoVitest) {
        process.on("unhandledRejection", ouvinte);
      }
    }

    expect(rejeicoes).toHaveLength(1);
    expect(botaoFinal()?.disabled).toBe(false);
    await clicar(botaoFinal());
    expect(solicitar).toHaveBeenCalledTimes(1);
    expect(fotosEnviadasAoPedido()).toEqual([]);
  });

  it("duas fotos escolhidas em seguida: só libera quando as duas terminarem", async () => {
    const a = pendurada<boolean>();
    const b = pendurada<boolean>();
    imagemAbre.mockImplementation((f: File) =>
      f.name === "a.jpg" ? a.promessa : b.promessa,
    );
    await ateOPassoDasFotos();
    await escolher([arquivo("a.jpg")]);
    await escolher([arquivo("b.jpg")]);
    await ateORevisar();
    expect(botaoFinal()?.disabled).toBe(true);

    // A primeira termina, a segunda ainda não: continua preso.
    await act(async () => {
      a.resolver(true);
    });
    await assentar();
    expect(botaoFinal()?.disabled).toBe(true);
    expect(botaoFinal()?.textContent).toContain("Preparando a foto");
    await chamarOnClickPulandoODisabled(botaoFinal());
    expect(solicitar).not.toHaveBeenCalled();

    await act(async () => {
      b.resolver(true);
    });
    await assentar();
    expect(botaoFinal()?.disabled).toBe(false);
    await clicar(botaoFinal());
    expect(fotosEnviadasAoPedido().sort()).toEqual([
      "u-1/o-1/a.jpg",
      "u-1/o-1/b.jpg",
    ]);
  });

  it("tela fechada durante o preparo: nada de aviso de estado, nem foto solta no bucket", async () => {
    const erroNoConsole = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const conferencia = pendurada<boolean>();
    imagemAbre.mockReturnValue(conferencia.promessa);
    await ateOPassoDasFotos();
    await escolher([arquivo("fechou.jpg")]);

    desmontada = true;
    await act(async () => raiz.unmount());
    await act(async () => {
      conferencia.resolver(true);
    });
    await assentar();

    expect(erroNoConsole).not.toHaveBeenCalled();
    expect(solicitar).not.toHaveBeenCalled();
    expect(enviarFoto).not.toHaveBeenCalled();
    expect(descartarFotos).not.toHaveBeenCalled();
  });
});
