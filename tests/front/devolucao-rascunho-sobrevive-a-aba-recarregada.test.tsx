// @vitest-environment jsdom
//
// No celular, tocar em "Adicionar" foto abre a câmera/galeria e a aba vai para
// segundo plano. Se o Android ou o iPhone descartam a aba, ela RECARREGA ao
// voltar: a folha nascia fechada (estado inicial `false` na tela do pedido) e
// itens marcados, motivo, texto, solução e forma de devolver sumiam. Agora o
// rascunho (sem as fotos) fica no `sessionStorage` da aba, por conta e por
// pedido, e vale por algumas horas: ao voltar, a folha reabre com ele e avisa
// para escolher as fotos de novo. Enviado com sucesso ou descartado, some.
//
// "Recarregar" aqui = desmontar a raiz e montar de novo com o MESMO
// `sessionStorage` e o estado da tela zerado (folha fechada), que é o que o
// navegador faz ao trazer de volta uma aba descartada.
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

// O jsdom não decodifica imagem: a conferência "a foto abre?" é dublada aqui.
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

const solicitar = vi.fn();
const enviarFoto = vi.fn();
const descartarFotos = vi.fn();

let raiz: Root;
let hospedeiro: HTMLDivElement;

function novaRaiz() {
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
}

beforeEach(() => {
  solicitar.mockReset();
  enviarFoto.mockReset();
  descartarFotos.mockReset();
  descartarFotos.mockResolvedValue(undefined);
  enviarFoto.mockResolvedValue({ ok: true, valor: "u-1/o-1/foto.jpg" });
  solicitar.mockResolvedValue({
    ok: true,
    valor: {
      id: "d-1",
      protocolo: "DV261127-TESTE",
      tipo: "vicio",
      status: "solicitada",
    },
  });
  novaRaiz();
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  document.body.innerHTML = "";
  sessionStorage.clear();
  vi.useRealTimers();
});

interface Montagem {
  userId?: string;
  orderId?: string;
  elegibilidade?: ElegibilidadeDevolucao;
  abertoNoInicio?: boolean;
}

