// @vitest-environment jsdom
//
// Aba Impostos: o CADASTRO FISCAL na tela, com a trava "só o dono" (plano da Gestão
// Fiscal, seção 4). Quem barra de verdade é o banco (`fiscal_cadastro_salvar` recusa
// com 42501 quem não é o dono, e tabela `dono_da_loja` vazia recusa todo mundo); a
// tela ESPELHA isso e diz o caminho. Ao contrário das credenciais, "sem dono" aqui é
// TRAVADO (as credenciais liberam): é a regra do banco, e a tela não promete o que
// ele recusa. O que prova (molde: credenciais-so-o-dono-troca):
//   F1  ainda lendo o dono: botão travado, SEM frase
//   F2  sou o dono: editável; Salvar chama o servidor com o payload validado
//   F3  há dono e não sou eu: só leitura + a frase exata; travado, nem à força
//       (clique no botão travado, Salvar e submit na folha aberta) chama o servidor
//   F4  SEM dono cadastrado: só leitura + o caminho escrito; sem cadastro E sem dono
//       o estado vazio troca "Configurar" pela frase
//   F5  a leitura do dono falhou: só leitura + frase neutra + "Tentar de novo" que RELÊ
// Mais: CNPJ vem de Dados da empresa (vazio = atalho para Minha loja); últimas
// alterações; folha suja pergunta antes de fechar; datas que o banco recusa não vão
// ao servidor; yyyy-mm vira yyyy-mm-01; recusa 42501 e "sem resposta" nunca repetem
// sozinhas.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EstadoDoDono } from "@/hooks/useDonoDaLoja";
import type { ConsultaFinanceira } from "@/hooks/useFinanceiro";
import type { LeituraDoCadastroFiscal } from "@/lib/fiscal/cadastro";

const { donoFalso, limparDonoFalso, rpc, logDoBanco, lojaFalsa } = vi.hoisted(
  () => ({
    donoFalso: { atual: {} as EstadoDoDono },
    limparDonoFalso: vi.fn(),
    rpc: vi.fn(),
    logDoBanco: { linhas: [] as unknown[] },
    lojaFalsa: { documento: null as string | null },
  }),
);

vi.mock("@/hooks/useDonoDaLoja", () => ({
  useDonoDaLoja: () => donoFalso.atual,
  limparDonoDaLoja: limparDonoFalso,
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { storeLegalDocument: lojaFalsa.documento } }),
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc,
    // A única leitura que o cartão faz sozinho: as últimas alterações.
    from: (tabela: string) => {
      if (tabela !== "fiscal_cadastro_log") {
        throw new Error(`leitura inesperada: ${tabela}`);
      }
      return {
        select: () => ({
          order: () => ({
            order: () => ({
              limit: async () => ({ data: logDoBanco.linhas, error: null }),
            }),
          }),
        }),
      };
    },
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { CadastroFiscal } from "@/components/admin/financeiro/impostos/CadastroFiscal";

const SO_O_DONO = "Só o dono da loja altera o cadastro fiscal.";
const SEM_DONO =
  "Esta loja ainda não tem um dono cadastrado. Peça ao suporte do IKCOUS para cadastrar o dono; depois, recarregue a página.";
const NAO_CONFIRMOU = "Não deu para confirmar quem pode alterar.";

const HOJE = "2026-11-24";
const EU = "uid-eu";
const OUTRO = "uid-do-dono";

const DONO: Record<string, EstadoDoDono> = {
  carregando: {
    souODono: false,
    carregando: true,
    donoId: null,
    leituraFalhou: false,
  },
  souODono: {
    souODono: true,
    carregando: false,
    donoId: EU,
    leituraFalhou: false,
  },
  outroEDono: {
    souODono: false,
    carregando: false,
    donoId: OUTRO,
    leituraFalhou: false,
  },
  semDono: {
    souODono: false,
    carregando: false,
    donoId: null,
    leituraFalhou: false,
  },
  falhou: {
    souODono: false,
    carregando: false,
    donoId: null,
    leituraFalhou: true,
  },
};

const CADASTRO_SIMPLES: LeituraDoCadastroFiscal = {
  estado: "com_cadastro",
  cadastro: {
    regime: "simples",
    atividade: "comercio",
    abertaEm: "2024-05-10",
    vendeNoAppDesde: "2025-01-01",
    atualizadoEm: "2026-11-20T15:30:00Z",
    atualizadoPor: OUTRO,
  },
};
const SEM_CADASTRO: LeituraDoCadastroFiscal = { estado: "sem_cadastro" };

const recarregar = vi.fn();
function consulta(
  dados: LeituraDoCadastroFiscal | null,
  extra: Partial<ConsultaFinanceira<LeituraDoCadastroFiscal>> = {},
): ConsultaFinanceira<LeituraDoCadastroFiscal> {
  return { dados, carregando: false, erro: null, recarregar, ...extra };
}

const linhaDoBanco = {
  id: true,
  regime: "mei",
  atividade: "comercio",
  aberta_em: "2024-05-10",
  vende_no_app_desde: "2025-01-01",
  atualizado_em: "2026-11-24T12:00:00Z",
  atualizado_por: EU,
};

let raiz: Root;
let hospedeiro: HTMLDivElement;
const aoIrParaMinhaLoja = vi.fn();

async function assentar() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 10));
  });
}

