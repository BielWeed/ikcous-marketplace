// @vitest-environment jsdom
//
// Tarefa mp-4 (16/09/2026) — o interruptor HONESTO "Receber PIX no app" na
// seção Mercado Pago dos Ajustes. Antes desta peça a tela guardava, escondia
// e testava as chaves, mas NADA na tela ligava o PIX para o cliente: o
// lojista salvava, via "Conectado!" e continuava sem receber — a ficha da
// loja (`pagamento_online`) seguia apagada. O que ESTE arquivo prova:
//   X1  sem teste de conexão bem-sucedido o interruptor fica DESABILITADO e
//       a tela EXPLICA o porquê — e nenhum "ligar_pix" sai daqui;
//   X2  com teste conectado, ligar chama a edge (acao "ligar_pix"), o
//       interruptor passa a refletir o que o SERVIDOR devolveu e a tela
//       avisa que a vitrine demora até 1 minuto (TTL do porteiro);
//   X3  ligar com chave de TESTE mostra o aviso amarelo DEVOLVIDO pela edge
//       (a tela não inventa o aviso nem o esconde);
//   X4  desligar é o lado seguro: funciona mesmo sem teste conectado;
//   X5  recusa da edge NÃO mente — o interruptor volta ao estado real e o
//       recado amigável do servidor aparece;
//   X6  PIX ligado com a Public Key fora da ficha da loja é contado na tela
//       (é exatamente o caso em que o cliente não vê PIX);
//   X7  o guia (texto que o lojista lê) manda LIGAR o interruptor — parar em
//       "salve e teste" era prometer Pix que ninguém recebe;
//   X8  (mp-9) PIX ligado com a credencial SEM teste guardado ganha aviso
//       âmbar e o "Testar conexão" ao alcance — a chave que está cobrando
//       nunca passou no teste e a tela calava;
//   X9  (mp-9) salvar credencial nova faz a edge desligar o PIX
//       (`pix_desligado`): a tela mostra a mensagem dela e o interruptor
//       volta para desligado.
//
// Mesmo padrão dos vizinhos (mercado-pago-secao-salva-e-testa.test.tsx):
// createRoot + act do React puro, dependências de fora mockadas, a edge
// credenciais-mercado-pago é DUBLÊ e as chaves são FALSAS de mentira.
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
    respostaLigar: {} as Record<string, unknown>,
    respostaSalvar: {} as Record<string, unknown>,
    erroLigar: null as unknown,
  },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: { functions: { invoke: invokeFalso } },
}));

invokeFalso.mockImplementation(async (nome: string, { body }: any) => {
  chamadas.push({ nome, corpo: body });
  if (body?.acao === "ler") return { data: cenario.salvo, error: null };
  if (body?.acao === "ligar_pix") {
    if (cenario.erroLigar) return { data: null, error: cenario.erroLigar };
    return { data: cenario.respostaLigar, error: null };
  }
  if (body?.acao === "desligar_pix") {
    return { data: { pix_ligado: false }, error: null };
  }
  if (body?.acao === "salvar") {
    return { data: cenario.respostaSalvar, error: null };
  }
  return { data: null, error: null };
});

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));

