-- O CPF MORA NA CONTA (CPF opcional no perfil + prefill/persistência no
-- checkout, 23/09/2026 — segue a 20261172000000, que já ensinou o CPF a
-- viajar dentro de `orders.customer_data.cpf`).
--
-- O DEFEITO QUE ESTA MIGRATION FECHA: até aqui, o CPF do destinatário só
-- existe DENTRO de um pedido (`customer_data.cpf`, migration 20261172) —
-- quem compra de novo redigita o CPF em todo checkout de transportadora, e
-- não existe lugar nenhum na CONTA onde a pessoa possa cadastrar ou
-- consultar o próprio CPF. `public.profiles.cpf text` já existe no schema
-- (coluna aditiva de uma migration anterior a este pacote, verificada viva
-- nos dois bancos — IKCOUS e SAVY — antes de escrever este arquivo), mas
-- nenhuma RPC lê nem grava nela: o front não tem como alcançá-la sem dar
-- SELECT/UPDATE direto na tabela `profiles`, o que a RLS de hoje até
-- permite para o dono da própria linha (`profiles_select_policy` /
-- `profiles_update_policy`, `auth.uid() = id OR is_admin()`) mas expõe a
-- coluna a qualquer client-side que monte a query errada, sem nenhuma
-- validação de formato nem dígito verificador no caminho.
--
-- O QUE ESTA MIGRATION FAZ, NA ORDEM:
--   1. `public.get_my_cpf()` — SECURITY DEFINER, `SET search_path = public`.
--      Sem sessão (`auth.uid()` NULL): devolve NULL, nunca lança. Com
--      sessão: devolve `profiles.cpf` da PRÓPRIA linha (`id = auth.uid()`),
--      sempre em dígitos crus (é assim que a coluna já é gravada — nenhuma
--      máscara entra no banco). GRANT só para `authenticated`.
--   2. `public.set_my_cpf(p_cpf text)` — SECURITY DEFINER, mesmo
--      `search_path`. Sem sessão: `RAISE EXCEPTION` (não há linha de quem
--      gravar). Com sessão: normaliza `p_cpf` para só dígitos
--      (`regexp_replace(..., '\D', '', 'g')`); entrada vazia ou só
--      separadores LIMPA a coluna (`cpf = NULL`) — é o caminho de "remover
--      o CPF cadastrado", pedido explícito do dono ("permitir limpar").
--      Entrada não vazia exige EXATAMENTE 11 dígitos, rejeita as onze
--      sequências de dígito repetido (`00000000000` … `99999999999` — passam
--      na conta dos verificadores mas nunca são CPF real) e confere os DOIS
--      dígitos verificadores pelo algoritmo oficial da Receita Federal (o
--      MESMO algoritmo que `src/lib/cpf.ts#cpfValido` já usa no front — a
--      validação do servidor não pode ser mais fraca que a da tela).
--      Qualquer recusa lança com mensagem FIXA, sem o valor recebido em
--      lugar nenhum do texto nem do `DETAIL` — CPF nunca aparece em log nem
--      em mensagem de erro (regra da casa para este dado). Válido: grava
--      `profiles.cpf` e `profiles.updated_at = now()` na própria linha.
--      AJUSTE DE SEGURANÇA (23/09/2026, pedido do dono): as famílias de
--      recusa carregam `ERRCODE` CUSTOMIZADO — `CPF02` para "sem sessão",
--      `CPF01` para "CPF inválido" (as QUATRO verificações: 11 dígitos,
--      sequência repetida, 1º e 2º dígito verificador) e `CPF03` para "os
--      dois `UPDATE` (limpar e gravar) não acharam a linha em `profiles`"
--      — para o front distinguir o motivo só por `error.code`, NUNCA pelo
--      texto da mensagem: mensagem de erro do Postgres pode mudar sem
--      aviso e, em erro de CONVERSÃO (não é o caso aqui, mas é o risco
--      geral), costuma ecoar o valor recebido. `src/lib/cpf-da-conta.ts`
--      mapeia esses códigos e trata qualquer outro (rede, código
--      desconhecido) como falha genérica — nunca repassa `error.message`.
--      CORREÇÃO DO DONO (mesma data): sem `CPF03`, um `UPDATE` que não
--      afeta nenhuma linha (`profiles` sem registro para `auth.uid()`)
--      terminava em SUCESSO por padrão do Postgres — o front declarava o
--      CPF salvo (ou removia o pendente do cadastro) com o dado, na
--      verdade, PERDIDO. `IF NOT FOUND` depois de cada `UPDATE` fecha
--      esse caminho.
--   3. `REVOKE ALL ... FROM PUBLIC, anon` + `GRANT EXECUTE ... TO
--      authenticated` nas duas funções — convidado (`anon`) nunca lê nem
--      grava CPF de ninguém; só quem está logado, e só a PRÓPRIA linha (não
--      há parâmetro de usuário-alvo em nenhuma das duas).
--
-- DADOS EXISTENTES: nenhuma linha de `profiles` é lida nem reescrita por
-- esta migration — ela só CRIA as duas funções. `profiles.cpf` continua
-- exatamente como está para toda conta (a esmagadora maioria, NULL) até a
-- própria pessoa preencher no app (perfil ou checkout, fora desta
-- migration).
--
-- IDEMPOTÊNCIA: as duas funções nascem com `CREATE OR REPLACE FUNCTION` —
-- reaplicar este arquivo duas vezes recria os MESMOS corpos e refaz os
-- MESMOS `REVOKE`/`GRANT`, sem erro e sem efeito adicional. Não há `DROP`
-- em objeto nenhum, nem alteração de assinatura de RPC existente.
--
-- FORA DO ESCOPO: alterar `get_my_complete_profile` ou
-- `update_my_profile_secure` para incluir CPF (mantidas com a assinatura de
-- hoje, sem cpf, por pedido explícito); qualquer mudança em
-- `sync_public_profile` (o CPF continua NUNCA indo para `public_profiles` —
-- é dado privado, nunca público); semear CPF em conta nenhuma; aplicar de
-- verdade (passo separado, com revisão, em cada banco).
--
-- COMO APLICAR: `node scripts/db-apply.cjs 20261173000000_o_cpf_mora_na_conta.sql`
-- (ou `psql -1 -f`) — SEM `BEGIN`/`COMMIT` de nível superior neste arquivo
-- (regra da casa: quem abre a transação é o script de aplicação).
--
-- FICHA DE VERIFICAÇÃO (rodar à mão contra o banco depois de aplicar):
--   1. `select proname, prosecdef, proconfig from pg_proc where proname in
--       ('get_my_cpf','set_my_cpf');` — as duas com `prosecdef = true` e
--       `proconfig` contendo `search_path=public`.
--   2. `select has_function_privilege('anon', 'public.get_my_cpf()',
--       'execute');` e o mesmo para `set_my_cpf(text)` — os dois `false`.
--   3. `select has_function_privilege('authenticated',
--       'public.get_my_cpf()', 'execute');` e o mesmo para `set_my_cpf(text)`
--       — os dois `true`.
--   4. Como um usuário autenticado (client anon key + sessão): `select
--       set_my_cpf('529.982.247-25')` (CPF de teste, dígitos válidos), depois
--       `select get_my_cpf()` devolvendo `'52998224725'`; `select
--       set_my_cpf('')` limpando de volta para `NULL`; `select
--       set_my_cpf('11111111111')` lançando (sequência repetida); `select
--       set_my_cpf('12345678900')` lançando (dígito verificador inválido).
--   5. `psql`: `select set_my_cpf('11111111111');` → `\errverbose` (ou
--       `SQLSTATE`, conforme o client) mostrando `CPF01`. Sem sessão (client
--       anon, sem login): a chamada nem entra na função (REVOKE do item 2
--       já barra) — o erro ali é o `42501` padrão do Postgres
--       (insufficient_privilege), não `CPF02`; `CPF02` só aparece no caso
--       raro de um JWT `authenticated` sem `auth.uid()` resolvível.
--
-- ROLLBACK: rollback-manual-20261173000000_o_cpf_mora_na_conta.sql — derruba
-- as duas funções com `DROP FUNCTION IF EXISTS`, na ordem inversa da
-- criação. Nenhum dado é apagado: `profiles.cpf` que já tiver sido
-- preenchido pelas RPCs continua na coluna depois do rollback — só o
-- CAMINHO de leitura/escrita por RPC deixa de existir.

