import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { dispararPushContadoReal } from "./aviso-ao-lojista.ts";
import { inscricaoDeTeste, parVapidDeTeste, pushServiceFalso } from "./webpush_fixtures.ts";

type Linha = Record<string, unknown>;
type Filtro = {
  tabela: string;
  metodo: "eq" | "in";
  coluna: string;
  valor: unknown;
};

/** O select também é aguardável: apagar o filtro devolve TODAS as linhas. */
function consultaFiltrada(tabela: string, linhas: Linha[], filtros: Filtro[]) {
  let selecionadas = [...linhas];
  const consulta = {
    eq(coluna: string, valor: unknown) {
      filtros.push({ tabela, metodo: "eq", coluna, valor });
      selecionadas = selecionadas.filter((linha) => new Map(Object.entries(linha)).get(coluna) === valor);
      return consulta;
    },
    in(coluna: string, ids: unknown[]) {
      filtros.push({ tabela, metodo: "in", coluna, valor: [...ids] });
      selecionadas = selecionadas.filter((linha) => ids.includes(new Map(Object.entries(linha)).get(coluna)));
      return consulta;
    },
    then(resolve: (resultado: { data: Linha[]; error: null }) => unknown) {
      return Promise.resolve({ data: selecionadas, error: null }).then(resolve);
    },
  };
  return consulta;
}

async function avisarComPerfisMistos() {
  const service = pushServiceFalso({ "/p/admin": 201, "/p/cliente": 201 });
  const filtros: Filtro[] = [];
  const par = await parVapidDeTeste();
  const ambiente = new Map([
    ["VAPID_PUBLIC_KEY", par.publica],
    ["VAPID_PRIVATE_KEY", par.privada],
    ["VAPID_SUBJECT", "mailto:teste@example.org"],
  ]);
  const anteriores = new Map([...ambiente.keys()].map((nome) => [nome, Deno.env.get(nome)]));
  try {
    for (const [nome, valor] of ambiente) Deno.env.set(nome, valor);
    const tabelas = new Map<string, Linha[]>([
      ["profiles", [
        { id: "cliente-1", role: "customer" },
        { id: "admin-1", role: "admin" },
      ]],
      ["push_subscriptions", [
        { ...await inscricaoDeTeste(`${service.base}/p/cliente`), user_id: "cliente-1" },
        { ...await inscricaoDeTeste(`${service.base}/p/admin`), user_id: "admin-1" },
      ]],
    ]);
    const supabase = {
      from(tabela: string) {
        const linhas = tabelas.get(tabela);
        if (!linhas) throw new Error(`Tabela inesperada: ${tabela}`);
        return { select: () => consultaFiltrada(tabela, linhas, filtros) };
      },
    };

    const entregues = await dispararPushContadoReal({
      supabase: supabase as never,
      aviso: { title: "Pedido novo", body: "Pedido fictício", url: "/admin-orders" },
      rotulo: "teste-filtros",
    });
    return { entregues, caminhos: service.recebidas.map((r) => r.caminho), filtros };
  } finally {
    for (const [nome, valor] of anteriores) {
      if (valor === undefined) Deno.env.delete(nome);
      else Deno.env.set(nome, valor);
    }
    await service.encerrar();
  }
}

Deno.test("perfis mistos: somente o admin recebe push pelo filtro role = admin", async () => {
  const { entregues, caminhos, filtros } = await avisarComPerfisMistos();

  assertEquals(entregues, 1);
  assertEquals(caminhos, ["/p/admin"]);
  assertEquals(filtros.filter((f) => f.tabela === "profiles"), [
    { tabela: "profiles", metodo: "eq", coluna: "role", valor: "admin" },
  ]);
});

Deno.test("inscrições mistas: somente o user_id dos admins recebe o push", async () => {
  const { entregues, caminhos, filtros } = await avisarComPerfisMistos();

  assertEquals(entregues, 1);
  assertEquals(caminhos, ["/p/admin"]);
  assertEquals(filtros.filter((f) => f.tabela === "push_subscriptions"), [
    { tabela: "push_subscriptions", metodo: "in", coluna: "user_id", valor: ["admin-1"] },
  ]);
});
