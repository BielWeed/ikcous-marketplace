// @vitest-environment jsdom
//
// Liberação AUTOMÁTICA do pagamento pelo app (30/09/2026, pedido do dono: "a
// partir do momento que ela cola lá, webhook dela, ela já libera... tem que
// ser assim pra todo mundo"). Este arquivo SUBSTITUI o antigo
// `admin-mercado-pago-interruptor-do-pix.test.tsx` (mp-4, X1–X10): o
// interruptor "Receber PIX no app" deixou de existir — as três chaves salvas +
// o teste de conexão que passou LIGAM sozinhos, e a seção Mercado Pago
// mostra o ESTADO que o servidor devolveu, nunca um palpite do clique.
//
// O que ESTE arquivo prova (a edge é DUBLÊ; as chaves são FALSAS de mentira):
//   A1  "Recebendo pelo app (Pix e cartão)" + botão "Pausar", e nenhum
//       interruptor na tela;
//   A2  Pausar chama a edge (`desligar_pix`), a tela vira "Pausado por você" +
//       "Retomar", avisa a vitrine (até 1 minuto) e ecoa para o painel;
//   A3  Retomar chama `ligar_pix` e volta a "Recebendo";
//   A4  recusa do servidor ao retomar NÃO mente: o recado aparece e o estado
//       continua "Pausado";
//   A5  faltando chave/teste: "Falta para receber pelo app:" com a lista em
//       linguagem de leigo, e NENHUM botão de ligar ou pausar;
//   A6  ligado (loja que já existia) mas com falta: aviso âmbar com o
//       "Testar conexão" ao alcance;
//   A7  tudo preenchido e desligado sem pausa: a tela diz o que fazer;
//   A8  depois de SALVAR as três chaves a tela mostra o resultado do teste
//       automático e o novo estado, e o painel de Ajustes recebe o eco;
//   A9  salvar com teste recusado: recado vermelho do teste + aviso + lista;
//   A10 salvar credencial nova que o servidor desligou (`pix_desligado`):
//       a mensagem aparece e o eco vai para o painel;
//   A11 "Testar conexão" também reflete o que o servidor reconciliou (liga e
//       desliga);
//   A12 rótulo do campo e textos sem "obrigatória para Pix" nem interruptor;
//   A13 o guia diz que as três chaves liberam sozinhas, sem botão de ligar;
//   A14 estado pausado + faltas: a tela conta o que falta para quando retomar;
//   A15 `ler` de instalação antiga (sem `faltando`/`pausado`) não quebra: cai
//       em "desligado" e "não pausado".
//
// Mesmo padrão dos vizinhos (mercado-pago-secao-salva-e-testa.test.tsx):
// createRoot + act do React puro, dependências de fora mockadas.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const PUBLICA_FALSA = "APP_USR-publica-falsa-de-teste";

type Chamada = { nome: string; corpo: Record<string, unknown> };
const chamadas: Chamada[] = [];

// O dublê da edge: roteia por acao e lembra o que recebeu. `vi.hoisted`
// porque a fábrica do vi.mock sobe para o topo do arquivo.
const { invokeFalso, cenario } = vi.hoisted(() => ({
  invokeFalso: vi.fn(),
  cenario: {
    salvo: {} as Record<string, unknown>,
    respostaRetomar: {} as Record<string, unknown>,
    respostaPausar: {} as Record<string, unknown>,
    respostaSalvar: {} as Record<string, unknown>,
    respostaTestar: {} as Record<string, unknown>,
    erroRetomar: null as unknown,
  },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: { functions: { invoke: invokeFalso } },
}));

invokeFalso.mockImplementation(async (nome: string, { body }: any) => {
  chamadas.push({ nome, corpo: body });
  if (body?.acao === "ler") return { data: cenario.salvo, error: null };
  if (body?.acao === "ligar_pix") {
    if (cenario.erroRetomar) return { data: null, error: cenario.erroRetomar };
    return { data: cenario.respostaRetomar, error: null };
  }
  if (body?.acao === "desligar_pix") {
    return { data: cenario.respostaPausar, error: null };
  }
  if (body?.acao === "salvar") {
    return { data: cenario.respostaSalvar, error: null };
  }
  if (body?.acao === "testar") {
    return { data: cenario.respostaTestar, error: null };
  }
  return { data: null, error: null };
});

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));