function elemento(dados: LeituraDoCadastroFiscal | null, extra = {}) {
  return (
    <CadastroFiscal
      consulta={consulta(dados, extra)}
      ativo
      versao={0}
      hoje={HOJE}
      aoIrParaMinhaLoja={aoIrParaMinhaLoja}
    />
  );
}

async function montar(
  dados: LeituraDoCadastroFiscal | null,
  dono: EstadoDoDono,
  extra = {},
) {
  donoFalso.atual = dono;
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
  await act(async () => {
    raiz.render(elemento(dados, extra));
  });
  await assentar();
}

async function renderizarDeNovo(dados: LeituraDoCadastroFiscal | null) {
  await act(async () => {
    raiz.render(elemento(dados));
  });
  await assentar();
}

beforeEach(() => {
  rpc.mockReset();
  recarregar.mockReset();
  limparDonoFalso.mockReset();
  aoIrParaMinhaLoja.mockReset();
  logDoBanco.linhas = [];
  lojaFalsa.documento = "11222333000181";
});
afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
});

// A folha mora num portal no body: o texto da tela inteira é o do documento.
const texto = () => document.body.textContent ?? "";
const folha = () => document.querySelector<HTMLElement>('[role="dialog"]');
function botao(rotulo: string): HTMLButtonElement {
  const achado = [...document.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(rotulo),
  );
  if (!achado) throw new Error(`Botão "${rotulo}" não está na tela.`);
  return achado;
}
const temBotao = (rotulo: string) =>
  [...document.querySelectorAll("button")].some((b) =>
    b.textContent?.includes(rotulo),
  );
