// Preflight fixo da IKCOUS: somente leitura, sem SQL livre nem dados de clientes.
// A listagem de backups prova existência/metadados; não prova restauração.
const REF = "dekxabvqdsuukijblazl";
const BASE = `https://api.supabase.com/v1/projects/${REF}/database/`;
const VERSOES = Array.from({ length: 12 }, (_, i) => 74 + i);
const PRE_REQUISITOS = [
  "pedido_canal",
  "pedido_metodo_online",
  "forma_online",
  "devolver_estoque",
  "expirar_pedidos",
  "devolucoes",
  "historico_pagamento",
  "registrar_venda_auth",
  "confirmar_pagamento",
  "is_admin",
];
const OBJETOS_PIX = [
  "rpc_pix_presente",
  "rpc_pix_auth",
  "rpc_pix_anon",
  "rpc_pix_definer_path",
  "gatilho_entrega_84",
  "gatilho_status_84",
  "rpc_anular_presente",
  "rpc_anular_auth",
  "rpc_anular_anon",
  "rpc_anular_definer_path",
];
const LEDGER = VERSOES.map((n) => `ledger_${n}`);
const CAMPOS = [...LEDGER, ...PRE_REQUISITOS, ...OBJETOS_PIX];

function recusar(motivo) {
  console.error(`::error::preflight PIX: ${motivo}`);
  process.exit(1);
}

function dataIsoValida(valor) {
  if (typeof valor !== "string") return false;
  const campos =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(?:Z|([+-])(\d{2}):(\d{2}))$/.exec(
      valor,
    );
  if (!campos) return false;
  const [, ano, mes, dia, hora, minuto, segundo, , fusoHora, fusoMinuto] =
    campos;
  const ultimoDia = new Date(
    Date.UTC(Number(ano), Number(mes), 0),
  ).getUTCDate();
  return (
    Number(mes) >= 1 &&
    Number(mes) <= 12 &&
    Number(dia) >= 1 &&
    Number(dia) <= ultimoDia &&
    Number(hora) <= 23 &&
    Number(minuto) <= 59 &&
    Number(segundo) <= 59 &&
    (fusoHora === undefined ||
      (Number(fusoHora) <= 23 && Number(fusoMinuto) <= 59)) &&
    Number.isFinite(Date.parse(valor))
  );
}

function rpc(campo, assinatura, expressao) {
  return `COALESCE((SELECT ${expressao} FROM pg_catalog.pg_proc p WHERE p.oid = to_regprocedure('${assinatura}')), false) AS ${campo}`;
}

const assinaturaPix =
  "public.iniciar_venda_presencial_pix(jsonb, uuid, uuid, text, text, numeric, text)";
const assinaturaAnular = "public.anular_venda_presencial(uuid, text)";
const expressoes = [
  ...VERSOES.map(
    (n) =>
      `EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '202611${n}000000') AS ledger_${n}`,
  ),
  "EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'marketplace_orders' AND column_name = 'canal') AS pedido_canal",
  "EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'marketplace_orders' AND column_name = 'metodo_online') AS pedido_metodo_online",
  "to_regprocedure('public.forma_de_pagamento_aceita(text)') IS NOT NULL AS forma_online",
  "to_regprocedure('public.devolver_estoque(uuid)') IS NOT NULL AS devolver_estoque",
  "to_regprocedure('public.expirar_pedidos_vencidos()') IS NOT NULL AS expirar_pedidos",
  "to_regclass('public.devolucoes') IS NOT NULL AS devolucoes",
  "to_regclass('public.marketplace_order_payment_history') IS NOT NULL AS historico_pagamento",
  rpc(
    "registrar_venda_auth",
    "public.registrar_venda_presencial(jsonb, text, uuid, text, text, numeric, text, uuid)",
    "has_function_privilege('authenticated', p.oid, 'EXECUTE')",
  ),
  "to_regprocedure('public.confirmar_pagamento(uuid, text, text)') IS NOT NULL AS confirmar_pagamento",
  "to_regprocedure('public.is_admin()') IS NOT NULL AS is_admin",
  `to_regprocedure('${assinaturaPix}') IS NOT NULL AS rpc_pix_presente`,
  rpc(
    "rpc_pix_auth",
    assinaturaPix,
    "has_function_privilege('authenticated', p.oid, 'EXECUTE')",
  ),
  rpc(
    "rpc_pix_anon",
    assinaturaPix,
    "has_function_privilege('anon', p.oid, 'EXECUTE')",
  ),
  rpc(
    "rpc_pix_definer_path",
    assinaturaPix,
    "p.prosecdef AND 'search_path=pg_catalog, pg_temp' = ANY(p.proconfig)",
  ),
  "EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t WHERE t.tgrelid = to_regclass('public.marketplace_orders') AND t.tgname = 'tr_venda_do_balcao_paga_e_entregue' AND t.tgenabled = 'O' AND t.tgfoid = to_regprocedure('public.venda_do_balcao_paga_e_entregue()') AND NOT t.tgisinternal) AS gatilho_entrega_84",
  "EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t WHERE t.tgrelid = to_regclass('public.marketplace_orders') AND t.tgname = 'tr_venda_do_balcao_guarda_o_status' AND t.tgenabled = 'O' AND t.tgfoid = to_regprocedure('public.venda_do_balcao_guarda_o_status()') AND NOT t.tgisinternal) AS gatilho_status_84",
  `to_regprocedure('${assinaturaAnular}') IS NOT NULL AS rpc_anular_presente`,
  rpc(
    "rpc_anular_auth",
    assinaturaAnular,
    "has_function_privilege('authenticated', p.oid, 'EXECUTE')",
  ),
  rpc(
    "rpc_anular_anon",
    assinaturaAnular,
    "has_function_privilege('anon', p.oid, 'EXECUTE')",
  ),
  rpc(
    "rpc_anular_definer_path",
    assinaturaAnular,
    "p.prosecdef AND 'search_path=pg_catalog, pg_temp' = ANY(p.proconfig)",
  ),
];
const QUERY = `SELECT\n  ${expressoes.join(",\n  ")}`;

