// O religador da fila offline (`criarReligadorDaFila`): depois de uma passada
// que parou porque o token não renovou por falta de internet, espera a sessão
// DO MESMO DONO voltar (`TOKEN_REFRESHED`/`SIGNED_IN`) e manda tentar de novo
// UMA vez. Os testes dos hooks provam a ligação; aqui ficam as bordas do
// relógio: outro usuário, outro evento, assinatura duplicada, desmonte e a
// renovação que já tinha saído antes da assinatura.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Ouvinte = (evento: string, sessao: unknown) => void;

const estado = vi.hoisted(() => ({
  ouvintes: [] as Array<(evento: string, sessao: unknown) => void>,
  cancelados: 0,
  sessaoDoDono: vi.fn<(id: string) => Promise<boolean>>(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      onAuthStateChange: (ouvinte: Ouvinte) => {
        estado.ouvintes.push(ouvinte);
        return {
          data: {
            subscription: {
              unsubscribe: () => {
                estado.cancelados += 1;
                const i = estado.ouvintes.indexOf(ouvinte);
                if (i !== -1) estado.ouvintes.splice(i, 1);
              },
            },
          },
        };
      },
    },
  },
}));

vi.mock("@/lib/sessao-ainda-e-do-dono", () => ({
  sessaoAindaEhDoDono: (id: string) => estado.sessaoDoDono(id),
}));

import { falhasPassageirasDaFila } from "@/lib/recuo-da-fila-offline";
import {
  criarReligadorDaFila,
  paradasPelaRede,
} from "@/lib/religar-fila-offline";

const avisar = (evento: string, userId: string | null | undefined) => {
  for (const ouvinte of [...estado.ouvintes]) {
    ouvinte(evento, userId === undefined ? null : { user: { id: userId } });
  }
};
const deixarPromessasAndar = () => new Promise((r) => setTimeout(r, 0));