async function clicar(el: HTMLElement) {
  await act(async () => {
    el.click();
  });
  await assentar();
}
function campo(id: string): HTMLInputElement | HTMLSelectElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Campo ${id} não está na tela.`);
  return el as HTMLInputElement | HTMLSelectElement;
}
async function preencher(id: string, valor: string) {
  const el = campo(id);
  const prototipo =
    el instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototipo, "value")?.set?.call(el, valor);
    el.dispatchEvent(
      new Event(el instanceof HTMLSelectElement ? "change" : "input", {
        bubbles: true,
      }),
    );
  });
}
async function submeter() {
  await act(async () => {
    document
      .querySelector("form")
      ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await assentar();
}
const ID_REGIME = "fiscal-cadastro-regime";
const ID_ATIVIDADE = "fiscal-cadastro-atividade";
const ID_ABERTA = "fiscal-cadastro-aberta-em";
const ID_VENDE = "fiscal-cadastro-vende-desde";

function travado(el: HTMLElement) {
  return el.getAttribute("aria-disabled") === "true";
}
/** O texto que o botão aponta por aria-describedby (a razão do travamento). */
function razaoDo(el: HTMLElement): string {
  const ids = (el.getAttribute("aria-describedby") ?? "").split(" ");
  return ids
    .map((id) => document.getElementById(id)?.textContent ?? "")
    .join(" ");
}
const chamadasDeSalvar = () =>
  rpc.mock.calls.filter(([nome]) => nome === "fiscal_cadastro_salvar");

// ── F1 a F5: a trava ────────────────────────────────────────────────────────

describe("Cadastro fiscal: só o dono altera", () => {
  it("F1 ainda lendo o dono: botão travado e SEM frase (nem destrava, nem acusa)", async () => {
    await montar(CADASTRO_SIMPLES, DONO.carregando);
    const alterar = botao("Alterar");
    expect(travado(alterar)).toBe(true);
    expect(texto()).not.toContain("Só o dono");
    expect(texto()).not.toContain("ainda não tem um dono");
    expect(texto()).not.toContain("Não deu para confirmar");
    expect(temBotao("Tentar de novo")).toBe(false);
    await clicar(alterar);
    expect(folha()).toBeNull();
  });

  it("F2 sou o dono: botão livre, a folha abre e Salvar manda o payload validado", async () => {
    rpc.mockResolvedValue({ data: linhaDoBanco, error: null });
    await montar(CADASTRO_SIMPLES, DONO.souODono);
    expect(travado(botao("Alterar"))).toBe(false);
    expect(texto()).not.toContain("Só o dono");
    expect(texto()).not.toContain("ainda não tem um dono");

    await clicar(botao("Alterar"));
    expect(folha()).not.toBeNull();
    // A folha abre com o que está cadastrado.
    expect(campo(ID_REGIME).value).toBe("simples");
    expect(campo(ID_ATIVIDADE).value).toBe("comercio");
    expect(campo(ID_ABERTA).value).toBe("2024-05-10");
    expect(campo(ID_VENDE).value).toBe("2025-01");

    await preencher(ID_REGIME, "mei");
    await clicar(botao("Salvar"));

    expect(chamadasDeSalvar()).toHaveLength(1);
    expect(chamadasDeSalvar()[0]).toEqual([
      "fiscal_cadastro_salvar",
      {
        p: {
          regime: "mei",
          atividade: "comercio",
          aberta_em: "2024-05-10",
          vende_no_app_desde: "2025-01-01",
        },
      },
    ]);
    // Gravou: a folha fecha, a tela relê o cadastro e avisa.
    expect(folha()).toBeNull();
    expect(recarregar).toHaveBeenCalledTimes(1);
    expect(texto()).toContain("Cadastro fiscal salvo.");
  });

  it("F3 há dono e não sou eu: só leitura, a frase exata e nem à força chama o servidor", async () => {
    await montar(CADASTRO_SIMPLES, DONO.outroEDono);
    expect(texto()).toContain(SO_O_DONO);
    const alterar = botao("Alterar");
    expect(travado(alterar)).toBe(true);
    // A razão está LIGADA ao botão (não só na cor).
    expect(razaoDo(alterar)).toBe(SO_O_DONO);
    // O cadastro continua à vista.
    expect(texto()).toContain("Simples Nacional");

    // À força: o clique no botão travado (aria-disabled não bloqueia o DOM).
    await clicar(alterar);
    expect(folha()).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("F3b a vez do dono acaba com a folha aberta: ela trava e Salvar/submit à força não chamam o servidor", async () => {
    await montar(CADASTRO_SIMPLES, DONO.souODono);
    await clicar(botao("Alterar"));
    await preencher(ID_REGIME, "mei");
    expect(travado(botao("Salvar"))).toBe(false);

    donoFalso.atual = DONO.outroEDono;
    await renderizarDeNovo(CADASTRO_SIMPLES);

    const salvar = botao("Salvar");
    expect(travado(salvar)).toBe(true);
    expect(razaoDo(salvar)).toBe(SO_O_DONO);
    expect(campo(ID_REGIME).disabled).toBe(true);
    await clicar(salvar);
    await submeter();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("F4 SEM dono cadastrado: só leitura e o caminho escrito (nunca libera)", async () => {
    await montar(CADASTRO_SIMPLES, DONO.semDono);
    expect(texto()).toContain(SEM_DONO);
    expect(texto()).not.toContain(SO_O_DONO);
    const alterar = botao("Alterar");
    expect(travado(alterar)).toBe(true);
    expect(razaoDo(alterar)).toBe(SEM_DONO);
    await clicar(alterar);
    expect(folha()).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("F4b sem cadastro E sem dono: o estado vazio troca 'Configurar' pela frase", async () => {
    await montar(SEM_CADASTRO, DONO.semDono);
    expect(texto()).toContain("Configure o regime da sua empresa");
    expect(texto()).toContain(SEM_DONO);
    expect(temBotao("Configurar")).toBe(false);
    expect(temBotao("Alterar")).toBe(false);
  });

  it("F4c sem cadastro e sou o dono: 'Configurar' abre a folha em branco", async () => {
    await montar(SEM_CADASTRO, DONO.souODono);
    expect(texto()).toContain("Configure o regime da sua empresa");
    expect(texto()).not.toContain(SEM_DONO);
    await clicar(botao("Configurar"));
    expect(folha()).not.toBeNull();
    expect(campo(ID_REGIME).value).toBe("");
    expect(campo(ID_ATIVIDADE).value).toBe("");
    expect(campo(ID_ABERTA).value).toBe("");
    expect(campo(ID_VENDE).value).toBe("");
  });

  it("F4d sem cadastro e outro é o dono: 'Configurar' fica travado com a frase do dono", async () => {
    await montar(SEM_CADASTRO, DONO.outroEDono);
    const configurar = botao("Configurar");
    expect(travado(configurar)).toBe(true);
    expect(razaoDo(configurar)).toBe(SO_O_DONO);
    await clicar(configurar);
    expect(folha()).toBeNull();
  });

  it("F5 leitura do dono falhou: só leitura, frase neutra e 'Tentar de novo' RELÊ o dono", async () => {
    await montar(CADASTRO_SIMPLES, DONO.falhou);
    expect(texto()).toContain(NAO_CONFIRMOU);
    // "Não consegui ler" nunca vira "sem dono" nem "só o dono".
    expect(texto()).not.toContain("ainda não tem um dono");
    expect(texto()).not.toContain("Só o dono");
    expect(travado(botao("Alterar"))).toBe(true);
    expect(razaoDo(botao("Alterar"))).toBe(NAO_CONFIRMOU);
    await clicar(botao("Alterar"));
    expect(folha()).toBeNull();

    // Ao reler, a resposta nova vale (aqui: era o dono, a rede é que tinha falhado).
    donoFalso.atual = DONO.souODono;
    await clicar(botao("Tentar de novo"));
    expect(limparDonoFalso).toHaveBeenCalledTimes(1);
    expect(texto()).not.toContain(NAO_CONFIRMOU);
    expect(temBotao("Tentar de novo")).toBe(false);
    expect(travado(botao("Alterar"))).toBe(false);
  });

  it("F5b leitura falhou e continua falhando: a frase segue, nada libera", async () => {
    await montar(SEM_CADASTRO, DONO.falhou);
    expect(texto()).toContain(NAO_CONFIRMOU);
    expect(temBotao("Configurar")).toBe(false);
    await clicar(botao("Tentar de novo"));
    expect(limparDonoFalso).toHaveBeenCalledTimes(1);
    expect(texto()).toContain(NAO_CONFIRMOU);
    expect(rpc).not.toHaveBeenCalled();
  });
});

// ── CNPJ e últimas alterações ───────────────────────────────────────────────

describe("Cadastro fiscal: o que o cartão mostra", () => {
  it("mostra regime, atividade, abertura e começo das vendas pelo app, como a lojista lê", async () => {
    await montar(CADASTRO_SIMPLES, DONO.souODono);
    const t = texto();
    expect(t).toContain("Simples Nacional");
    expect(t).toContain("Só comércio");
    expect(t).toContain("10/05/2024");
    expect(t).toContain("01/2025");
  });

  it("datas que não foram informadas aparecem como 'Não informada', sem inventar", async () => {
    await montar(
      {
        estado: "com_cadastro",
        cadastro: {
          ...(
            CADASTRO_SIMPLES as Extract<
              LeituraDoCadastroFiscal,
              { estado: "com_cadastro" }
            >
          ).cadastro,
          abertaEm: null,
          vendeNoAppDesde: null,
        },
      },
      DONO.souODono,
    );
    expect(texto().match(/Não informad/g)?.length).toBeGreaterThanOrEqual(2);
    expect(texto()).not.toContain("null");
    expect(texto()).not.toContain("undefined");
  });

  it("CNPJ vem de Dados da empresa, já com máscara, e sem atalho quando existe", async () => {
    await montar(CADASTRO_SIMPLES, DONO.souODono);
    expect(texto()).toContain("11.222.333/0001-81");
    expect(temBotao("Minha loja")).toBe(false);
  });

  it("CNPJ vazio mostra o atalho para Minha loja (e o atalho funciona para quem não é o dono)", async () => {
    lojaFalsa.documento = null;
    await montar(CADASTRO_SIMPLES, DONO.outroEDono);
    expect(texto()).toContain("CNPJ");
    await clicar(botao("Minha loja"));
    expect(aoIrParaMinhaLoja).toHaveBeenCalledTimes(1);
  });

  it("CNPJ que não confere não é mostrado (como a vitrine) e cai no atalho", async () => {
    lojaFalsa.documento = "11222333000199";
    await montar(CADASTRO_SIMPLES, DONO.souODono);
    expect(texto()).not.toContain("11.222.333/0001-99");
    expect(temBotao("Minha loja")).toBe(true);
  });

  it("lista as últimas alterações: data, quem e o que mudou", async () => {
    logDoBanco.linhas = [
      {
        id: 2,
        quem: EU,
        quando: "2026-11-20T15:30:00Z",
        antes: {
          regime: "mei",
          atividade: "comercio",
          aberta_em: null,
          vende_no_app_desde: null,
        },
        depois: {
          regime: "simples",
          atividade: "comercio",
          aberta_em: "2024-05-10",
          vende_no_app_desde: null,
        },
      },
      {
        id: 1,
        quem: "uid-que-saiu",
        quando: "2026-11-01T12:00:00Z",
        antes: null,
        depois: {
          regime: "mei",
          atividade: "comercio",
          aberta_em: null,
          vende_no_app_desde: null,
        },
      },
    ];
    await montar(CADASTRO_SIMPLES, DONO.souODono);
    const t = texto();
    expect(t).toContain("Últimas alterações");
    // 15:30 UTC é 12:30 em São Paulo.
    expect(t).toContain("20/11/2026");
    expect(t).toContain("12:30");
    expect(t).toContain("Você");
    expect(t).toContain("Regime: MEI → Simples Nacional");
    expect(t).toContain("Abertura: não informada → 10/05/2024");
    expect(t).toContain("01/11/2026");
    expect(t).toContain("Outra pessoa");
    expect(t).toContain("Cadastro criado: MEI, Só comércio");
  });

  it("o nome de quem mudou depende do dono de hoje: o dono atual aparece como 'O dono da loja'", async () => {
    logDoBanco.linhas = [
      {
        id: 1,
        quem: OUTRO,
        quando: "2026-11-01T12:00:00Z",
        antes: null,
        depois: {
          regime: "mei",
          atividade: "comercio",
          aberta_em: null,
          vende_no_app_desde: null,
        },
      },
    ];
    await montar(CADASTRO_SIMPLES, DONO.outroEDono);
    expect(texto()).toContain("O dono da loja");
    expect(texto()).not.toContain("Você");
  });

  it("erro do cadastro sem dado nenhum: mostra a frase e 'Tentar de novo' relê (sem abrir 'Configurar')", async () => {
    await montar(null, DONO.souODono, {
      erro: "Não deu para ler agora. Confira a sua conexão e tente de novo.",
    });
    expect(texto()).toContain("Não deu para ler agora.");
    expect(temBotao("Configurar")).toBe(false);
    expect(temBotao("Alterar")).toBe(false);
    await clicar(botao("Tentar de novo"));
    expect(recarregar).toHaveBeenCalledTimes(1);
  });

  it("banco da loja sem o cadastro instalado: a frase do suporte, sem botão de configurar", async () => {
    await montar(null, DONO.souODono, {
      erro: "O cadastro fiscal ainda não foi instalado no banco desta loja. Fale com o suporte do IKCOUS.",
    });
    expect(texto()).toContain("Fale com o suporte do IKCOUS.");
    expect(temBotao("Configurar")).toBe(false);
  });

  it("carregando o cadastro pela primeira vez: esqueleto, sem estado vazio e sem botão", async () => {
    await montar(null, DONO.souODono, { carregando: true });
    expect(texto()).not.toContain("Configure o regime");
    expect(temBotao("Configurar")).toBe(false);
    expect(temBotao("Alterar")).toBe(false);
  });

  it("cadastro que o app não entende: o aviso aparece no estado vazio", async () => {
    await montar(
      { estado: "sem_cadastro", aviso: "Aviso de cadastro ilegível." },
      DONO.souODono,
    );
    expect(texto()).toContain("Aviso de cadastro ilegível.");
    expect(texto()).toContain("Configure o regime da sua empresa");
  });
});

// ── A folha: sujo, datas, payload, erros do servidor ───────────────────────

describe("Cadastro fiscal: a folha", () => {
  async function abrir() {
    await montar(CADASTRO_SIMPLES, DONO.souODono);
    await clicar(botao("Alterar"));
  }
  const fechar = () =>
    document.querySelector<HTMLElement>('[aria-label="Fechar"]');

  it("folha sem mudança fecha direto, sem perguntar", async () => {
    await abrir();
    await clicar(fechar() as HTMLElement);
    expect(folha()).toBeNull();
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  });

  it("folha suja pergunta antes de fechar: 'Continuar escrevendo' mantém, 'Descartar' fecha sem gravar", async () => {
    await abrir();
    await preencher(ID_REGIME, "real");
    await clicar(fechar() as HTMLElement);
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
    expect(texto()).toContain("Descartar o que você escreveu?");
    expect(folha()).not.toBeNull();

    await clicar(botao("Continuar escrevendo"));
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(campo(ID_REGIME).value).toBe("real");

    await clicar(fechar() as HTMLElement);
    await clicar(botao("Descartar"));
    expect(folha()).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
    // Reabrir volta ao que está cadastrado, não ao rascunho descartado.
    await clicar(botao("Alterar"));
    expect(campo(ID_REGIME).value).toBe("simples");
  });

  it("voltar ao valor original deixa de ser 'suja' (fecha sem perguntar)", async () => {
    await abrir();
    await preencher(ID_REGIME, "real");
    await preencher(ID_REGIME, "simples");
    await clicar(fechar() as HTMLElement);
    expect(folha()).toBeNull();
  });

  it("sem regime e sem atividade: bloqueia com frase, foca o primeiro campo errado e não chama o servidor", async () => {
    await montar(SEM_CADASTRO, DONO.souODono);
    await clicar(botao("Configurar"));
    await clicar(botao("Salvar"));
    expect(rpc).not.toHaveBeenCalled();
    expect(texto()).toContain("Escolha o regime da sua empresa.");
    expect(document.activeElement).toBe(campo(ID_REGIME));
    expect(campo(ID_REGIME).getAttribute("aria-invalid")).toBe("true");
    const alerta = document.getElementById(`${ID_REGIME}-erro`);
    expect(alerta?.getAttribute("role")).toBe("alert");
    expect(campo(ID_REGIME).getAttribute("aria-describedby")).toContain(
      `${ID_REGIME}-erro`,
    );
  });

  it.each([
    [
      "abertura no futuro",
      ID_ABERTA,
      "2026-11-25",
      "A data de abertura não pode ser no futuro.",
      false,
    ],
    [
      "abertura antes de 1900",
      ID_ABERTA,
      "1899-12-31",
      "A data de abertura não pode ser antes de 1900.",
      false,
    ],
    [
      "vende desde antes de 2020 (sem data de abertura)",
      ID_VENDE,
      "2019-12",
      "não pode ser antes de janeiro de 2020",
      true,
    ],
    [
      "vende desde mês que ainda não começou",
      ID_VENDE,
      "2026-12",
      "não pode ser no futuro",
      false,
    ],
    [
      "vende desde antes da abertura",
      ID_VENDE,
      "2024-04",
      "não pode ser antes da abertura da empresa",
      false,
    ],
  ])(
    "%s: bloqueia o Salvar com frase em português e não chama o servidor",
    async (_nome, id, valor, frase, semAbertura) => {
      await abrir();
      // Com abertura em 2024, um começo em 2019 já erra pela abertura: limpa para
      // isolar a regra de 2020.
      if (semAbertura) await preencher(ID_ABERTA, "");
      await preencher(id, valor);
      await clicar(botao("Salvar"));
      expect(rpc).not.toHaveBeenCalled();
      expect(texto()).toContain(frase);
      expect(document.getElementById(`${id}-erro`)?.getAttribute("role")).toBe(
        "alert",
      );
      expect(folha()).not.toBeNull();
      // Também pelo submit do formulário (Enter), não só pelo botão.
      await submeter();
      expect(rpc).not.toHaveBeenCalled();
    },
  );

  it("os limites VALEM: abertura em 1900-01-01 e começo em 2020-01 e no mês de hoje passam", async () => {
    rpc.mockResolvedValue({ data: linhaDoBanco, error: null });
    await montar(SEM_CADASTRO, DONO.souODono);
    await clicar(botao("Configurar"));
    await preencher(ID_REGIME, "presumido");
    await preencher(ID_ATIVIDADE, "com_servico");
    await preencher(ID_ABERTA, "1900-01-01");
    await preencher(ID_VENDE, "2020-01");
    await clicar(botao("Salvar"));
    expect(chamadasDeSalvar()[0]?.[1]).toEqual({
      p: {
        regime: "presumido",
        atividade: "com_servico",
        aberta_em: "1900-01-01",
        vende_no_app_desde: "2020-01-01",
      },
    });
  });

  it("yyyy-mm vira yyyy-mm-01 no payload (e o mês de hoje vale)", async () => {
    rpc.mockResolvedValue({ data: linhaDoBanco, error: null });
    await montar(SEM_CADASTRO, DONO.souODono);
    await clicar(botao("Configurar"));
    await preencher(ID_REGIME, "mei");
    await preencher(ID_ATIVIDADE, "comercio");
    await preencher(ID_VENDE, "2026-11");
    await clicar(botao("Salvar"));
    expect(chamadasDeSalvar()).toHaveLength(1);
    expect(chamadasDeSalvar()[0]?.[1]).toEqual({
      p: {
        regime: "mei",
        atividade: "comercio",
        aberta_em: null,
        vende_no_app_desde: "2026-11-01",
      },
    });
  });

  it("datas opcionais vazias vão como null (nunca string vazia)", async () => {
    rpc.mockResolvedValue({ data: linhaDoBanco, error: null });
    await montar(SEM_CADASTRO, DONO.souODono);
    await clicar(botao("Configurar"));
    await preencher(ID_REGIME, "nao_sei");
    await preencher(ID_ATIVIDADE, "comercio");
    await clicar(botao("Salvar"));
    expect(chamadasDeSalvar()[0]?.[1]).toEqual({
      p: {
        regime: "nao_sei",
        atividade: "comercio",
        aberta_em: null,
        vende_no_app_desde: null,
      },
    });
  });

  it("o banco recusa (42501): a frase do hook aparece, a folha segue aberta e nada repete sozinho", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: "42501", message: "Acesso negado" },
    });
    await abrir();
    await preencher(ID_REGIME, "mei");
    await clicar(botao("Salvar"));
    expect(texto()).toContain(SO_O_DONO);
    expect(folha()).not.toBeNull();
    await assentar();
    expect(chamadasDeSalvar()).toHaveLength(1);
    expect(recarregar).not.toHaveBeenCalled();
  });

  it("sem resposta da rede: manda conferir antes de repetir, trava o Salvar e relê ao fechar", async () => {
    rpc.mockRejectedValue(new TypeError("Failed to fetch"));
    await abrir();
    await preencher(ID_REGIME, "mei");
    await clicar(botao("Salvar"));
    expect(texto()).toContain(
      "não deu para confirmar se o cadastro fiscal foi salvo",
    );
    expect(texto()).toContain("Feche esta tela e confira o cadastro fiscal");
    expect(chamadasDeSalvar()).toHaveLength(1);
    // Pode ter gravado: o Salvar não repete (nem por clique, nem por Enter).
    const salvar = botao("Salvar");
    expect(travado(salvar)).toBe(true);
    await clicar(salvar);
    await submeter();
    expect(chamadasDeSalvar()).toHaveLength(1);
    expect(recarregar).not.toHaveBeenCalled();

    // Fechar não pergunta "descartar" (o rascunho pode já estar gravado) e relê.
    await clicar(fechar() as HTMLElement);
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(folha()).toBeNull();
    expect(recarregar).toHaveBeenCalledTimes(1);
  });

  it("prazo de 30 s estourado: manda conferir antes de repetir, trava o Salvar e nada repete sozinho", async () => {
    rpc.mockImplementation(() => new Promise(() => {}));
    await abrir();
    await preencher(ID_REGIME, "mei");
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      await act(async () => {
        botao("Salvar").click();
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(31_000);
      });
      expect(texto()).toContain("antes de repetir");
      expect(travado(botao("Salvar"))).toBe(true);
      await act(async () => {
        botao("Salvar").click();
        await vi.advanceTimersByTimeAsync(60_000);
      });
      expect(chamadasDeSalvar()).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("clique duplo em Salvar manda UMA gravação só", async () => {
    let responder: (v: unknown) => void = () => {};
    rpc.mockImplementation(
      () =>
        new Promise((resolve) => {
          responder = resolve;
        }),
    );
    await abrir();
    await preencher(ID_REGIME, "mei");
    await act(async () => {
      botao("Salvar").click();
      botao("Salvar").click();
    });
    expect(chamadasDeSalvar()).toHaveLength(1);
    // Enquanto grava, a folha não fecha (nem pelo X) e os campos ficam parados.
    expect(campo(ID_REGIME).disabled).toBe(true);
    await clicar(fechar() as HTMLElement);
    expect(folha()).not.toBeNull();
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    await act(async () => {
      responder({ data: linhaDoBanco, error: null });
    });
    await assentar();
    expect(folha()).toBeNull();
  });

  it("a folha tem rótulos ligados aos campos e razão do botão travado por aria-describedby", async () => {
    await abrir();
    for (const id of [ID_REGIME, ID_ATIVIDADE, ID_ABERTA, ID_VENDE]) {
      expect(document.querySelector(`label[for="${id}"]`)).not.toBeNull();
    }
  });
});
