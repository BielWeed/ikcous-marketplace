// O que este teste protege, no módulo que é a ÚNICA porta entre a tela e o
// CPF/perfil da conta (`@/lib/cpf-da-conta`):
//  - rede lenta: a leitura espera até 15 s e a gravação até 20 s; passado o
//    prazo o motivo é "prazo_esgotado" (a tela avisa "o dado pode ter sido
//    salvo" e relê), NUNCA um "falha" que mandaria a pessoa tentar de novo
//    sem conferir;
//  - a resposta que chega DEPOIS do prazo avisa quem chamou se o servidor
//    confirmou ou recusou (o `confirmou` decide se o rascunho do CPF é
//    descartado), e o perfil repassa o aviso;
//  - o erro CPF02 (sem sessão dentro da função) vira "sem_sessao";
//  - leitura sem dado vira `cpf: null`, nunca `undefined`;
//  - a mensagem fixa do prazo esgotado.
// Os testes vizinhos (`cpf-da-conta.test.ts`) só cobrem resposta imediata.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pedidoCpfComCabecalho } from "./helpers/pedido-cpf-com-cabecalho";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: () =>
        Promise.resolve({
          data: {
            session: { access_token: "token-a", user: { id: "conta-a" } },
          },
        }),
    },
    rpc: (...args: unknown[]) => {
      const resposta = rpc(...args);
      return args[0] === "get_my_cpf"
        ? resposta
        : pedidoCpfComCabecalho(resposta);
    },
  },
}));

import {
  gravarCpfDaConta,
  gravarPerfilDaConta,
  lerCpfDaConta,
  mensagemFalhaCpf,
} from "@/lib/cpf-da-conta";

type Resposta = { data: null; error: { code: string } | null };

/** Resposta do servidor que o teste libera na hora que quiser. */
function respostaManual() {
  let liberar: (valor: Resposta) => void = () => {};
  const promessa = new Promise<Resposta>((resolve) => {
    liberar = resolve;
  });
  return { promessa, liberar };
}

beforeEach(() => {
  rpc.mockReset();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("lerCpfDaConta — prazo e resposta sem dado", () => {
  it("só dá por esgotado aos 15 s, e então diz prazo_esgotado (não falha)", async () => {
    rpc.mockReturnValueOnce(new Promise(() => {}));
    let terminou = false;
    const leitura = lerCpfDaConta().then((resultado) => {
      terminou = true;
      return resultado;
    });

    await vi.advanceTimersByTimeAsync(14_999);
    expect(terminou).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(await leitura).toEqual({ ok: false, motivo: "prazo_esgotado" });
  });

  it("resposta sem dado nenhum devolve cpf null, nunca undefined", async () => {
    rpc.mockResolvedValueOnce({ error: null });

    expect(await lerCpfDaConta()).toEqual({ ok: true, cpf: null });
  });

  it("CPF02 (sem sessão dentro da função) vira sem_sessao", async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "CPF02", message: "sem sessão" },
    });

    expect(await lerCpfDaConta()).toEqual({ ok: false, motivo: "sem_sessao" });
  });
});