describe("religador da fila offline", () => {
  beforeEach(() => {
    estado.ouvintes.length = 0;
    estado.cancelados = 0;
    estado.sessaoDoDono.mockReset();
    estado.sessaoDoDono.mockResolvedValue(false);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("passada que NÃO parou pela rede: não assina nada", () => {
    const religador = criarReligadorDaFila("u1", vi.fn());
    religador.aoFimDaPassada(false);
    expect(estado.ouvintes).toHaveLength(0);
    expect(estado.sessaoDoDono).not.toHaveBeenCalled();
  });

  it.each(["TOKEN_REFRESHED", "SIGNED_IN"])(
    "parou pela rede: o evento %s do MESMO usuário religa, uma vez só",
    (evento) => {
      const retomar = vi.fn();
      const religador = criarReligadorDaFila("u1", retomar);
      religador.aoFimDaPassada(true);

      avisar(evento, "u1");
      expect(retomar).toHaveBeenCalledTimes(1);

      // Já desarmou: um segundo aviso não religa de novo.
      avisar(evento, "u1");
      expect(retomar).toHaveBeenCalledTimes(1);
      expect(estado.ouvintes).toHaveLength(0);
    },
  );

  it("o aviso de OUTRO usuário (conta trocada) não religa e continua à espera", () => {
    const retomar = vi.fn();
    const religador = criarReligadorDaFila("u1", retomar);
    religador.aoFimDaPassada(true);

    avisar("TOKEN_REFRESHED", "u2");
    avisar("SIGNED_IN", "u2");
    expect(retomar).not.toHaveBeenCalled();
    expect(estado.ouvintes).toHaveLength(1);

    avisar("TOKEN_REFRESHED", "u1");
    expect(retomar).toHaveBeenCalledTimes(1);
  });

  it.each([
    "SIGNED_OUT",
    "USER_UPDATED",
    "INITIAL_SESSION",
    "PASSWORD_RECOVERY",
  ])("o evento %s, mesmo do dono, não religa", (evento) => {
    const retomar = vi.fn();
    criarReligadorDaFila("u1", retomar).aoFimDaPassada(true);

    avisar(evento, "u1");
    expect(retomar).not.toHaveBeenCalled();
  });

  it("renovação sem sessão (evento sem usuário) não religa e não lança", () => {
    const retomar = vi.fn();
    criarReligadorDaFila("u1", retomar).aoFimDaPassada(true);

    expect(() => avisar("TOKEN_REFRESHED", undefined)).not.toThrow();
    expect(retomar).not.toHaveBeenCalled();
  });

  it("a renovação que saiu ANTES da assinatura: a sessão já ser do dono religa", async () => {
    estado.sessaoDoDono.mockResolvedValue(true);
    const retomar = vi.fn();
    criarReligadorDaFila("u1", retomar).aoFimDaPassada(true);

    expect(estado.sessaoDoDono).toHaveBeenCalledWith("u1");
    await deixarPromessasAndar();
    expect(retomar).toHaveBeenCalledTimes(1);
    expect(estado.ouvintes).toHaveLength(0);
  });

  it("sessão ainda não é do dono: espera, e o aviso do evento religa depois", async () => {
    estado.sessaoDoDono.mockResolvedValue(false);
    const retomar = vi.fn();
    criarReligadorDaFila("u1", retomar).aoFimDaPassada(true);

    await deixarPromessasAndar();
    expect(retomar).not.toHaveBeenCalled();

    avisar("TOKEN_REFRESHED", "u1");
    expect(retomar).toHaveBeenCalledTimes(1);
  });

  it("o aviso do evento E a conferência da sessão no mesmo instante: retoma UMA vez", async () => {
    estado.sessaoDoDono.mockResolvedValue(true);
    const retomar = vi.fn();
    criarReligadorDaFila("u1", retomar).aoFimDaPassada(true);

    avisar("TOKEN_REFRESHED", "u1");
    await deixarPromessasAndar();
    expect(retomar).toHaveBeenCalledTimes(1);
  });

  it("uma nova passada limpa troca a espera: a assinatura antiga é desfeita e nada religa", () => {
    const retomar = vi.fn();
    const religador = criarReligadorDaFila("u1", retomar);
    religador.aoFimDaPassada(true);
    expect(estado.ouvintes).toHaveLength(1);

    religador.aoFimDaPassada(false);
    expect(estado.ouvintes).toHaveLength(0);
    expect(estado.cancelados).toBe(1);

    avisar("TOKEN_REFRESHED", "u1");
    expect(retomar).not.toHaveBeenCalled();
  });

  it("duas passadas seguidas que pararam pela rede: só existe UMA assinatura viva", () => {
    const retomar = vi.fn();
    const religador = criarReligadorDaFila("u1", retomar);
    religador.aoFimDaPassada(true);
    religador.aoFimDaPassada(true);

    expect(estado.ouvintes).toHaveLength(1);
    expect(estado.cancelados).toBe(1);

    avisar("SIGNED_IN", "u1");
    expect(retomar).toHaveBeenCalledTimes(1);
  });

  it("encerrar desfaz a assinatura; passada que termina DEPOIS não assina outra", async () => {
    estado.sessaoDoDono.mockResolvedValue(true);
    const retomar = vi.fn();
    const religador = criarReligadorDaFila("u1", retomar);
    religador.aoFimDaPassada(true);
    religador.encerrar();
    expect(estado.ouvintes).toHaveLength(0);

    // A passada em voo no desmonte termina depois: não pode rearmar.
    religador.aoFimDaPassada(true);
    await deixarPromessasAndar();
    expect(estado.ouvintes).toHaveLength(0);
    expect(retomar).not.toHaveBeenCalled();
  });

  it("depois de encerrar, a conferência da sessão que já estava em voo não religa", async () => {
    let resolver: (v: boolean) => void = () => {};
    estado.sessaoDoDono.mockReturnValue(
      new Promise<boolean>((r) => {
        resolver = r;
      }),
    );
    const retomar = vi.fn();
    const religador = criarReligadorDaFila("u1", retomar);
    religador.aoFimDaPassada(true);

    religador.encerrar();
    resolver(true);
    await deixarPromessasAndar();
    expect(retomar).not.toHaveBeenCalled();
  });
});

describe("registros de parada da fila offline", () => {
  it("nenhuma fila nasce marcada como parada pela rede nem por falha passageira", () => {
    // Um aparelho que acabou de abrir não pode herdar "parou" de ninguém: o
    // efeito do hook lê `has(chave)` ao fim da PRIMEIRA passada.
    expect(paradasPelaRede.size).toBe(0);
    expect(falhasPassageirasDaFila.size).toBe(0);
  });
});
