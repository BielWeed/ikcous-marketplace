// Item 11 do laudo "o que falta" (29/08): a tela de pedido feito promete
// "Você receberá atualizações em breve" e NADA criava os avisos.
//
// O conserto mora no BANCO (migration 20261026000000): uma trigger AFTER
// UPDATE OF status em marketplace_orders insere o aviso na notificacoes a
// cada transição real — e o realtime do NotificationContext, que já está
// inscrito, acende o sino sozinho. O CI não tem banco: a âncora aqui é o
// ARQUIVO de migration em disco (mesmo padrão de
// recusa-do-pedido-ancora-nas-migrations.test.ts — import.meta.glob com
// ?raw, sem API de Node, para não estourar o typecheck nem o teto de lint).
//
// O que este teste FIXA no corpo da trigger:
//   * as 4 frases por status (processing/shipping/delivered/cancelled);
//   * a guarda do convidado (user_id nulo → sem aviso, porque não tem sino);
//   * a guarda de mudança real (update que não muda status não avisa);
//   * o EXCEPTION que faz o sino ser best-effort (falha de aviso nunca
//     reverte a mudança de status do pedido);
//   * a trigger existe, é AFTER UPDATE OF status e é por linha.
import { describe, expect, it } from "vitest";

const MIGRATIONS = import.meta.glob<string>("/supabase/migrations/*.sql", {
  query: "?raw",
  import: "default",
  eager: true,
});

const ARQUIVO = Object.entries(MIGRATIONS).find(([caminho]) =>
  caminho.includes("20261026000000_o_pedido_avisa_o_cliente"),
);

const sql = ARQUIVO?.[1] ?? "";

// As contagens são no CORPO DA FUNÇÃO, não no arquivo inteiro: o cabeçalho
// da migration traz a ficha de verificação pos-aplicação, que repete frases
// dentro de LIKEs — contar lá daria 2 onde o código tem 1.
const inicioFuncao = sql.indexOf(
  "CREATE OR REPLACE FUNCTION public.notifica_cliente_de_mudanca_de_status",
);
const corpoFuncao = inicioFuncao >= 0 ? sql.slice(inicioFuncao) : "";

describe("a trigger que avisa o cliente existe e promete por verdade", () => {
  it("a migration da trigger está no globo", () => {
    expect(ARQUIVO).toBeDefined();
    expect(sql.length).toBeGreaterThan(1000);
  });

  it("a trigger é AFTER UPDATE OF status, por linha, na tabela do pedido", () => {
    expect(sql).toContain(
      "AFTER UPDATE OF status ON public.marketplace_orders",
    );
    expect(sql).toContain("FOR EACH ROW");
  });

  it("a função da trigger é SECURITY DEFINER (o aviso cruza a RLS de notificacoes)", () => {
    // O admin atualiza o pedido, mas o aviso é DO cliente: sem definer, a
    // policy de INSERT de notificacoes (uid = usuario_id ou admin) recusaria
    // o insert no caminho do webhook (service_role passa, mas o caminho do
    // painel autenticado não).
    expect(sql).toContain("SECURITY DEFINER");
  });

  it("as 4 frases por status existem, cada uma 1x no corpo da função", () => {
    const frases = [
      "Pedido em preparo",
      "Pedido a caminho",
      "Pedido entregue",
      "Pedido cancelado",
    ];
    for (const frase of frases) {
      const vezes = corpoFuncao.split(frase).length - 1;
      expect(vezes, `frase "${frase}"`).toBe(1);
    }
  });

  it("toda notificação nasce amarrada ao pedido (order_id) e ao dono (NEW.user_id)", () => {
    const inserts =
      corpoFuncao.split("INSERT INTO public.notificacoes").length - 1;
    expect(inserts).toBe(4);
    expect(
      corpoFuncao.split("jsonb_build_object('order_id', NEW.id)").length - 1,
    ).toBe(4);
    expect(corpoFuncao.split("VALUES (NEW.user_id,").length - 1).toBe(4);
  });

  it("convidado (user_id nulo) não recebe aviso — e não é erro", () => {
    expect(sql).toContain("IF NEW.user_id IS NULL THEN");
    expect(sql).toContain("RETURN NEW;");
  });

  it("update que NÃO muda o status não acende o sino", () => {
    expect(sql).toContain("IF OLD.status IS NOT DISTINCT FROM NEW.status THEN");
  });

  it("sino é best-effort: falha de aviso NUNCA reverte o status do pedido", () => {
    // O bloco protegido existe UMA vez e a falha fica logada (RAISE WARNING),
    // não engolida em silêncio — defeito de configuração tem de aparecer nos
    // logs do banco.
    expect(corpoFuncao.split("EXCEPTION WHEN OTHERS THEN").length - 1).toBe(1);
    expect(corpoFuncao.split("RAISE WARNING").length - 1).toBe(1);
    // O RETURN NEW final (fora do bloco protegido) é o que devolve o pedido
    // intacto.
    expect(corpoFuncao).toContain("RETURN NEW;");
  });

  it("status sem frase desenhada não inventa aviso", () => {
    expect(sql).toContain("ELSE");
    expect(sql.split("WHEN 'pending'").length - 1).toBe(0);
  });
});