const { toastError, toastSuccess } = vi.hoisted(() => ({
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));
vi.mock("sonner", () => ({
  toast: {
    info: vi.fn(),
    success: toastSuccess,
    error: toastError,
    warning: vi.fn(),
    loading: vi.fn(),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { MercadoPagoSection } from "@/components/admin/settings/MercadoPagoSection";
import { PASSOS_DO_GUIA } from "@/components/admin/settings/mercado-pago-conteudo";

async function assentar() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 10));
  });
}

async function clique(elemento: HTMLElement) {
  await act(async () => {
    elemento.click();
  });
  await assentar();
}

function botaoPorTexto(texto: string): HTMLButtonElement {
  const botao = [...document.body.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  );
  if (!botao) throw new Error(`Botão "${texto}" não está na tela.`);
  return botao;
}

function temBotao(texto: string): boolean {
  return [...document.body.querySelectorAll("button")].some((b) =>
    b.textContent?.includes(texto),
  );
}

async function abrirExpansor(texto: string) {
  const cabecalho = [
    ...document.body.querySelectorAll("button[aria-expanded]"),
  ].find((b) => b.textContent?.includes(texto));
  if (!cabecalho) throw new Error(`Expansor "${texto}" não está na tela.`);
  await clique(cabecalho as HTMLButtonElement);
}

async function montarSecaoComChavesAbertas(
  onPixAlternado?: (ligado: boolean, chaveNaLoja?: boolean) => void,
): Promise<Root> {
  const hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  const raiz = createRoot(hospedeiro);
  await act(async () => {
    raiz.render(<MercadoPagoSection onPixAlternado={onPixAlternado} />);
  });
  await assentar();
  // O bloco do estado vive na camada "Suas chaves", logo abaixo do teste de
  // conexão — e a camada nasce FECHADA (desenho da peça 20).
  await abrirExpansor("Suas chaves");
  return raiz;
}

