// @vitest-environment jsdom
//
// A seção "Mercado Pago" com a rede PENDURADA (conecta e não responde, sem
// erro). As quatro chamadas da seção à edge `credenciais-mercado-pago` não
// tinham prazo:
//   - LER (ao abrir): a seção ficava em "Lendo as chaves salvas…" para
//     sempre, sem o "Tentar de novo" (que só aparecia quando a leitura FALHAVA,
//     não quando pendurava);
//   - SALVAR / TESTAR / PAUSAR-RETOMAR: o botão ficava girando e os outros
//     dois ficavam travados junto.
//
// Agora cada uma tem prazo. No estouro: a tela solta, a frase NÃO afirma que a
// mudança foi feita nem que não foi (o prazo não cancela a edge: ela pode ter
// gravado), o estado REAL é relido, e a resposta que chegar tarde nunca vira
// aviso de sucesso.
//
// A edge é DUBLÊ e os valores de chave são FALSOS de mentira, legíveis de
// propósito. Nenhum valor de chave aparece em log, mensagem ou asserção de
// frase.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TOKEN_FALSO = "token-falso-de-teste-0000";
const PUBLICA_FALSA = "publica-falsa-de-teste-0000";

type Resposta = { data: unknown; error: unknown };
type Chamada = { acao: string };

const { invokeFalso, rede } = vi.hoisted(() => ({
  invokeFalso: vi.fn(),
  rede: {
    chamadas: [] as { acao: string }[],
    // Ações que penduram (nunca respondem sozinhas).
    penduradas: new Set<string>(),
    // Liberadores das chamadas penduradas, por ação, na ordem em que chegaram.
    liberadores: new Map<string, ((r: Resposta) => void)[]>(),
    // Retrato "do servidor" devolvido por `ler` (e por quem responder normal).
    salvo: {} as Record<string, unknown>,
    respostas: new Map<string, Record<string, unknown>>(),
  },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: { functions: { invoke: invokeFalso } },
}));

invokeFalso.mockImplementation((_nome: string, { body }: any) => {
  const acao = String(body?.acao);
  rede.chamadas.push({ acao });
  if (rede.penduradas.has(acao)) {
    return new Promise<Resposta>((resolve) => {
      const fila = rede.liberadores.get(acao) ?? [];
      fila.push(resolve);
      rede.liberadores.set(acao, fila);
    });
  }
  if (acao === "ler") {
    return Promise.resolve({ data: rede.salvo, error: null });
  }
  return Promise.resolve({ data: rede.respostas.get(acao) ?? {}, error: null });
});

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));

const { toastSuccess, toastError } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
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

const CONFIGURADO = {
  configurado: true,
  public_key: PUBLICA_FALSA,
  mascara_token: "••••0000",
  mascara_webhook: "••••1111",
  ultimo_teste: {
    quando: "2026-11-07T10:00:00.000Z",
    conectado: true,
    mensagem: "Conectado!",
    ambiente: "producao",
    conta: "Loja Teste",
  },
  atualizado_em: "2026-11-07T10:00:00.000Z",
  pix_ligado: true,
  public_key_na_loja: true,
  faltando: [] as string[],
  pausado: false,
};

// Passa do prazo de qualquer chamada da seção (leitura 15 s; gravações 20 s).
const DEPOIS_DO_PRAZO_MS = 21_000;
const ANTES_DO_PRAZO_MS = 5_000;