async function consultar(url, options, operacao) {
  let resposta;
  try {
    resposta = await fetch(url, options);
  } catch {
    recusar(`${operacao} indisponível (rede)`);
  }
  if (!resposta.ok) recusar(`${operacao} HTTP ${resposta.status}`);
  try {
    return await resposta.json();
  } catch {
    recusar(`${operacao} retornou JSON inválido`);
  }
}

async function executar() {
  if (process.env.PROJETO !== "loja") recusar("destino deve ser loja");
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token || !token.trim()) recusar("token ausente");
  const headers = { Authorization: `Bearer ${token.trim()}` };
  const linhas = await consultar(
    `${BASE}query/read-only`,
    {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ query: QUERY }),
    },
    "SQL somente leitura",
  );
  if (
    !Array.isArray(linhas) ||
    linhas.length !== 1 ||
    !linhas[0] ||
    typeof linhas[0] !== "object"
  )
    recusar("resposta SQL fora do contrato");
  const estado = new Map(Object.entries(linhas[0]));
  if (
    estado.size !== CAMPOS.length ||
    CAMPOS.some((campo) => typeof estado.get(campo) !== "boolean")
  )
    recusar("resposta SQL fora do contrato");
  for (const campo of CAMPOS) console.log(`${campo}=${estado.get(campo)}`);

  const resultado = await consultar(
    `${BASE}backups`,
    { method: "GET", headers },
    "backups",
  );
  if (
    !resultado ||
    !Array.isArray(resultado.backups) ||
    resultado.backups.length === 0
  ) {
    recusar("lista de backups ausente ou vazia");
  }
  const backups = resultado.backups.map((backup) => {
    if (
      !backup ||
      ![
        "COMPLETED",
        "FAILED",
        "IN_PROGRESS",
        "PENDING",
        "ARCHIVED",
        "CANCELLED",
        "REMOVED",
      ].includes(backup.status) ||
      !dataIsoValida(backup.inserted_at)
    )
      recusar("resposta de backups fora do contrato");
    return { estado: backup.status, data: new Date(backup.inserted_at) };
  });
  backups.sort((a, b) => b.data - a.data);
  const ultimo = backups[0];
  console.log("backup_presente=true");
  console.log(`backup_estado=${ultimo.estado}`);
  console.log(`backup_data=${ultimo.data.toISOString()}`);
  console.log("backup_listado_nao_prova_restauracao=true");

  const anteriores = VERSOES.filter((n) => n <= 83).every((n) =>
    estado.get(`ledger_${n}`),
  );
  const novasAusentes = !estado.get("ledger_84") && !estado.get("ledger_85");
  const dependencias = PRE_REQUISITOS.every((campo) => estado.get(campo));
  const semInstalacaoParcial = OBJETOS_PIX.every((campo) => !estado.get(campo));
  if (
    !anteriores ||
    !novasAusentes ||
    !dependencias ||
    !semInstalacaoParcial ||
    ultimo.estado !== "COMPLETED"
  )
    recusar("pré-condições não atendidas; examine os booleanos acima");
  console.log("preflight_pix=pronto_para_revisao_humana");
}

executar().catch(() => recusar("falha inesperada sem detalhes de resposta"));