// Como a tela do pedido monta a folha: estado próprio, que nasce FECHADO.
async function montar({
  userId = "u-1",
  orderId = "o-1",
  elegibilidade = ELEGIBILIDADE,
  abertoNoInicio = false,
}: Montagem = {}) {
  const { SolicitarDevolucaoSheet } = await import(
    "@/components/devolucao/SolicitarDevolucaoSheet"
  );
  function TelaDoPedido() {
    const [aberto, setAberto] = useState(abertoNoInicio);
    return (
      <>
        <button type="button" onClick={() => setAberto(true)}>
          Solicitar devolução ou troca
        </button>
        <SolicitarDevolucaoSheet
          aberto={aberto}
          onAbertoMudou={setAberto}
          elegibilidade={elegibilidade}
          orderId={orderId}
          userId={userId}
          enderecoDaLoja="Rua Inventada, 10"
          horarioDaLoja={null}
          solicitar={solicitar}
          enviarFoto={enviarFoto}
          descartarFotos={descartarFotos}
        />
      </>
    );
  }
  await act(async () => {
    raiz.render(<TelaDoPedido />);
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
}

// A aba descartada volta: a página inteira nasce de novo, o sessionStorage fica.
async function recarregarAAba(montagem: Montagem = {}) {
  act(() => raiz.unmount());
  hospedeiro.remove();
  document.body.innerHTML = "";
  novaRaiz();
  await montar(montagem);
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
const textoDoDetalhe = () =>
  folha()?.querySelector<HTMLTextAreaElement>("#devolucao-detalhe");
const passoNaTela = () =>
  folha()?.textContent?.match(/Passo (\d) de 4/)?.[1] ?? null;
const quantidadeDoTenis = () =>
  botao("Aumentar Tênis", folha())?.previousElementSibling?.textContent;

async function escrever(texto: string) {
  const campo = textoDoDetalhe();
  expect(campo).toBeTruthy();
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    setter?.call(campo, texto);
    campo?.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function escolherFoto(nome = "foto-inventada.jpg") {
  const entrada = folha()?.querySelector<HTMLInputElement>(
    '[data-testid="entrada-fotos-devolucao"]',
  );
  expect(entrada).toBeTruthy();
  const arquivo = new File(["x"], nome, { type: "image/jpeg" });
  Object.defineProperty(entrada, "files", {
    configurable: true,
    value: [arquivo],
  });
  await act(async () => {
    entrada?.dispatchEvent(new Event("change", { bubbles: true }));
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
}

// A cliente abre a folha, marca 2 unidades, escolhe "Defeito", escreve, escolhe
// uma foto e (como no celular) a aba some enquanto ela está no passo 2.
async function preencherAteAFoto() {
  await montar();
  await clicar(botao("Solicitar devolução ou troca"));
  expect(folha()).not.toBeNull();
  await clicar(botao("Aumentar Tênis", folha()));
  await clicar(botao("Aumentar Tênis", folha()));
  await clicar(botao("Continuar", folha()));
  await clicar(radio("defeito"));
  await escrever("A sola descolou no segundo dia.");
  await escolherFoto();
}

const chavesDoRascunho = () =>
  Object.keys(sessionStorage).filter((k) =>
    k.includes("rascunho-da-devolucao"),
  );

describe("a folha de devolução sobrevive à aba recarregada", () => {
  it("volta aberta, no passo 2, com itens, motivo e texto, e pede as fotos de novo", async () => {
    await preencherAteAFoto();

    await recarregarAAba();

    expect(folha()).not.toBeNull();
    expect(passoNaTela()).toBe("2");
    expect(radio("defeito")?.checked).toBe(true);
    expect(textoDoDetalhe()?.value).toBe("A sola descolou no segundo dia.");
    expect(folha()?.textContent).toContain("Escolha as fotos de novo");
    // A foto em si não volta (nunca foi guardada).
    expect(folha()?.querySelector('[aria-label="Remover foto"]')).toBeNull();

    await clicar(botao("Voltar", folha()));
    expect(quantidadeDoTenis()).toBe("2");
  });

  it("o que fica guardado é só o que está na tela: nenhuma foto, nome de arquivo ou caminho", async () => {
    await preencherAteAFoto();

    const chaves = chavesDoRascunho();
    expect(chaves).toHaveLength(1);
    expect(chaves[0]).toContain("u-1");
    expect(chaves[0]).toContain("o-1");
    const guardado = sessionStorage.getItem(chaves[0]) ?? "";
    expect(guardado).toContain("A sola descolou no segundo dia.");
    expect(guardado).not.toContain("foto-inventada");
    expect(guardado).not.toContain("blob:");
    expect(guardado).not.toContain("u-1/o-1/");
    expect(guardado).not.toContain("Rua Inventada");
  });

  it("com a solução e a forma escolhidas, volta no ponto em que estava", async () => {
    await montar();
    await clicar(botao("Solicitar devolução ou troca"));
    await clicar(botao("Aumentar Tênis", folha()));
    await clicar(botao("Continuar", folha()));
    await clicar(radio("tamanho_pequeno"));
    await clicar(botao("Continuar", folha()));
    await clicar(radio("troca"));
    await clicar(radio("envio_proprio"));
    await clicar(botao("Continuar", folha()));
    expect(passoNaTela()).toBe("4");

    await recarregarAAba();

    expect(folha()).not.toBeNull();
    expect(passoNaTela()).toBe("4");
    expect(folha()?.textContent).toContain("Troca");
    expect(folha()?.textContent).not.toContain("Escolha as fotos de novo");
  });

  it("outra conta na mesma aba não vê nem reabre o rascunho da anterior", async () => {
    await preencherAteAFoto();

    await recarregarAAba({ userId: "u-2" });

    expect(folha()).toBeNull();
    await clicar(botao("Solicitar devolução ou troca"));
    expect(folha()).not.toBeNull();
    expect(passoNaTela()).toBe("1");
    expect(quantidadeDoTenis()).toBe("0");
    expect(folha()?.textContent).not.toContain("Escolha as fotos de novo");
    await clicar(botao("Continuar", folha()));
    expect(folha()?.textContent).not.toContain("A sola descolou");
  });

  it("o rascunho guardado com o dono trocado à mão também é ignorado", async () => {
    await preencherAteAFoto();
    const [chave] = chavesDoRascunho();
    const adulterado = JSON.parse(sessionStorage.getItem(chave) ?? "{}");
    adulterado.conta = "u-2";
    sessionStorage.setItem(chave, JSON.stringify(adulterado));

    await recarregarAAba();

    expect(folha()).toBeNull();
  });

  it("outro pedido da mesma conta não reabre o rascunho", async () => {
    await preencherAteAFoto();

    await recarregarAAba({ orderId: "o-2" });

    expect(folha()).toBeNull();
  });

  it("rascunho vencido (horas depois) não reabre e é apagado", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-27T10:00:00Z"));
    await preencherAteAFoto();
    expect(chavesDoRascunho()).toHaveLength(1);

    vi.setSystemTime(new Date("2026-11-27T22:00:00Z"));
    await recarregarAAba();

    expect(folha()).toBeNull();
    expect(chavesDoRascunho()).toHaveLength(0);
  });

  it("rascunho de poucos minutos atrás ainda vale", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-27T10:00:00Z"));
    await preencherAteAFoto();

    vi.setSystemTime(new Date("2026-11-27T10:20:00Z"));
    await recarregarAAba();

    expect(folha()).not.toBeNull();
    expect(radio("defeito")?.checked).toBe(true);
  });

  it("rascunho ilegível no armazenamento não quebra a tela nem reabre a folha", async () => {
    sessionStorage.setItem(
      "ikcous:rascunho-da-devolucao:u-1:o-1",
      "{nao-e-json",
    );

    await montar();

    expect(folha()).toBeNull();
    await clicar(botao("Solicitar devolução ou troca"));
    expect(passoNaTela()).toBe("1");
  });

  it("pedido que não pode mais ser devolvido (já existe devolução): não reabre e apaga", async () => {
    await preencherAteAFoto();

    await recarregarAAba({
      elegibilidade: {
        ...ELEGIBILIDADE,
        pode: false,
        motivo_bloqueio:
          "Já existe uma devolução em andamento para este pedido.",
      },
    });

    expect(folha()).toBeNull();
    expect(chavesDoRascunho()).toHaveLength(0);
  });

  it("'Descartar' apaga o rascunho: recarregar depois não reabre nada", async () => {
    await preencherAteAFoto();
    await clicar(botao("Fechar", folha()));
    await clicar(botao("Descartar", aviso()));
    expect(folha()).toBeNull();
    expect(chavesDoRascunho()).toHaveLength(0);

    await recarregarAAba();

    expect(folha()).toBeNull();
  });

  it("pedido enviado com sucesso apaga o rascunho", async () => {
    await preencherAteAFoto();
    await clicar(botao("Continuar", folha()));
    await clicar(radio("troca"));
    await clicar(radio("envio_proprio"));
    await clicar(botao("Continuar", folha()));
    await clicar(botao("Confirmar devolução", folha()));
    expect(
      document.querySelector('[data-testid="devolucao-sucesso"]'),
    ).not.toBeNull();
    expect(chavesDoRascunho()).toHaveLength(0);

    await recarregarAAba();

    expect(folha()).toBeNull();
  });

  it("envio recusado mantém o rascunho (a cliente ainda pode tentar de novo depois)", async () => {
    solicitar.mockResolvedValue({ ok: false, erro: "Recusado pelo teste." });
    await preencherAteAFoto();
    await clicar(botao("Continuar", folha()));
    await clicar(radio("troca"));
    await clicar(radio("envio_proprio"));
    await clicar(botao("Continuar", folha()));
    await clicar(botao("Confirmar devolução", folha()));

    expect(chavesDoRascunho()).toHaveLength(1);
  });

  it("nada preenchido além do item que já vinha marcado: não guarda nada", async () => {
    await montar({
      elegibilidade: {
        ...ELEGIBILIDADE,
        itens: [{ ...ELEGIBILIDADE.itens[0], quantidade: 1, disponivel: 1 }],
      },
    });
    await clicar(botao("Solicitar devolução ou troca"));
    expect(folha()).not.toBeNull();

    expect(chavesDoRascunho()).toHaveLength(0);
  });

  it("sem o id do pedido a folha funciona como antes e não guarda nada", async () => {
    const { SolicitarDevolucaoSheet } = await import(
      "@/components/devolucao/SolicitarDevolucaoSheet"
    );
    await act(async () => {
      raiz.render(
        <SolicitarDevolucaoSheet
          aberto
          onAbertoMudou={() => {}}
          elegibilidade={ELEGIBILIDADE}
          userId="u-1"
          enderecoDaLoja={null}
          horarioDaLoja={null}
          solicitar={solicitar}
          enviarFoto={enviarFoto}
        />,
      );
    });
    await clicar(botao("Aumentar Tênis", folha()));

    expect(chavesDoRascunho()).toHaveLength(0);
  });
});
