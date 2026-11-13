// @vitest-environment jsdom
//
// DUAS ESCOLHAS DE FOTO EM PREPARO NÃO PASSAM DE 6 (r367-a).
//
// A folha confere cada foto ANTES de colocá-la na lista (demora em aparelho
// lento) e, enquanto confere, o "Adicionar" continua à mão. Cada escolha
// calculava as vagas com a MESMA lista velha (`fotos.length` do instante do
// toque) e, ao terminar, anexava tudo: 4 + 4 = 8 fotos, acima do limite de 6
// que a tela mostra ("8/6") e que o servidor recusa depois. O teto agora é
// aplicado dentro do atualizador de `setFotos`, onde a lista é a de verdade.
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

const nomes = (prefixo: string, quantas: number) =>
  Array.from({ length: quantas }, (_, i) => arquivo(`${prefixo}-${i + 1}.jpg`));

/** Deixa a fila de conferências (várias fotos, cada uma com seus `await`) correr. */
async function assentarTudo() {
  for (let i = 0; i < 8; i++) await assentar();
}

const contador = () =>
  /(\d+)\/6/.exec(folha()?.textContent ?? "")?.[1] ?? "sem contador";

describe("Devolução — duas escolhas de foto sobrepostas respeitam o limite de 6", () => {
  it("4 + 4 escolhidas enquanto a 1ª ainda confere: ficam 6, e só 6 seguem no pedido", async () => {
    const conferencia = pendurada<boolean>();
    imagemAbre.mockReturnValue(conferencia.promessa);
    await ateOPassoDasFotos();
    await escolher(nomes("a", 4));
    // "Adicionar" segue à mão enquanto a 1ª escolha confere: a 2ª calcula as
    // vagas com a mesma lista (vazia) de antes.
    await escolher(nomes("b", 4));

    await act(async () => {
      conferencia.resolver(true);
    });
    await assentarTudo();

    expect(contador()).toBe("6");
    await ateORevisar();
    await clicar(botaoFinal());
    expect(solicitar).toHaveBeenCalledTimes(1);
    expect(fotosEnviadasAoPedido()).toHaveLength(6);
    expect(enviarFoto).toHaveBeenCalledTimes(6);
  });

  it("3 + 3 + 3 sobrepostas: ficam 6", async () => {
    const conferencia = pendurada<boolean>();
    imagemAbre.mockReturnValue(conferencia.promessa);
    await ateOPassoDasFotos();
    await escolher(nomes("a", 3));
    await escolher(nomes("b", 3));
    await escolher(nomes("c", 3));

    await act(async () => {
      conferencia.resolver(true);
    });
    await assentarTudo();

    expect(contador()).toBe("6");
    await ateORevisar();
    await clicar(botaoFinal());
    expect(fotosEnviadasAoPedido()).toHaveLength(6);
  });

  it("limite exato: 3 + 3 sobrepostas cabem sem perder nenhuma", async () => {
    const conferencia = pendurada<boolean>();
    imagemAbre.mockReturnValue(conferencia.promessa);
    await ateOPassoDasFotos();
    await escolher(nomes("a", 3));
    await escolher(nomes("b", 3));

    await act(async () => {
      conferencia.resolver(true);
    });
    await assentarTudo();

    expect(contador()).toBe("6");
    await ateORevisar();
    await clicar(botaoFinal());
    expect(fotosEnviadasAoPedido().sort()).toEqual(
      [...nomes("a", 3), ...nomes("b", 3)]
        .map((f) => `u-1/o-1/${f.name}`)
        .sort(),
    );
  });

  it("controle (um depois do outro, sem sobreposição): 4 e depois 4 ficam em 6 e a tela avisa do máximo", async () => {
    await ateOPassoDasFotos();
    await escolher(nomes("a", 4));
    await assentarTudo();
    expect(contador()).toBe("4");

    await escolher(nomes("b", 4));
    await assentarTudo();
    expect(contador()).toBe("6");
    expect(vi.mocked(toast.info)).toHaveBeenCalledWith(
      "Envie no máximo 6 fotos.",
    );
  });
});
