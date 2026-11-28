// As bordas do pedido de comprovante da visitante (lote 579), sem tela: o que
// a tela recebe de cada resposta do banco e da edge. O caminho feliz e o teto
// estão em checkout-convite-do-comprovante-da-visitante.test.tsx; aqui ficam
// os casos que doem — rede pendurada, erro HTTP que esconde o motivo, banco
// que recusa, e o e-mail que já ficou no pedido nunca volta a ser pedido.
// E-mail inventado, no domínio reservado .test.
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({ supabase: {} }));

const EMAIL = "visitante@exemplo.test";
const PEDIDO = "0b7c1c39-9d8e-4c4e-8f3a-5a1f0c2b9e11";

function cliente(opts: {
  gravacao?: () => Promise<{ data: unknown; error: unknown }>;
  envio?: () => Promise<{ data: unknown; error: unknown }>;
}) {
  const rpc = vi.fn(
    opts.gravacao ??
      (() =>
        Promise.resolve({
          data: { ok: true, motivo: "gravado" },
          error: null,
        })),
  );
  const invoke = vi.fn(
    opts.envio ?? (() => Promise.resolve({ data: { ok: true }, error: null })),
  );
  return { rpc, invoke, supabase: { rpc, functions: { invoke } } };
}

const nunca = () => new Promise<never>(() => {});

