// @ts-nocheck
import { fromFileUrl } from "https://deno.land/std@0.177.0/path/mod.ts";
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

const ROOT = fromFileUrl(new URL("..", import.meta.url));
const WORKFLOW = fromFileUrl(
  new URL("../.github/workflows/diagnostico-pagamentos.yml", import.meta.url),
);
const MARCADOR_PRIVADO = "CLIENTE_PRIVADO_9821";

function comandoDoPreflight(yaml: string): string {
  const bloco = yaml.match(
    /preflight_pix:\s*\n[\s\S]*?name: Preflight PIX IKCOUS[\s\S]*?run:\s*(node [^\r\n]+)/,
  );
  assert(bloco, "job preflight_pix e comando Node ausentes");
  return bloco[1].trim();
}

async function executar(yaml: string, modo: string, projeto = "loja") {
  const dir = await Deno.makeTempDir();
  try {
    const preload = `${dir}/mock.cjs`;
    const mock = [
      `const modo = ${JSON.stringify(modo)};`,
      "globalThis.fetch = async (url, options = {}) => {",
      "  const ref = 'dekxabvqdsuukijblazl';",
      "  const base = 'https://api.supabase.com/v1/projects/' + ref + '/database/';",
      "  if (url === base + 'query/read-only' && options.method === 'POST') {",
      "    console.log('CHAMADA=SQL_READ_ONLY');",
      `    if (modo === 'sql_403') return {ok:false,status:403,text:async()=> '${MARCADOR_PRIVADO}'};`,
      "    const query = JSON.parse(options.body).query;",
      "    if (modo === 'sql_json_invalido') return {ok:true,status:201,json:async()=>{throw Error('CLIENTE_PRIVADO_9821')}};",
      "    for (let n=74; n<=85; n++) {",
      "      if (!query.includes('202611' + n + '000000') || !query.includes('ledger_' + n))",
      "        return {ok:false,status:500,text:async()=> 'ledger incompleto'};",
      "    }",
      "    for (const termo of ['supabase_migrations.schema_migrations', 'pg_catalog.pg_proc', 'pg_catalog.pg_trigger', 'forma_de_pagamento_aceita', 'devolver_estoque', 'expirar_pedidos_vencidos', 'devolucoes', 'marketplace_order_payment_history', 'iniciar_venda_presencial_pix', 'anular_venda_presencial', 'tr_venda_do_balcao_paga_e_entregue', 'tr_venda_do_balcao_guarda_o_status', 'tgenabled', 'tgfoid', 'has_function_privilege']) {",
      "      if (!query.includes(termo)) return {ok:false,status:500,text:async()=> 'catálogo incompleto'};",
      "    }",
      "    const row = {};",
      "    for (let n=74; n<=85; n++) row['ledger_' + n] = n < 84;",
      "    for (const k of ['pedido_canal','pedido_metodo_online','forma_online','devolver_estoque','expirar_pedidos','devolucoes','historico_pagamento','registrar_venda_auth','confirmar_pagamento','is_admin']) row[k] = true;",
      "    for (const k of ['rpc_pix_presente','rpc_pix_auth','rpc_pix_anon','rpc_pix_definer_path','gatilho_entrega_84','gatilho_status_84','rpc_anular_presente','rpc_anular_auth','rpc_anular_anon','rpc_anular_definer_path']) row[k] = false;",
      "    if (modo === 'sql_incompleto') delete row.ledger_85;",
      "    if (modo === 'sql_campo_extra') row.cliente = true;",
      "    if (modo === 'ledger_falta') row.ledger_75 = false;",
      "    if (modo === 'rpc_parcial') row.rpc_pix_presente = true;",
      "    if (modo === 'prereq_falta') row.devolver_estoque = false;",
      "    return {ok:true,status:201,json:async()=>[row]};",
      "  }",
      "  if (url === base + 'backups' && options.method === 'GET') {",
      "    console.log('CHAMADA=BACKUPS_GET');",
      `    if (modo === 'backup_403') return {ok:false,status:403,text:async()=> '${MARCADOR_PRIVADO}'};`,
      "    if (modo === 'backup_malformado') return {ok:true,status:200,json:async()=>({backups:[{id:971231,status:'COMPLETED'}]})};",
      "    if (modo === 'backup_data_invalida') return {ok:true,status:200,json:async()=>({backups:[{id:971231,status:'COMPLETED',inserted_at:'0'}]})};",
      "    if (modo === 'backup_json_invalido') return {ok:true,status:200,json:async()=>{throw Error('CLIENTE_PRIVADO_9821')}};",
      "    if (modo === 'backup_vazio') return {ok:true,status:200,json:async()=>({backups:[]})};",
      "    if (modo === 'backup_falhou') return {ok:true,status:200,json:async()=>({backups:[{id:971231,status:'FAILED',inserted_at:'2026-09-30T02:00:00Z'}]})};",
      "    if (modo === 'backup_misto') return {ok:true,status:200,json:async()=>({backups:[{id:971230,status:'ARCHIVED',inserted_at:'2026-09-29T02:00:00Z'},{id:971231,status:'COMPLETED',inserted_at:'2026-09-30T02:00:00Z'}]})};",
      "    return {ok:true,status:200,json:async()=>({backups:[{id:971231,status:'COMPLETED',inserted_at:'2026-09-30T02:00:00Z'}]})};",
      "  }",
      "  throw new Error('rota inesperada');",
      "};",
    ].join("\n");
    await Deno.writeTextFile(preload, mock);
    const comando = comandoDoPreflight(yaml).split(" ");
    const proc = new Deno.Command(comando[0], {
      args: comando.slice(1),
      cwd: ROOT,
      env: {
        SUPABASE_ACCESS_TOKEN: "token-de-teste",
        PROJETO: projeto,
        NODE_OPTIONS: `--require=${preload}`,
      },
      stdout: "piped",
      stderr: "piped",
    });
    const result = await proc.output();
    const decode = new TextDecoder();
    return {
      codigo: result.code,
      saida: decode.decode(result.stdout) + decode.decode(result.stderr),
    };
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("preflight PIX IKCOUS usa só APIs de leitura e falha fechado", async (t) => {
  const yaml = await Deno.readTextFile(WORKFLOW);
  assertStringIncludes(yaml, "- preflight_pix");
  assertStringIncludes(yaml, "if: inputs.modo == 'preflight_pix'");
  assertStringIncludes(
    yaml,
    "SUPABASE_ACCESS_TOKEN: " + "$" + "{{ secrets.SUPABASE_ACCESS_TOKEN }}",
  );
  assertEquals(
    comandoDoPreflight(yaml),
    "node scripts/diagnostico-pix-preflight.cjs",
  );
  assertStringIncludes(yaml, "PROJETO: " + "$" + "{{ inputs.projeto }}");

  await t.step("resumo mínimo sem ID de backup nem dado privado", async () => {
    const r = await executar(yaml, "ok");
    assertEquals(r.codigo, 0, r.saida);
    assertStringIncludes(r.saida, "CHAMADA=SQL_READ_ONLY");
    assertStringIncludes(r.saida, "CHAMADA=BACKUPS_GET");
    assertStringIncludes(r.saida, "ledger_74=true");
    assertStringIncludes(r.saida, "ledger_85=false");
    assertStringIncludes(r.saida, "backup_estado=COMPLETED");
    assertStringIncludes(r.saida, "backup_data=2026-09-30T02:00:00.000Z");
    assert(!r.saida.includes("971231"), r.saida);
    assert(!r.saida.includes("token-de-teste"), r.saida);
    assert(!r.saida.includes(MARCADOR_PRIVADO), r.saida);
  });

  await t.step(
    "backup histórico arquivado não bloqueia o mais recente",
    async () => {
      const r = await executar(yaml, "backup_misto");
      assertEquals(r.codigo, 0, r.saida);
      assertStringIncludes(r.saida, "backup_estado=COMPLETED");
      assert(!r.saida.includes("971230"), r.saida);
    },
  );

  await t.step(
    "403, respostas inválidas e estado incompleto reprovam",
    async () => {
      for (const modo of [
        "sql_403",
        "sql_json_invalido",
        "sql_incompleto",
        "sql_campo_extra",
        "ledger_falta",
        "rpc_parcial",
        "prereq_falta",
        "backup_403",
        "backup_json_invalido",
        "backup_malformado",
        "backup_data_invalida",
        "backup_vazio",
        "backup_falhou",
      ]) {
        const r = await executar(yaml, modo);
        assertEquals(r.codigo, 1, `${modo}: ${r.saida}`);
        assert(!r.saida.includes(MARCADOR_PRIVADO), r.saida);
        assert(!r.saida.includes("971231"), r.saida);
        assert(!r.saida.includes("token-de-teste"), r.saida);
      }
    },
  );

  await t.step("Savy é recusada antes de qualquer chamada", async () => {
    const r = await executar(yaml, "ok", "savy");
    assertEquals(r.codigo, 1, r.saida);
    assert(!r.saida.includes("CHAMADA="), r.saida);
  });
});
