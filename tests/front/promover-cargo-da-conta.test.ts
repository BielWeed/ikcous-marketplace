// Promover a administrador, camada de chamada (src/lib/cargo-da-conta.ts):
// a RPC definir_cargo recebe os argumentos certos e CADA erro do banco vira a
// frase que o leigo lê. O banco já fala português (42501/22023/P0002) e a tela
// mostra como veio — exceto a falha de rede, a função ausente na loja e o
// cadastro do dono incompleto ("duas fontes"), que viram frase nossa.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  rpc: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: (...args: unknown[]) => h.rpc(...args),
  },
}));

import {
  MENSAGEM_DONO_INCOMPLETO,
  MENSAGEM_FUNCAO_INATIVA,
  MENSAGEM_SEM_REDE,
  definirCargo,
  textoDoSucesso,
} from "@/lib/cargo-da-conta";

const ID = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  h.rpc.mockReset();
});

describe("definirCargo: a chamada", () => {
  it("chama definir_cargo com p_user_id e p_cargo exatos", async () => {
    h.rpc.mockResolvedValue({
      data: { user_id: ID, de: "customer", para: "admin", mudou: true },
      error: null,
    });
    const r = await definirCargo(ID, "admin");
    expect(h.rpc).toHaveBeenCalledTimes(1);
    expect(h.rpc).toHaveBeenCalledWith("definir_cargo", {
      p_user_id: ID,
      p_cargo: "admin",
    });
    expect(r).toEqual({ ok: true, para: "admin", mudou: true });
  });

  it("devolve para=customer ao tirar o acesso", async () => {
    h.rpc.mockResolvedValue({
      data: { user_id: ID, de: "admin", para: "customer", mudou: true },
      error: null,
    });
    const r = await definirCargo(ID, "customer");
    expect(h.rpc).toHaveBeenCalledWith("definir_cargo", {
      p_user_id: ID,
      p_cargo: "customer",
    });
    expect(r).toEqual({ ok: true, para: "customer", mudou: true });
  });

  it("pessoa que já tinha esse cargo (mudou=false) continua sendo sucesso", async () => {
    h.rpc.mockResolvedValue({
      data: { user_id: ID, de: "admin", para: "admin", mudou: false },
      error: null,
    });
    expect(await definirCargo(ID, "admin")).toEqual({
      ok: true,
      para: "admin",
      mudou: false,
    });
  });

  it("resposta sem forma conhecida: assume o cargo pedido (o banco não deu erro)", async () => {
    h.rpc.mockResolvedValue({ data: null, error: null });
    expect(await definirCargo(ID, "admin")).toEqual({
      ok: true,
      para: "admin",
      mudou: true,
    });
  });
});