async function avancar(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
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

function botao(texto: string): HTMLButtonElement {
  const achado = [...document.body.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === texto,
  );
  if (!achado) throw new Error(`Botão "${texto}" não está na tela.`);
  return achado;
}

function temBotao(texto: string): boolean {
  return [...document.body.querySelectorAll("button")].some(
    (b) => b.textContent?.trim() === texto,
  );
}

async function clicar(el: HTMLElement) {
  await act(async () => {
    el.click();
  });
  await avancar(10);
}

async function abrirSuasChaves() {
  const cabecalho = [
    ...document.body.querySelectorAll("button[aria-expanded]"),
  ].find((b) => b.textContent?.includes("Suas chaves"));
  if (!cabecalho) throw new Error('Expansor "Suas chaves" não está na tela.');
  if (cabecalho.getAttribute("aria-expanded") === "true") return;
  await clicar(cabecalho as HTMLButtonElement);
}

// O que a seção avisa ao painel de Ajustes (estado do Pix que o servidor deu).
const eco = vi.fn();

const vezesQueChamou = (acao: string) =>
  rede.chamadas.filter((c: Chamada) => c.acao === acao).length;

const ultimaFrase = () =>
  String(toastError.mock.calls.at(-1)?.[0] ?? "") +
  String(toastError.mock.calls.at(-1)?.[1]?.description ?? "");

/** A frase honesta: manda conferir; não diz que foi nem que não foi. */
function expectFraseHonesta(frase: string) {
  expect(frase).toMatch(/sem resposta da rede/i);
  expect(frase).toMatch(/confira/i);
  expect(frase).not.toMatch(/não foi (feito|salv|pausad|retomad)/i);
  expect(frase).not.toMatch(/não foram salvas/i);
  expect(frase).not.toMatch(/foram salvas|foi salvo|foi pausad|foi retomad/i);
  expect(frase).not.toContain(TOKEN_FALSO);
  expect(frase).not.toContain(PUBLICA_FALSA);
}

describe("MercadoPagoSection — rede pendurada", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  async function montar() {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    await act(async () => {
      raiz.render(<MercadoPagoSection onPixAlternado={eco} />);
    });
    await avancar(50);
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    rede.chamadas.length = 0;
    rede.penduradas.clear();
    rede.liberadores.clear();
    rede.salvo = { ...CONFIGURADO };
    rede.respostas.clear();
  });

  afterEach(async () => {
    await act(async () => {
      raiz?.unmount();
    });
    hospedeiro?.remove();
    vi.useRealTimers();
  });

  it("LER pendurada na abertura: sai de 'Lendo…', mostra a frase e o 'Tentar de novo', que funciona", async () => {
    rede.penduradas.add("ler");
    await montar();
    await avancar(ANTES_DO_PRAZO_MS);
    expect(document.body.textContent).toContain("Lendo as chaves salvas");

    await avancar(DEPOIS_DO_PRAZO_MS);
    expect(document.body.textContent).not.toContain("Lendo as chaves salvas");
    expect(document.body.textContent).toMatch(/sem resposta da rede/i);
    expect(temBotao("Tentar de novo")).toBe(true);

    // A rede volta: "Tentar de novo" lê de verdade.
    rede.penduradas.delete("ler");
    await clicar(botao("Tentar de novo"));
    expect(temBotao("Tentar de novo")).toBe(false);
    expect(document.body.textContent).not.toMatch(/sem resposta da rede/i);
    expect(document.body.textContent).toContain("Receber pelo app");
  });

  it("LER: a resposta velha que chega depois do prazo não apaga o que 'Tentar de novo' trouxe", async () => {
    rede.penduradas.add("ler");
    await montar();
    await avancar(DEPOIS_DO_PRAZO_MS);

    rede.penduradas.delete("ler");
    rede.salvo = { ...CONFIGURADO, pix_ligado: false, pausado: true };
    await clicar(botao("Tentar de novo"));
    expect(temBotao("Retomar")).toBe(true);

    // A primeira leitura (a que pendurou) responde TARDE com o retrato antigo.
    await act(async () => {
      for (const liberar of rede.liberadores.get("ler") ?? []) {
        liberar({ data: { ...CONFIGURADO }, error: null });
      }
    });
    await avancar(50);
    expect(temBotao("Retomar")).toBe(true);
    expect(temBotao("Pausar")).toBe(false);
  });

  it("SALVAR pendurado: solta o botão, não afirma nada sobre as chaves, relê o estado e mantém o que foi digitado", async () => {
    await montar();
    await abrirSuasChaves();
    digitar("mp-access-token", TOKEN_FALSO);
    await avancar(10);
    rede.penduradas.add("salvar");

    await clicar(botao("Salvar chaves"));
    await avancar(ANTES_DO_PRAZO_MS);
    // Ainda esperando: botão travado.
    expect(botao("Salvar chaves").disabled).toBe(true);

    const leiturasAntes = vezesQueChamou("ler");
    await avancar(DEPOIS_DO_PRAZO_MS);

    expect(botao("Salvar chaves").disabled).toBe(false);
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledTimes(1);
    expectFraseHonesta(ultimaFrase());
    // O estado real foi relido.
    expect(vezesQueChamou("ler")).toBeGreaterThan(leiturasAntes);
    // O que a lojista digitou continua lá: ela pode tentar de novo sem redigitar.
    expect(
      (document.getElementById("mp-access-token") as HTMLInputElement).value,
    ).toBe(TOKEN_FALSO);
  });

  it("SALVAR: a resposta de sucesso que chega DEPOIS do prazo não vira aviso de sucesso", async () => {
    await montar();
    await abrirSuasChaves();
    digitar("mp-access-token", TOKEN_FALSO);
    await avancar(10);
    rede.penduradas.add("salvar");
    await clicar(botao("Salvar chaves"));
    await avancar(DEPOIS_DO_PRAZO_MS);

    await act(async () => {
      for (const liberar of rede.liberadores.get("salvar") ?? []) {
        liberar({ data: { ...CONFIGURADO }, error: null });
      }
    });
    await avancar(50);

    expect(toastSuccess).not.toHaveBeenCalled();
    expect(
      (document.getElementById("mp-access-token") as HTMLInputElement).value,
    ).toBe(TOKEN_FALSO);
  });

  it("TESTAR CONEXÃO pendurado: solta o botão, manda conferir e relê o estado", async () => {
    await montar();
    await abrirSuasChaves();
    rede.penduradas.add("testar");

    await clicar(botao("Testar conexão"));
    await avancar(ANTES_DO_PRAZO_MS);
    expect(botao("Testar conexão").disabled).toBe(true);

    const leiturasAntes = vezesQueChamou("ler");
    await avancar(DEPOIS_DO_PRAZO_MS);

    expect(botao("Testar conexão").disabled).toBe(false);
    expect(toastError).toHaveBeenCalledTimes(1);
    expectFraseHonesta(ultimaFrase());
    expect(vezesQueChamou("ler")).toBeGreaterThan(leiturasAntes);
  });

  it("PAUSAR pendurado: solta os botões, manda conferir e a releitura mostra o que o servidor de fato fez", async () => {
    await montar();
    rede.penduradas.add("desligar_pix");

    await clicar(botao("Pausar"));
    await avancar(ANTES_DO_PRAZO_MS);
    expect(botao("Pausar").disabled).toBe(true);

    // A gravação CHEGOU ao servidor, só a resposta não voltou.
    rede.salvo = { ...CONFIGURADO, pix_ligado: false, pausado: true };
    const leiturasAntes = vezesQueChamou("ler");
    await avancar(DEPOIS_DO_PRAZO_MS);

    expect(toastSuccess).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledTimes(1);
    expectFraseHonesta(ultimaFrase());
    expect(vezesQueChamou("ler")).toBeGreaterThan(leiturasAntes);
    // A tela mostra o estado real (pausado), com o botão de retomar livre.
    expect(temBotao("Retomar")).toBe(true);
    expect(botao("Retomar").disabled).toBe(false);
  });

  it("RETOMAR pendurado: solta o botão e manda conferir", async () => {
    rede.salvo = { ...CONFIGURADO, pix_ligado: false, pausado: true };
    await montar();
    rede.penduradas.add("ligar_pix");

    await clicar(botao("Retomar"));
    await avancar(DEPOIS_DO_PRAZO_MS);

    expect(botao("Retomar").disabled).toBe(false);
    expect(toastSuccess).not.toHaveBeenCalled();
    expectFraseHonesta(ultimaFrase());
  });

  it("PAUSAR estoura, a releitura pendura, PAUSAR de novo responde: a releitura velha que chega depois NÃO desfaz o estado novo, nem na tela nem no painel", async () => {
    await montar();
    // 1) Pausar pendura; a releitura que o estouro dispara também vai pendurar.
    rede.penduradas.add("desligar_pix");
    await clicar(botao("Pausar"));
    rede.penduradas.add("ler");
    await avancar(DEPOIS_DO_PRAZO_MS);
    expect(botao("Pausar").disabled).toBe(false);

    // 2) A rede volta para Pausar: o servidor responde "pausado".
    rede.penduradas.delete("desligar_pix");
    rede.respostas.set("desligar_pix", {
      pix_ligado: false,
      pausado: true,
      faltando: [],
    });
    await clicar(botao("Pausar"));
    expect(temBotao("Retomar")).toBe(true);
    eco.mockClear();

    // 3) A releitura do passo 1 chega TARDE, com o retrato antigo ("ligado").
    await act(async () => {
      for (const liberar of rede.liberadores.get("ler") ?? []) {
        liberar({ data: { ...CONFIGURADO }, error: null });
      }
    });
    await avancar(50);

    expect(temBotao("Retomar")).toBe(true);
    expect(temBotao("Pausar")).toBe(false);
    // 4) O painel de Ajustes também não recebe o estado velho.
    expect(eco).not.toHaveBeenCalled();
  });

  it("SALVAR estoura, a releitura pendura, SALVAR de novo desliga o Pix: a releitura velha não pinta 'ligado' de volta", async () => {
    await montar();
    await abrirSuasChaves();
    digitar("mp-access-token", TOKEN_FALSO);
    await avancar(10);
    rede.penduradas.add("salvar");
    await clicar(botao("Salvar chaves"));
    rede.penduradas.add("ler");
    await avancar(DEPOIS_DO_PRAZO_MS);
    expect(botao("Salvar chaves").disabled).toBe(false);

    // Segunda tentativa: a edge reprova a chave e DESLIGA o Pix.
    rede.penduradas.delete("salvar");
    rede.respostas.set("salvar", {
      ...CONFIGURADO,
      pix_ligado: false,
      pausado: false,
      faltando: ["teste"],
    });
    await clicar(botao("Salvar chaves"));
    expect(temBotao("Pausar")).toBe(false);
    eco.mockClear();

    await act(async () => {
      for (const liberar of rede.liberadores.get("ler") ?? []) {
        liberar({ data: { ...CONFIGURADO }, error: null });
      }
    });
    await avancar(50);

    expect(temBotao("Pausar")).toBe(false);
    expect(eco).not.toHaveBeenCalled();
  });

  it("a releitura que chega SEM nenhuma ação mais nova no meio ainda vale (o guarda não a descarta à toa)", async () => {
    await montar();
    rede.penduradas.add("desligar_pix");
    await clicar(botao("Pausar"));
    rede.salvo = { ...CONFIGURADO, pix_ligado: false, pausado: true };
    await avancar(DEPOIS_DO_PRAZO_MS);
    expect(temBotao("Retomar")).toBe(true);
  });

  it("caminho feliz: salvar que responde dentro do prazo continua dando o aviso de sucesso", async () => {
    await montar();
    await abrirSuasChaves();
    digitar("mp-access-token", TOKEN_FALSO);
    await avancar(10);
    rede.respostas.set("salvar", { ...CONFIGURADO });

    await clicar(botao("Salvar chaves"));
    await avancar(50);

    expect(toastSuccess).toHaveBeenCalledTimes(1);
    expect(toastError).not.toHaveBeenCalled();
    expect(
      (document.getElementById("mp-access-token") as HTMLInputElement).value,
    ).toBe("");
  });
});