describe("gravarCpfDaConta — prazo e resposta tardia", () => {
  it("só dá por esgotado aos 20 s, e então diz prazo_esgotado", async () => {
    const servidor = respostaManual();
    rpc.mockReturnValueOnce(servidor.promessa);
    let terminou = false;
    const gravacao = gravarCpfDaConta("52998224725", "conta-a").then(
      (resultado) => {
        terminou = true;
        return resultado;
      },
    );

    await vi.advanceTimersByTimeAsync(19_999);
    expect(terminou).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(await gravacao).toEqual({ ok: false, motivo: "prazo_esgotado" });
  });

  it("resposta de sucesso depois do prazo chama o aviso com confirmou = true", async () => {
    const servidor = respostaManual();
    rpc.mockReturnValueOnce(servidor.promessa);
    const aoChegarDepois = vi.fn();
    const gravacao = gravarCpfDaConta("52998224725", "conta-a", aoChegarDepois);

    await vi.advanceTimersByTimeAsync(20_000);
    expect(await gravacao).toEqual({ ok: false, motivo: "prazo_esgotado" });
    expect(aoChegarDepois).not.toHaveBeenCalled();

    servidor.liberar({ data: null, error: null });
    await vi.advanceTimersByTimeAsync(0);

    expect(aoChegarDepois).toHaveBeenCalledTimes(1);
    expect(aoChegarDepois).toHaveBeenCalledWith(true);
  });

  it("recusa do servidor depois do prazo chama o aviso com confirmou = false", async () => {
    const servidor = respostaManual();
    rpc.mockReturnValueOnce(servidor.promessa);
    const aoChegarDepois = vi.fn();
    const gravacao = gravarCpfDaConta("52998224725", "conta-a", aoChegarDepois);

    await vi.advanceTimersByTimeAsync(20_000);
    await gravacao;
    servidor.liberar({ data: null, error: { code: "CPF01" } });
    await vi.advanceTimersByTimeAsync(0);

    expect(aoChegarDepois).toHaveBeenCalledTimes(1);
    expect(aoChegarDepois).toHaveBeenCalledWith(false);
  });

  it("resposta dentro do prazo NÃO chama o aviso de resposta tardia", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: null });
    const aoChegarDepois = vi.fn();

    const resultado = await gravarCpfDaConta(
      "52998224725",
      "conta-a",
      aoChegarDepois,
    );
    await vi.advanceTimersByTimeAsync(30_000);

    expect(resultado).toEqual({ ok: true });
    expect(aoChegarDepois).not.toHaveBeenCalled();
  });

  it("CPF02 (sem sessão dentro da função) vira sem_sessao", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "CPF02" } });

    expect(await gravarCpfDaConta("52998224725", "conta-a")).toEqual({
      ok: false,
      motivo: "sem_sessao",
    });
  });
});

describe("gravarPerfilDaConta — resposta tardia", () => {
  it("avisa quem chamou quando a resposta chega depois do prazo", async () => {
    const servidor = respostaManual();
    rpc.mockReturnValueOnce(servidor.promessa);
    const aoChegarDepois = vi.fn();
    const gravacao = gravarPerfilDaConta(
      { p_full_name: "Nome de A", p_whatsapp: null },
      "conta-a",
      aoChegarDepois,
    );

    await vi.advanceTimersByTimeAsync(20_000);
    expect(await gravacao).toEqual({ ok: false, motivo: "prazo_esgotado" });
    expect(aoChegarDepois).not.toHaveBeenCalled();

    servidor.liberar({ data: null, error: null });
    await vi.advanceTimersByTimeAsync(0);

    expect(aoChegarDepois).toHaveBeenCalledTimes(1);
  });

  it("sem aviso informado, a resposta tardia não quebra nada", async () => {
    const servidor = respostaManual();
    rpc.mockReturnValueOnce(servidor.promessa);
    const gravacao = gravarPerfilDaConta(
      { p_full_name: "Nome de A" },
      "conta-a",
    );

    await vi.advanceTimersByTimeAsync(20_000);
    expect(await gravacao).toEqual({ ok: false, motivo: "prazo_esgotado" });
    servidor.liberar({ data: null, error: null });

    // Se a resposta tardia lançasse, o teste cairia por erro não tratado.
    await vi.advanceTimersByTimeAsync(0);
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});

describe("mensagemFalhaCpf — prazo esgotado", () => {
  it("manda conferir a conta antes de tentar de novo (o dado pode ter sido salvo)", () => {
    expect(mensagemFalhaCpf("prazo_esgotado")).toBe(
      "Não deu para confirmar: o dado pode ter sido salvo. Confira sua conta antes de tentar de novo.",
    );
  });
});