describe("definirCargo: cada erro", () => {
  it("42501 (só o dono): mostra a mensagem do servidor, como veio", async () => {
    h.rpc.mockResolvedValue({
      data: null,
      error: {
        code: "42501",
        message: "Acesso negado: só o dono da loja define cargos.",
      },
    });
    expect(await definirCargo(ID, "admin")).toEqual({
      ok: false,
      codigo: "42501",
      mensagem: "Acesso negado: só o dono da loja define cargos.",
    });
  });

  it("42501 do cargo do dono: mensagem do servidor, como veio", async () => {
    h.rpc.mockResolvedValue({
      data: null,
      error: { code: "42501", message: "O cargo do dono da loja não muda." },
    });
    const r = await definirCargo(ID, "customer");
    expect(r).toMatchObject({
      ok: false,
      mensagem: "O cargo do dono da loja não muda.",
    });
  });

  it("22023 (cargo inválido): mensagem do servidor", async () => {
    h.rpc.mockResolvedValue({
      data: null,
      error: {
        code: "22023",
        message: "Cargo inválido: informe a pessoa e use admin ou customer.",
      },
    });
    expect(await definirCargo(ID, "admin")).toMatchObject({
      ok: false,
      codigo: "22023",
      mensagem: "Cargo inválido: informe a pessoa e use admin ou customer.",
    });
  });

  it("P0002 (pessoa inexistente): mensagem do servidor", async () => {
    h.rpc.mockResolvedValue({
      data: null,
      error: { code: "P0002", message: "Pessoa não encontrada." },
    });
    expect(await definirCargo(ID, "admin")).toMatchObject({
      ok: false,
      codigo: "P0002",
      mensagem: "Pessoa não encontrada.",
    });
  });

  it.each([
    "Acesso negado: o dono da loja precisa ser administrador nas duas fontes (auth.users e profiles).",
    "O cargo não foi gravado: confira se o dono é administrador nas duas fontes (auth.users e profiles).",
  ])("42501 com 'duas fontes' vira português simples: %s", async (msg) => {
    h.rpc.mockResolvedValue({
      data: null,
      error: { code: "42501", message: msg },
    });
    const r = await definirCargo(ID, "admin");
    expect(r).toEqual({
      ok: false,
      codigo: "42501",
      mensagem:
        "O cadastro do dono da loja está incompleto. Fale com o suporte para acertar.",
    });
    expect(MENSAGEM_DONO_INCOMPLETO).toBe(
      "O cadastro do dono da loja está incompleto. Fale com o suporte para acertar.",
    );
  });

  it("'duas fontes' em outro código NÃO é trocado (só o 42501 é)", async () => {
    h.rpc.mockResolvedValue({
      data: null,
      error: { code: "22023", message: "texto com duas fontes" },
    });
    expect(await definirCargo(ID, "admin")).toMatchObject({
      mensagem: "texto com duas fontes",
    });
  });

  it("PGRST202 (função ainda não existe nesta loja) degrada com frase nossa", async () => {
    h.rpc.mockResolvedValue({
      data: null,
      error: {
        code: "PGRST202",
        message: "Could not find the function public.definir_cargo(...)",
      },
    });
    expect(await definirCargo(ID, "admin")).toEqual({
      ok: false,
      codigo: "PGRST202",
      mensagem: "Esta função ainda não está ativa nesta loja.",
    });
    expect(MENSAGEM_FUNCAO_INATIVA).toBe(
      "Esta função ainda não está ativa nesta loja.",
    );
  });

  it("erro de rede devolvido pelo cliente: frase de rede, nunca o inglês do navegador", async () => {
    h.rpc.mockResolvedValue({
      data: null,
      error: { message: "TypeError: Failed to fetch" },
    });
    const r = await definirCargo(ID, "admin");
    expect(r).toMatchObject({ ok: false, mensagem: MENSAGEM_SEM_REDE });
    expect(MENSAGEM_SEM_REDE).toBe(
      "Sem conexão com a internet. Confira a rede e tente de novo.",
    );
  });

  it("a chamada que LANÇA (rede caiu no meio) também vira frase de rede e não propaga", async () => {
    h.rpc.mockRejectedValue(new TypeError("Failed to fetch"));
    const r = await definirCargo(ID, "admin");
    expect(r).toMatchObject({ ok: false, mensagem: MENSAGEM_SEM_REDE });
  });

  it("erro sem mensagem: frase genérica, nunca vazio", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { code: "XX000" } });
    const r = await definirCargo(ID, "admin");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.mensagem.length).toBeGreaterThan(10);
  });
});

describe("texto do sucesso e linguagem", () => {
  it("promoção: avisa para a pessoa sair e entrar de novo", () => {
    expect(textoDoSucesso("Maria Silva", "admin")).toBe(
      "Maria Silva agora é administrador. Peça para essa pessoa sair e entrar de novo no app.",
    );
  });

  it("remoção: promete só 'até cerca de 1 hora', nunca 'pronto, removido'", () => {
    const t = textoDoSucesso("Maria Silva", "customer");
    expect(t).toBe(
      "Maria Silva voltou a ser cliente. O acesso ao painel pode levar até cerca de 1 hora para acabar por completo.",
    );
    expect(t).not.toMatch(/pronto|removido/i);
  });

  it("nome vazio cai em 'Esta pessoa'", () => {
    expect(textoDoSucesso("", "customer")).toMatch(/^Esta pessoa voltou/);
  });

  it("a palavra 'administradora' não existe no módulo (sem gênero)", () => {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- caminho fixo do proprio repositorio
    const fonte = readFileSync(
      join(__dirname, "..", "..", "src", "lib", "cargo-da-conta.ts"),
      "utf8",
    );
    expect(fonte).not.toMatch(/administradora/i);
  });
});