describe("pedirComprovanteDaVisitante", () => {
  it("e-mail fora do formato não chega ao banco (vírgula, espaço, sem domínio, longo demais)", async () => {
    const { pedirComprovanteDaVisitante } = await import(
      "@/lib/comprovante-da-visitante"
    );
    for (const ruim of [
      "",
      "   ",
      "a@b",
      "a,b@exemplo.test",
      "a b@exemplo.test",
      "a@exemplo.test\nBcc: x@exemplo.test",
      `${"a".repeat(250)}@exemplo.test`,
    ]) {
      const c = cliente({});
      expect(
        await pedirComprovanteDaVisitante(PEDIDO, ruim, {
          supabase: c.supabase,
        }),
      ).toEqual({ etapa: "nao_guardado", motivo: "email_invalido" });
      expect(c.rpc).not.toHaveBeenCalled();
      expect(c.invoke).not.toHaveBeenCalled();
    }
  });

  it("gravou e a edge respondeu ok: enviado, com o e-mail aparado; ja_enviado (dois toques) também é enviado", async () => {
    const { pedirComprovanteDaVisitante } = await import(
      "@/lib/comprovante-da-visitante"
    );
    const c = cliente({});
    expect(
      await pedirComprovanteDaVisitante(PEDIDO, ` ${EMAIL} `, {
        supabase: c.supabase,
      }),
    ).toEqual({ etapa: "enviado", email: EMAIL });
    expect(c.rpc).toHaveBeenCalledWith("informar_email_da_visitante", {
      p_order_id: PEDIDO,
      p_email: EMAIL,
    });
    expect(c.invoke).toHaveBeenCalledWith("send-order-confirmation", {
      body: { orderId: PEDIDO, comoVisitante: true },
    });

    const repetido = cliente({
      envio: () =>
        Promise.resolve({
          data: { ok: false, motivo: "ja_enviado" },
          error: null,
        }),
    });
    expect(
      await pedirComprovanteDaVisitante(PEDIDO, EMAIL, {
        supabase: repetido.supabase,
      }),
    ).toEqual({ etapa: "enviado", email: EMAIL });
  });

  it("o banco recusa: o motivo dele chega à tela e a edge nem é chamada", async () => {
    const { pedirComprovanteDaVisitante } = await import(
      "@/lib/comprovante-da-visitante"
    );
    for (const motivo of ["fora_do_prazo", "nao_aceita", "email_invalido"]) {
      const c = cliente({
        gravacao: () =>
          Promise.resolve({ data: { ok: false, motivo }, error: null }),
      });
      expect(
        await pedirComprovanteDaVisitante(PEDIDO, EMAIL, {
          supabase: c.supabase,
        }),
      ).toEqual({ etapa: "nao_guardado", motivo });
      expect(c.invoke).not.toHaveBeenCalled();
    }
    // Motivo desconhecido, resposta vazia e erro do PostgREST (a RPC ainda não
    // existe na loja: PGRST202) viram "falha": a pessoa pode tentar de novo.
    for (const resposta of [
      { data: { ok: false, motivo: "outro" }, error: null },
      { data: null, error: null },
      { data: null, error: { code: "PGRST202", message: "sem a funcao" } },
    ]) {
      const c = cliente({ gravacao: () => Promise.resolve(resposta) });
      expect(
        await pedirComprovanteDaVisitante(PEDIDO, EMAIL, {
          supabase: c.supabase,
        }),
      ).toEqual({ etapa: "nao_guardado", motivo: "falha" });
      expect(c.invoke).not.toHaveBeenCalled();
    }
  });

  it("a gravação pendurada na rede: falha (dá para tentar de novo), sem chamar a edge", async () => {
    const { pedirComprovanteDaVisitante } = await import(
      "@/lib/comprovante-da-visitante"
    );
    const c = cliente({ gravacao: nunca });
    expect(
      await pedirComprovanteDaVisitante(PEDIDO, EMAIL, {
        supabase: c.supabase,
        prazoDaGravacaoMs: 5,
      }),
    ).toEqual({ etapa: "nao_guardado", motivo: "falha" });
    expect(c.invoke).not.toHaveBeenCalled();
  });

  it("gravou, mas o comprovante não saiu: teto, erro HTTP com o motivo no corpo, erro sem corpo e rede pendurada — o e-mail nunca volta a ser pedido", async () => {
    const { pedirComprovanteDaVisitante } = await import(
      "@/lib/comprovante-da-visitante"
    );
    const casos: Array<
      [() => Promise<{ data: unknown; error: unknown }>, string]
    > = [
      [
        () =>
          Promise.resolve({
            data: { ok: false, motivo: "teto_diario" },
            error: null,
          }),
        "teto_diario",
      ],
      // 502 sem_remetente: o invoke esconde o corpo no erro; a tela não manda
      // "tentar de novo" para a loja sem e-mail configurado.
      [
        () =>
          Promise.resolve({
            data: null,
            error: {
              context: {
                json: () =>
                  Promise.resolve({ ok: false, motivo: "sem_remetente" }),
              },
            },
          }),
        "envio_falhou",
      ],
      [
        () =>
          Promise.resolve({
            data: null,
            error: {
              context: { json: () => Promise.reject(new Error("html")) },
            },
          }),
        "envio_falhou",
      ],
      [() => Promise.reject(new Error("rede caiu")), "envio_falhou"],
    ];
    for (const [envio, motivo] of casos) {
      const c = cliente({ envio });
      expect(
        await pedirComprovanteDaVisitante(PEDIDO, EMAIL, {
          supabase: c.supabase,
        }),
      ).toEqual({ etapa: "guardado_sem_envio", email: EMAIL, motivo });
    }
    const pendurada = cliente({ envio: nunca });
    expect(
      await pedirComprovanteDaVisitante(PEDIDO, EMAIL, {
        supabase: pendurada.supabase,
        prazoDoEnvioMs: 5,
      }),
    ).toEqual({
      etapa: "guardado_sem_envio",
      email: EMAIL,
      motivo: "sem_resposta",
    });
  });

  it("o formato aceita o e-mail comum (ponto, mais, hífen, subdomínio) e recusa o que vai quebrar o cabeçalho", async () => {
    const { emailDaVisitanteValido } = await import(
      "@/lib/comprovante-da-visitante"
    );
    for (const bom of [
      "maria.silva+loja@exemplo.test",
      "joao_1@mail.exemplo.test",
      "a-b@exemplo-loja.test",
    ])
      expect(emailDaVisitanteValido(bom)).toBe(true);
    for (const ruim of [
      "maria@",
      "@exemplo.test",
      "maria@exemplo",
      "ma ria@exemplo.test",
      "m;a@exemplo.test",
    ])
      expect(emailDaVisitanteValido(ruim)).toBe(false);
  });
});