const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }));
vi.mock("sonner", () => ({
  toast: {
    info: vi.fn(),
    success: vi.fn(),
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

function interruptorDoPix(): HTMLButtonElement {
  const alvo = document.body.querySelector('[role="switch"]');
  if (!alvo)
    throw new Error('O interruptor "Receber PIX no app" não está na tela.');
  return alvo as HTMLButtonElement;
}

async function montarSecaoComChavesAbertas(): Promise<Root> {
  const hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  const raiz = createRoot(hospedeiro);
  await act(async () => {
    raiz.render(<MercadoPagoSection />);
  });
  await assentar();
  // O bloco do PIX vive na camada "Suas chaves", logo abaixo do teste de
  // conexão — e a camada nasce FECHADA (desenho da peça 20).
  const cabecalho = [
    ...document.body.querySelectorAll("button[aria-expanded]"),
  ].find((b) => b.textContent?.includes("Suas chaves"));
  if (!cabecalho) throw new Error('Expansor "Suas chaves" não está na tela.');
  await clique(cabecalho as HTMLButtonElement);
  return raiz;
}

const CONECTADO = {
  quando: new Date().toISOString(),
  conectado: true,
  mensagem: 'Conectado! Conta "Loja Teste" no ambiente de produção.',
  ambiente: "producao",
  conta: "Loja Teste",
};

const CONFIGURADO = {
  configurado: true,
  public_key: PUBLICA_FALSA,
  mascara_token: "••••9999",
  mascara_webhook: null,
  ultimo_teste: null as unknown,
  atualizado_em: new Date().toISOString(),
  pix_ligado: false,
  public_key_na_loja: true,
};

describe("MercadoPagoSection — interruptor honesto do PIX no app", () => {
  let raiz: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    chamadas.length = 0;
    cenario.salvo = { ...CONFIGURADO };
    cenario.respostaLigar = {};
    cenario.respostaSalvar = { ...CONFIGURADO };
    cenario.erroLigar = null;
  });

  afterEach(async () => {
    await act(async () => {
      raiz?.unmount();
    });
    document.body.innerHTML = "";
  });

  it("X1 — sem teste conectado o interruptor fica bloqueado e a tela explica", async () => {
    cenario.salvo = { ...CONFIGURADO, ultimo_teste: null };
    raiz = await montarSecaoComChavesAbertas();

    const interruptor = interruptorDoPix();
    expect(interruptor.getAttribute("aria-checked")).toBe("false");
    expect(interruptor.disabled).toBe(true);
    expect(document.body.textContent).toContain("antes de ligar");

    await clique(interruptor);
    expect(chamadas.some((c) => c.corpo.acao === "ligar_pix")).toBe(false);
  });

  it("X2 — com teste conectado, ligar chama a edge e conta o atraso da vitrine", async () => {
    cenario.salvo = { ...CONFIGURADO, ultimo_teste: CONECTADO };
    cenario.respostaLigar = {
      pix_ligado: true,
      quando: new Date().toISOString(),
    };
    raiz = await montarSecaoComChavesAbertas();

    const interruptor = interruptorDoPix();
    expect(interruptor.disabled).toBe(false);
    await clique(interruptor);

    const ligar = chamadas.find((c) => c.corpo.acao === "ligar_pix");
    expect(ligar).toBeTruthy();
    expect(ligar!.nome).toBe("credenciais-mercado-pago");
    expect(interruptorDoPix().getAttribute("aria-checked")).toBe("true");
    expect(document.body.textContent).toContain(
      "A vitrine passa a refletir em até 1 minuto",
    );
  });

  it("X3 — ligar com chave de teste mostra o aviso devolvido pela edge", async () => {
    cenario.salvo = {
      ...CONFIGURADO,
      ultimo_teste: { ...CONECTADO, ambiente: "teste" },
    };
    cenario.respostaLigar = {
      pix_ligado: true,
      quando: new Date().toISOString(),
      aviso: "Chave de TESTE: o PIX não vai receber dinheiro de verdade",
    };
    raiz = await montarSecaoComChavesAbertas();

    await clique(interruptorDoPix());

    expect(document.body.textContent).toContain(
      "Chave de TESTE: o PIX não vai receber dinheiro de verdade",
    );
  });

  it("X4 — desligar é o lado seguro: funciona mesmo sem teste conectado", async () => {
    cenario.salvo = { ...CONFIGURADO, ultimo_teste: null, pix_ligado: true };
    raiz = await montarSecaoComChavesAbertas();

    const interruptor = interruptorDoPix();
    expect(interruptor.getAttribute("aria-checked")).toBe("true");
    expect(interruptor.disabled).toBe(false);

    await clique(interruptor);

    expect(chamadas.some((c) => c.corpo.acao === "desligar_pix")).toBe(true);
    expect(interruptorDoPix().getAttribute("aria-checked")).toBe("false");
  });

  it("X5 — recusa da edge não mente: o interruptor fica onde estava", async () => {
    cenario.salvo = { ...CONFIGURADO, ultimo_teste: CONECTADO };
    cenario.erroLigar = Object.assign(new Error("falhou"), {
      name: "FunctionsHttpError",
      context: new Response(
        JSON.stringify({
          erro: "Teste a conexão com sucesso antes de ligar o PIX.",
        }),
        { status: 409 },
      ),
    });
    raiz = await montarSecaoComChavesAbertas();

    await clique(interruptorDoPix());

    expect(interruptorDoPix().getAttribute("aria-checked")).toBe("false");
    expect(toastError).toHaveBeenCalledWith(
      "Teste a conexão com sucesso antes de ligar o PIX.",
    );
    expect(document.body.textContent).not.toContain(
      "A vitrine passa a refletir em até 1 minuto",
    );
  });

  it("X7 — o guia manda ligar o interruptor, não para no teste de conexão", () => {
    const ultimo = PASSOS_DO_GUIA[PASSOS_DO_GUIA.length - 1];
    expect(`${ultimo.titulo} ${ultimo.descricao}`).toContain(
      "Receber PIX no app",
    );
  });

  it("X6 — PIX ligado sem a Public Key na ficha da loja é contado na tela", async () => {
    cenario.salvo = {
      ...CONFIGURADO,
      ultimo_teste: CONECTADO,
      pix_ligado: true,
      public_key_na_loja: false,
    };
    raiz = await montarSecaoComChavesAbertas();

    expect(interruptorDoPix().getAttribute("aria-checked")).toBe("true");
    expect(document.body.textContent).toContain("ficha da loja");
  });

  it("X8 — PIX ligado com credencial nunca testada avisa e oferece o teste", async () => {
    // O estado intermediário que a mp-8 criou no servidor: salvar um Access
    // Token novo zera o `ultimo_teste`. Com o PIX ainda aceso, a loja cobra
    // por uma chave que ninguém provou — e até aqui a tela só mostrava o
    // interruptor ligado, sem uma palavra.
    cenario.salvo = { ...CONFIGURADO, ultimo_teste: null, pix_ligado: true };
    raiz = await montarSecaoComChavesAbertas();

    expect(interruptorDoPix().getAttribute("aria-checked")).toBe("true");
    expect(document.body.textContent).toContain(
      "ainda não passou pelo teste de conexão",
    );
    // O conserto tem de estar ao alcance da mão, não em outra camada.
    const testes = [...document.body.querySelectorAll("button")].filter((b) =>
      b.textContent?.includes("Testar conexão"),
    );
    expect(testes.length).toBeGreaterThan(1);
  });

  it("X8b — com teste conectado guardado o aviso âmbar não aparece", async () => {
    cenario.salvo = {
      ...CONFIGURADO,
      ultimo_teste: CONECTADO,
      pix_ligado: true,
    };
    raiz = await montarSecaoComChavesAbertas();

    expect(document.body.textContent).not.toContain(
      "ainda não passou pelo teste de conexão",
    );
  });

  it("X9 — salvar credencial nova: a tela mostra o desligamento que a edge fez", async () => {
    cenario.salvo = {
      ...CONFIGURADO,
      ultimo_teste: CONECTADO,
      pix_ligado: true,
    };
    cenario.respostaSalvar = {
      ...CONFIGURADO,
      ultimo_teste: null,
      pix_ligado: false,
      pix_desligado: true,
      aviso:
        "Desliguei o PIX no app: teste a conexão com a credencial nova e ligue de novo.",
    };
    raiz = await montarSecaoComChavesAbertas();

    expect(interruptorDoPix().getAttribute("aria-checked")).toBe("true");

    await clique(botaoPorTexto("Salvar chaves"));

    expect(interruptorDoPix().getAttribute("aria-checked")).toBe("false");
    expect(document.body.textContent).toContain("Desliguei o PIX no app");
  });
});