CREATE OR REPLACE FUNCTION public.get_my_cpf()
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
DECLARE
    v_cpf text;
BEGIN
    IF auth.uid() IS NULL THEN
        RETURN NULL;
    END IF;

    SELECT cpf INTO v_cpf FROM public.profiles WHERE id = auth.uid();
    RETURN v_cpf;
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_my_cpf(p_cpf text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
DECLARE
    v_user_id uuid := auth.uid();
    v_digitos text;
    v_soma integer;
    v_peso integer;
    v_d1 integer;
    v_d2 integer;
BEGIN
    -- ERRCODE customizado (nunca um padrão do Postgres já usado por outra
    -- coisa) para o front distinguir SEM SESSÃO de CPF INVÁLIDO só pelo
    -- `error.code` — nunca pelo texto da mensagem, que pode mudar sem
    -- aviso e, em erro de conversão do Postgres, pode ecoar o VALOR
    -- recebido (ex.: "invalid input syntax for type ...: <valor>").
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Sem sessão: entre na conta para gravar o CPF.'
            USING ERRCODE = 'CPF02';
    END IF;

    -- Normaliza para só dígitos. Entrada vazia (ou só separadores) LIMPA o
    -- CPF cadastrado — o caminho de "remover" do perfil.
    v_digitos := NULLIF(regexp_replace(COALESCE(p_cpf, ''), '\D', '', 'g'), '');

    IF v_digitos IS NULL THEN
        UPDATE public.profiles
           SET cpf = NULL, updated_at = now()
         WHERE id = v_user_id;
        -- CORREÇÃO DO DONO (23/09/2026): `UPDATE` que não acha a linha
        -- termina em SUCESSO por padrão no Postgres (zero linhas afetadas
        -- não é erro) — sem esta guarda, gravar/limpar o CPF de uma conta
        -- sem linha em `profiles` (ainda não deveria existir, mas o
        -- CONTRATO da função não pode depender disso) devolvia "ok" para
        -- o front, que então declarava salvo (ou removia o pendente do
        -- cadastro) com o CPF na verdade PERDIDO. ERRCODE próprio
        -- (`CPF03`), nunca a mensagem — mesma régua dos dois de cima.
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Perfil não encontrado para gravar o CPF.'
                USING ERRCODE = 'CPF03';
        END IF;
        RETURN;
    END IF;

    -- O NÚMERO NUNCA ENTRA NA MENSAGEM: nem aqui, nem em nenhum RAISE
    -- abaixo — regra da casa para este dado (nunca em log, console, erro).
    IF length(v_digitos) <> 11 THEN
        RAISE EXCEPTION 'CPF inválido: informe os 11 dígitos.'
            USING ERRCODE = 'CPF01';
    END IF;

    -- Sequência de dígito repetido (00000000000 … 99999999999): passa na
    -- conta dos dois verificadores abaixo mas nunca é CPF real — mesma
    -- guarda de `src/lib/cpf.ts#cpfValido` no front.
    IF v_digitos IN (
        '00000000000', '11111111111', '22222222222', '33333333333',
        '44444444444', '55555555555', '66666666666', '77777777777',
        '88888888888', '99999999999'
    ) THEN
        RAISE EXCEPTION 'CPF inválido.'
            USING ERRCODE = 'CPF01';
    END IF;

    -- 1º dígito verificador (algoritmo oficial da Receita Federal): soma
    -- ponderada dos 9 primeiros dígitos com pesos 10..2, resto módulo 11
    -- traduzido (resto 10 vira 0).
    v_soma := 0;
    v_peso := 10;
    FOR i IN 1..9 LOOP
        v_soma := v_soma + (substr(v_digitos, i, 1)::integer * v_peso);
        v_peso := v_peso - 1;
    END LOOP;
    v_d1 := (v_soma * 10) % 11;
    IF v_d1 = 10 THEN
        v_d1 := 0;
    END IF;
    IF v_d1 <> substr(v_digitos, 10, 1)::integer THEN
        RAISE EXCEPTION 'CPF inválido.'
            USING ERRCODE = 'CPF01';
    END IF;

    -- 2º dígito verificador: mesma conta sobre os 10 primeiros dígitos
    -- (incluindo o d1 recém-conferido), pesos 11..2.
    v_soma := 0;
    v_peso := 11;
    FOR i IN 1..10 LOOP
        v_soma := v_soma + (substr(v_digitos, i, 1)::integer * v_peso);
        v_peso := v_peso - 1;
    END LOOP;
    v_d2 := (v_soma * 10) % 11;
    IF v_d2 = 10 THEN
        v_d2 := 0;
    END IF;
    IF v_d2 <> substr(v_digitos, 11, 1)::integer THEN
        RAISE EXCEPTION 'CPF inválido.'
            USING ERRCODE = 'CPF01';
    END IF;

    UPDATE public.profiles
       SET cpf = v_digitos, updated_at = now()
     WHERE id = v_user_id;
    -- Mesma guarda do UPDATE de limpar, acima: `IF NOT FOUND` — sem ela,
    -- gravar um CPF válido numa conta sem linha em `profiles` devolvia
    -- sucesso e o CPF se perdia (o caso que mais dói: cadastro com sessão
    -- imediata, `gravarCpfDaConta` chamado antes de qualquer outra
    -- gravação ter criado a linha do perfil).
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Perfil não encontrado para gravar o CPF.'
            USING ERRCODE = 'CPF03';
    END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_my_cpf() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_cpf() TO authenticated;

REVOKE ALL ON FUNCTION public.set_my_cpf(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_my_cpf(text) TO authenticated;