function digitar(id: string, valor: string) {
  const el = document.getElementById(id) as HTMLInputElement;
  if (!el) throw new Error(`Input "${id}" não está na tela.`);
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

/** O bloco de estado do recebimento pelo app (a linha `role="status"`). */
function estadoDoRecebimento(): HTMLElement {
  const alvo = document.body.querySelector("[data-estado-recebimento]");
  if (!alvo)
    throw new Error("O bloco de estado do recebimento não está na tela.");
  return alvo as HTMLElement;
}

const CONECTADO = {
  quando: new Date().toISOString(),
  conectado: true,
  mensagem: 'Conectado! Conta "Loja Teste" no ambiente de produção.',
  ambiente: "producao",
  conta: "Loja Teste",
};

const RECUSADO = {
  quando: new Date().toISOString(),
  conectado: false,
  mensagem:
    "O Mercado Pago recusou a chave: o Access Token está errado, expirou ou veio incompleto. Cole a chave de novo e salve.",
  ambiente: null,
  conta: null,
};

const BASE = {
  configurado: true,
  public_key: PUBLICA_FALSA,
  mascara_token: "••••9999",
  mascara_webhook: "••••7777",
  ultimo_teste: CONECTADO as unknown,
  atualizado_em: new Date().toISOString(),
  pix_ligado: false,
  public_key_na_loja: true,
  faltando: [] as string[],
  pausado: false,
};

const RECEBENDO = { ...BASE, pix_ligado: true };
const PAUSADO = { ...BASE, pausado: true };

describe("MercadoPagoSection — liberação automática do pagamento pelo app", () => {
  let raiz: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    chamadas.length = 0;
    cenario.salvo = { ...BASE };
    cenario.respostaRetomar = {};
    cenario.respostaPausar = {};
    cenario.respostaSalvar = { ...BASE };
    cenario.respostaTestar = {};
    cenario.erroRetomar = null;
  });

  afterEach(async () => {
    await act(async () => {
      raiz?.unmount();
    });
    document.body.innerHTML = "";
  });

  it("A1 — recebendo pelo app: estado à vista, botão Pausar e NENHUM interruptor", async () => {
    cenario.salvo = { ...RECEBENDO };
    raiz = await montarSecaoComChavesAbertas();

    expect(estadoDoRecebimento().textContent).toContain(
      "Recebendo pelo app (Pix e cartão)",
    );
    expect(temBotao("Pausar")).toBe(true);
    expect(temBotao("Retomar")).toBe(false);
    expect(document.body.textContent).not.toContain("Falta para receber");
    // O interruptor morreu: ligar é automático.
    expect(document.body.querySelector('[role="switch"]')).toBeNull();
  });

  it("A2 — Pausar chama a edge, vira 'Pausado por você' + Retomar, avisa a vitrine e ecoa para o painel", async () => {
    cenario.salvo = { ...RECEBENDO };
    cenario.respostaPausar = {
      pix_ligado: false,
      pausado: true,
      faltando: [],
      public_key_na_loja: true,
    };
    const onPixAlternado = vi.fn();
    raiz = await montarSecaoComChavesAbertas(onPixAlternado);
    // O eco do `ler` do mount já veio: só o que vem DEPOIS do clique importa.
    onPixAlternado.mockClear();

    await clique(botaoPorTexto("Pausar"));

    const pausar = chamadas.find((c) => c.corpo.acao === "desligar_pix");
    expect(pausar).toBeTruthy();
    expect(pausar!.nome).toBe("credenciais-mercado-pago");
    expect(estadoDoRecebimento().textContent).toContain("Pausado por você");
    expect(temBotao("Retomar")).toBe(true);
    expect(temBotao("Pausar")).toBe(false);
    expect(document.body.textContent).toContain(
      "A vitrine passa a refletir em até 1 minuto",
    );
    expect(onPixAlternado).toHaveBeenCalledWith(false, true);
  });

  it("A3 — Retomar chama ligar_pix e volta a 'Recebendo'; chave de TESTE mostra o aviso que veio do servidor", async () => {
    cenario.salvo = { ...PAUSADO };
    cenario.respostaRetomar = {
      pix_ligado: true,
      pausado: false,
      faltando: [],
      quando: new Date().toISOString(),
      public_key_na_loja: true,
      aviso: "Chave de TESTE: o PIX não vai receber dinheiro de verdade.",
    };
    raiz = await montarSecaoComChavesAbertas();
    expect(estadoDoRecebimento().textContent).toContain("Pausado por você");

    await clique(botaoPorTexto("Retomar"));

    expect(chamadas.some((c) => c.corpo.acao === "ligar_pix")).toBe(true);
    expect(estadoDoRecebimento().textContent).toContain(
      "Recebendo pelo app (Pix e cartão)",
    );
    expect(document.body.textContent).toContain(
      "Chave de TESTE: o PIX não vai receber dinheiro de verdade",
    );
    expect(document.body.textContent).toContain(
      "A vitrine passa a refletir em até 1 minuto",
    );
  });

  it("A4 — recusa do servidor ao retomar não mente: o recado aparece e segue 'Pausado'", async () => {
    const RECADO =
      "Cole a Chave de notificações (assinatura secreta do webhook do Mercado Pago) e salve antes de ligar o PIX — sem ela o cliente escolhe PIX e o pagamento é recusado no fim da compra.";
    cenario.salvo = { ...PAUSADO, faltando: ["chave_notificacoes"] };
    cenario.erroRetomar = Object.assign(new Error("falhou"), {
      name: "FunctionsHttpError",
      context: new Response(JSON.stringify({ erro: RECADO }), { status: 409 }),
    });
    raiz = await montarSecaoComChavesAbertas();

    await clique(botaoPorTexto("Retomar"));

    expect(toastError).toHaveBeenCalledWith(RECADO);
    expect(estadoDoRecebimento().textContent).toContain("Pausado por você");
    expect(document.body.textContent).not.toContain(
      "A vitrine passa a refletir em até 1 minuto",
    );
  });

  it("A5 — faltando chave/teste: a lista em linguagem de leigo e nenhum botão de ligar/pausar", async () => {
    cenario.salvo = {
      ...BASE,
      mascara_webhook: null,
      ultimo_teste: null,
      faltando: ["chave_notificacoes", "teste"],
    };
    raiz = await montarSecaoComChavesAbertas();

    const estado = estadoDoRecebimento().textContent ?? "";
    expect(estado).toContain("Falta para receber pelo app:");
    expect(estado).toContain("colar a Chave de notificações");
    expect(estado).toContain("testar a conexão");
    // O que já está pronto NÃO aparece como falta.
    expect(estado).not.toContain("Public Key");
    expect(estado).not.toContain("Access Token");
    expect(temBotao("Pausar")).toBe(false);
    expect(temBotao("Retomar")).toBe(false);
    expect(document.body.querySelector('[role="switch"]')).toBeNull();
    // Sem jargão de código: os códigos da edge nunca vazam para a tela.
    expect(estado).not.toContain("chave_notificacoes");
    expect(estado).not.toContain("access_token");
  });

  it("A6 — ligado com falta (loja que já existia): aviso âmbar e o Testar conexão ao alcance", async () => {
    cenario.salvo = {
      ...RECEBENDO,
      ultimo_teste: null,
      faltando: ["teste"],
    };
    raiz = await montarSecaoComChavesAbertas();

    expect(estadoDoRecebimento().textContent).toContain(
      "Recebendo pelo app (Pix e cartão)",
    );
    expect(document.body.textContent).toContain("ainda falta");
    expect(document.body.textContent).toContain("testar a conexão");
    // O conserto (testar) tem de estar ao alcance da mão, não em outra camada.
    const testes = [...document.body.querySelectorAll("button")].filter((b) =>
      b.textContent?.includes("Testar conexão"),
    );
    expect(testes.length).toBeGreaterThan(1);
  });

  it("A6b — ligado sem nenhuma falta: nada de aviso âmbar", async () => {
    cenario.salvo = { ...RECEBENDO };
    raiz = await montarSecaoComChavesAbertas();
    expect(document.body.textContent).not.toContain("ainda falta");
  });

  it("A7 — tudo preenchido, desligado e sem pausa: a tela diz o que fazer", async () => {
    cenario.salvo = { ...BASE };
    raiz = await montarSecaoComChavesAbertas();
    const estado = estadoDoRecebimento().textContent ?? "";
    expect(estado).toContain("Tudo preenchido");
    expect(estado).toContain("Testar conexão");
    expect(temBotao("Pausar")).toBe(false);
  });

  it("A8 — salvar as três chaves: a tela mostra o teste automático e o novo estado, e o painel recebe o eco", async () => {
    cenario.salvo = {
      ...BASE,
      configurado: false,
      public_key: null,
      mascara_token: null,
      mascara_webhook: null,
      ultimo_teste: null,
      faltando: ["public_key", "access_token", "chave_notificacoes", "teste"],
    };
    cenario.respostaSalvar = { ...RECEBENDO, ultimo_teste: CONECTADO };
    const onPixAlternado = vi.fn();
    raiz = await montarSecaoComChavesAbertas(onPixAlternado);
    expect(estadoDoRecebimento().textContent).toContain("Falta para receber");
    onPixAlternado.mockClear();

    digitar("mp-public-key", PUBLICA_FALSA);
    digitar("mp-access-token", "APP_USR-token-falso-de-teste-9999");
    digitar("mp-webhook-secret", "segredo-falso-de-webhook-7777");
    await clique(botaoPorTexto("Salvar chaves"));

    const salvar = chamadas.find((c) => c.corpo.acao === "salvar");
    expect(salvar).toBeTruthy();
    // O TESTE é do servidor (não sai `testar` daqui): a resposta do salvar já
    // traz o resultado e o estado.
    expect(chamadas.some((c) => c.corpo.acao === "testar")).toBe(false);
    expect(estadoDoRecebimento().textContent).toContain(
      "Recebendo pelo app (Pix e cartão)",
    );
    expect(document.body.textContent).toContain("Conectado! Conta");
    expect(onPixAlternado).toHaveBeenCalledWith(true, true);
    // O toast conta que liberou (e não manda "teste a conexão" à mão).
    const [titulo, opcoes] = toastSuccess.mock.calls[0];
    expect(titulo).toContain("salvas");
    expect(opcoes.description).toContain("liberado");
    expect(opcoes.description).not.toContain("Teste a conexão");
  });

  it("A9 — salvar com teste recusado: recado do teste, aviso do servidor e a lista do que falta", async () => {
    cenario.salvo = { ...BASE, ultimo_teste: null, faltando: ["teste"] };
    cenario.respostaSalvar = {
      ...BASE,
      ultimo_teste: RECUSADO,
      faltando: ["teste"],
      aviso:
        "Salvei as chaves, mas o pagamento pelo app não ligou: o teste de conexão não passou. Confira o Access Token e salve de novo.",
    };
    raiz = await montarSecaoComChavesAbertas();

    await clique(botaoPorTexto("Salvar chaves"));

    expect(document.body.textContent).toContain("recusou a chave");
    expect(document.body.textContent).toContain(
      "o pagamento pelo app não ligou",
    );
    expect(estadoDoRecebimento().textContent).toContain("Falta para receber");
    expect(estadoDoRecebimento().textContent).toContain("testar a conexão");
    const [, opcoes] = toastSuccess.mock.calls[0];
    expect(opcoes.description).not.toContain("liberado");
  });

  it("A10 — salvar credencial nova que o servidor desligou: a mensagem dele aparece e o painel recebe o eco", async () => {
    cenario.salvo = { ...RECEBENDO };
    cenario.respostaSalvar = {
      ...BASE,
      ultimo_teste: RECUSADO,
      pix_ligado: false,
      faltando: ["teste"],
      pix_desligado: true,
      aviso:
        "Desliguei o pagamento pelo app: o teste de conexão com as chaves novas não passou. Confira o Access Token e salve de novo.",
    };
    // `aria-checked` sozinho não provaria o eco: o mock de `onPixAlternado`
    // é o que prova que o painel de Ajustes (fora daqui) FICOU SABENDO.
    const onPixAlternado = vi.fn();
    raiz = await montarSecaoComChavesAbertas(onPixAlternado);
    expect(estadoDoRecebimento().textContent).toContain("Recebendo pelo app");
    onPixAlternado.mockClear();

    await clique(botaoPorTexto("Salvar chaves"));

    expect(estadoDoRecebimento().textContent).not.toContain(
      "Recebendo pelo app",
    );
    expect(document.body.textContent).toContain(
      "Desliguei o pagamento pelo app",
    );
    expect(onPixAlternado).toHaveBeenCalledWith(false, true);
  });

  it("A11 — Testar conexão reflete o que o servidor reconciliou: liga quando passa, desliga quando falha", async () => {
    cenario.salvo = { ...BASE, ultimo_teste: RECUSADO, faltando: ["teste"] };
    cenario.respostaTestar = {
      conectado: true,
      mensagem: CONECTADO.mensagem,
      ambiente: "producao",
      conta: "Loja Teste",
      quando: new Date().toISOString(),
      pix_ligado: true,
      faltando: [],
      pausado: false,
      public_key_na_loja: true,
    };
    const onPixAlternado = vi.fn();
    raiz = await montarSecaoComChavesAbertas(onPixAlternado);
    onPixAlternado.mockClear();

    await clique(botaoPorTexto("Testar conexão"));

    expect(chamadas.some((c) => c.corpo.acao === "testar")).toBe(true);
    expect(estadoDoRecebimento().textContent).toContain("Recebendo pelo app");
    expect(onPixAlternado).toHaveBeenCalledWith(true, true);

    // Agora o teste falha e o servidor desliga.
    cenario.respostaTestar = {
      conectado: false,
      mensagem: RECUSADO.mensagem,
      ambiente: null,
      conta: null,
      quando: new Date().toISOString(),
      pix_ligado: false,
      faltando: ["teste"],
      pausado: false,
      public_key_na_loja: true,
      aviso: "Desliguei o pagamento pelo app: o teste de conexão não passou.",
    };
    onPixAlternado.mockClear();
    await clique(botaoPorTexto("Testar conexão"));

    expect(estadoDoRecebimento().textContent).toContain("Falta para receber");
    expect(document.body.textContent).toContain(
      "Desliguei o pagamento pelo app",
    );
    expect(onPixAlternado).toHaveBeenCalledWith(false, true);
  });

  it("A12 — rótulo do campo e textos: 'obrigatória para receber pelo app', sem 'obrigatória para Pix' nem interruptor", async () => {
    cenario.salvo = {
      ...BASE,
      mascara_webhook: null,
      faltando: ["chave_notificacoes"],
    };
    raiz = await montarSecaoComChavesAbertas();
    await abrirExpansor("Como pegar suas chaves");

    const texto = document.body.textContent ?? "";
    expect(texto).toContain(
      "Chave de notificações (obrigatória para receber pelo app)",
    );
    expect(texto).not.toContain("obrigatória para Pix");
    expect(texto.toLowerCase()).not.toContain("interruptor");
  });

  it("A13 — o guia diz que as três chaves liberam sozinhas, sem botão de ligar", () => {
    const ultimo = PASSOS_DO_GUIA[PASSOS_DO_GUIA.length - 1];
    const texto = `${ultimo.titulo} ${ultimo.descricao}`;
    expect(texto).toContain("Pix e cartão");
    expect(texto).toContain("automaticamente");
    expect(texto).toContain("Pausar");
    // Nada de mandar o lojista procurar um botão que não existe mais.
    expect(texto).not.toContain("LIGUE");
    expect(texto).not.toContain("Receber PIX no app");
    expect(texto.toLowerCase()).not.toContain("interruptor");
    expect(texto).not.toContain("obrigatória para Pix");
  });

  it("A14 — pausado e ainda faltando coisa: a tela conta o que falta para quando retomar", async () => {
    cenario.salvo = {
      ...PAUSADO,
      mascara_webhook: null,
      faltando: ["chave_notificacoes"],
    };
    raiz = await montarSecaoComChavesAbertas();
    const estado = estadoDoRecebimento().textContent ?? "";
    expect(estado).toContain("Pausado por você");
    expect(estado).toContain("colar a Chave de notificações");
  });

  it("A15 — `ler` de instalação antiga (sem `faltando`/`pausado`) não quebra: cai em desligado e não pausado", async () => {
    cenario.salvo = {
      configurado: true,
      public_key: PUBLICA_FALSA,
      mascara_token: "••••9999",
      mascara_webhook: "••••7777",
      ultimo_teste: CONECTADO,
      atualizado_em: new Date().toISOString(),
      pix_ligado: false,
      public_key_na_loja: true,
    };
    raiz = await montarSecaoComChavesAbertas();
    const estado = estadoDoRecebimento().textContent ?? "";
    expect(estado).not.toContain("Pausado por você");
    expect(estado).not.toContain("Recebendo pelo app");
    expect(temBotao("Pausar")).toBe(false);
  });

  it("A16 — ligado sem a Public Key na ficha da loja continua sendo contado na tela", async () => {
    cenario.salvo = { ...RECEBENDO, public_key_na_loja: false };
    raiz = await montarSecaoComChavesAbertas();
    expect(document.body.textContent).toContain("ficha da loja");
  });
});
