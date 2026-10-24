# Definir o dono da loja

Roteiro para cadastrar, conferir e trocar o **dono da loja** no banco de **cada** loja.
Vale para o dono do produto (parte 1, sem jargão) e para quem aplica (parte 2 em diante).

Sem esse cadastro, a opção **Tornar administrador** do painel não funciona: o dono da loja
é quem tem o poder de dar e tirar o cargo de administrador, e o banco só reconhece o dono
depois de alguém cadastrá-lo, **uma vez por loja**.

## 1. Para o dono do produto (sem jargão)

**O que é o "dono da loja".** É a **uma** pessoa, por loja, que o banco de dados reconhece
como a única autorizada a nomear e a remover administradores. Ser administrador não basta:
o administrador entra no painel e cuida de pedidos, produtos e clientes, mas **não** nomeia
outro administrador. Só o dono nomeia.

**Por que só ele.** Antes dessa regra existia uma brecha: qualquer administrador podia,
por baixo dos panos, nomear outros administradores ou até rebaixar o dono. A decisão já
tomada é que só o dono mexe em cargo, e que **ninguém** (nem ele mesmo) tira o cargo do dono
pelo app.

**O que precisa ser decidido por você, e só por você:** quem é o dono de **cada** loja.
É uma pessoa que já tem conta na loja e já é administradora. O programador não escolhe e
não presume: ele pergunta e cadastra a pessoa que você disser. A escolha é por loja (a
mesma pessoa pode ser dona de mais de uma, ou não).

**O que acontece enquanto não houver dono cadastrado.** Nada quebra, mas nada se move:

- a opção **Tornar administrador** não aparece no painel;
- se alguém tentar chamar a função de cargo por fora do painel, o banco recusa
  (erro `42501`, "só o dono da loja define cargos");
- quem já é administrador **continua administrador**; só ninguém consegue nomear nem remover.

**Como você sabe que ficou pronto.** O programador roda uma conferência (a consulta 89,
abaixo) e mostra que **todas** as linhas dela dizem "sim" para aquela loja.

## 2. Ordem das migrations (confirmada nos arquivos)

A migration do dono é a `20261383000000_so_o_dono_da_loja_define_cargo.sql`. O cabeçalho
dela diz "depois da 20261197, 20261199 e 20261340" e o pré-voo dela **recusa** (e não
grava nada) se as peças da 197 e da 199 não estiverem no estado esperado.

| Ordem | Migration | O que entrega | Exigida pela 1383? |
|---|---|---|---|
| 1 | `20261197000000_dinheiro_exige_admin_atual` | cria `is_admin_atual()` e `rls_admin_atual()`, que leem o cargo de agora nas duas fontes | Sim, o pré-voo confere os corpos (md5) |
| 2 | `20261199000000_portas_do_painel_exigem_admin_atual` | os três gatilhos de papel de `profiles` (`ensure_role_protection`, `prevent_role_change`, sincronia com `auth.users`) | Sim, o pré-voo confere corpos, definição e estado ligado |
| 3 | `20261340000000_as_politicas_de_perfil_e_endereco_exigem_o_admin_atual` | as políticas de `profiles` passam a exigir o admin de agora | Sim, pelo cabeçalho (o pré-voo não a confere sozinho) |
| 4 | `20261360000000_ex_admin_perde_o_acesso_na_hora_nas_demais_tabelas` | quem perde o cargo perde o acesso na hora nas demais tabelas | Não: é a ordem do plano (ver abaixo) |
| 5 | `20261381000000_ex_admin_perde_o_acesso_na_hora_no_resto_do_painel` | idem, no resto do painel | Não: é a ordem do plano |
| 6 | `20261383000000_so_o_dono_da_loja_define_cargo` | `dono_da_loja`, `cargo_log`, `definir_cargo()` e o gatilho `tr_papel_so_pelo_definir_cargo` | (esta) |

**Por que a 360 e a 381 vêm antes, mesmo a 1383 não exigindo.** Quando o dono passa a poder
tirar um cargo, o ex-administrador precisa perder o acesso **na hora**, e não em até uma hora
(o tempo de vida do login antigo). Essas duas migrations é que garantem isso. Abrir
"Tornar administrador" antes delas daria à loja um botão de rebaixar que não fecha a porta.

Se o aplicador parar com `B1_BASELINE_DIVERGENT`, o pré-voo achou uma peça diferente do
esperado e **nada foi gravado** (a transação é do aplicador). Não force: leia a mensagem,
ela diz qual objeto divergiu.

## 3. Roteiro, loja por loja

Repita este bloco **inteiro** para cada loja (ver seção 5). Uma loja de cada vez.

### 3.1 Antes do apply (a loja ainda não tem a 1383)

1. **Consulta 88b** (`88b-antes-so-o-dono-define-cargo-ausente`): todas as linhas `ok = true`.
   Prova que os objetos da 1383 ainda **não** existem e que as portas da 197 e os gatilhos
   da 199 estão como a 1383 supõe.
2. **Consulta 8b** (`8b-papeis-contraditorios`): devolve só contagens, nenhuma pessoa.
   Lê-se assim:
   - "admins pelas duas fontes" maior que zero (senão a loja nem tem administrador de verdade);
   - "admin só no app_metadata" e "admin só no profiles" idealmente zero. Se não for zero,
     o dono do produto decide qual das duas fontes está certa para cada caso, **antes**
     de aplicar. O **futuro dono** não pode ser um desses casos (a 89 prova isso depois).
3. Aplicar a 1383 pelo fluxo normal de migrations da loja (workflow `Aplicar migrations`,
   alvo da loja; as lojas `ikcous-publicada` e `savy` exigem o SHA completo do commit).
   A migration é **aditiva** (tabelas novas vazias, duas funções e um gatilho) e não muda
   nenhuma linha existente. Reaplicar deixa o mesmo estado (idempotente), mas o aplicador só
   deixa reaplicar com `permitir_reaplicar=true`, por causa do registro de migrations já aplicadas.

### 3.2 Logo depois do apply, antes de cadastrar o dono

4. **Consulta 88a** (`88a-conferir-so-o-dono-define-cargo-aplicado`): 9 linhas, todas `ok`.
   Prova que os **objetos** existem com o corpo certo. Ela **não** prova que há dono.
5. **Consulta 89** (`89-dono-cadastrado`): neste momento as linhas do dono dizem **"nao"**.
   Isso é o esperado (tabela vazia). As três linhas de controle e as duas primeiras
   (tabela e função existem) devem estar `sim`.

### 3.3 Cadastrar o dono (uma vez por loja)

Quem faz: o programador, no **SQL Editor** do projeto Supabase daquela loja (ele roda como
`postgres`, que é quem escreve nessa tabela; nenhum papel de aplicação escreve nela).
Quem decide **quem** é o dono: o dono do produto.

> O e-mail é digitado só no editor, na hora. Não vai para o repositório, para chat, para
> log nem para este arquivo. Abaixo, `<e-mail-do-dono>` é um espaço em branco a preencher.

6. **Conferir a pessoa nas duas fontes** (devolve só contagens). O esperado é `1 | 1 | 1`:

   ```sql
   SELECT count(*) AS contas_com_esse_email,
          count(*) FILTER (WHERE (u.raw_app_meta_data ->> 'role') = 'admin') AS admin_em_auth_users,
          count(*) FILTER (WHERE p.role = 'admin') AS admin_em_profiles
     FROM auth.users u
     LEFT JOIN public.profiles p ON p.id = u.id
    WHERE lower(u.email) = lower('<e-mail-do-dono>');
   ```

   Se qualquer número for diferente de 1, **pare**: a pessoa não existe, ou não é admin
   nas duas fontes, e a função `definir_cargo` recusaria o dono. Corrigir o cargo dela é
   decisão do dono do produto, não do programador.

7. **Cadastrar.** O comando abaixo só insere se a pessoa for admin nas duas fontes, então
   um e-mail errado resulta em `INSERT 0 0` em vez de um dono inválido. O esperado é
   `INSERT 0 1`:

   ```sql
   INSERT INTO public.dono_da_loja (user_id)
   SELECT u.id
     FROM auth.users u
     JOIN public.profiles p ON p.id = u.id
    WHERE lower(u.email) = lower('<e-mail-do-dono>')
      AND (u.raw_app_meta_data ->> 'role') = 'admin'
      AND p.role = 'admin';
   ```

   É o mesmo cadastro do cabeçalho da migration
   (`INSERT INTO public.dono_da_loja (user_id) VALUES ('<uuid>')`), com a conferência
   embutida. Se já existir um dono, o banco recusa (`dono_da_loja_pkey`): a tabela só
   aceita **uma** linha por banco. Para trocar, veja a seção 4.

8. **Provar com a consulta 89.** Esperado: **as 9 linhas `sim`** (`ok = true`).
   Só então a loja está pronta para a opção **Tornar administrador**.

### 3.4 Lendo a consulta 89

A 89 só lê e só devolve `sim`/`nao`. Nenhum identificador de pessoa sai nela.

| Linha | Se vier "nao" |
|---|---|
| controle: catálogo público visível | A conexão não enxerga o schema `public`. Nenhuma outra linha vale. |
| controle: o papel que leu enxerga usuários e perfis | O papel que leu não vê `auth.users` ou `profiles`. As linhas do dono dizem "nao" por falta de visão, não por falta de dono. |
| controle: o papel que leu pula a RLS | Idem: com a RLS valendo, a tabela do dono pode parecer vazia. Rode com um papel que enxergue tudo. |
| a tabela `dono_da_loja` existe | A 1383 não foi aplicada nesta loja. |
| a função `definir_cargo(uuid, text)` existe | A 1383 não foi aplicada (ou foi desfeita). |
| exatamente uma linha | Nenhum dono cadastrado (ou, fora do desenho, mais de um). |
| o dono existe em `auth.users` | O `user_id` guardado não bate com nenhuma conta. |
| o dono é admin em `profiles.role` | O cargo dele no perfil não é `admin`. A função recusa tudo (42501). |
| o dono é admin em `auth.users` (role) | O cargo dele no login não é `admin`. A função recusa tudo (42501). |

Rode a 89 de novo **sempre que** o dono for trocado, o cargo dele for mexido (inclusive
direto no painel do Supabase) ou antes de liberar uma release que mexa na tela de cargos.
Hoje ela é conferência manual do programador: não é portão automático do `publicar-release`.

## 4. Trocar o dono (raro; decisão do dono do produto)

Mesma conferência do passo 6 para o **novo** e-mail, e depois, tudo de uma vez, nesta ordem
(`DELETE` e `INSERT` na mesma transação; o aviso do editor sobre "operação destrutiva" é
esperado, porque é um `DELETE` sem `WHERE`, na tabela de uma linha só):

```sql
BEGIN;
DELETE FROM public.dono_da_loja;
INSERT INTO public.dono_da_loja (user_id)
SELECT u.id
  FROM auth.users u
  JOIN public.profiles p ON p.id = u.id
 WHERE lower(u.email) = lower('<e-mail-do-novo-dono>')
   AND (u.raw_app_meta_data ->> 'role') = 'admin'
   AND p.role = 'admin';
DO $$ BEGIN
  IF (SELECT count(*) FROM public.dono_da_loja) <> 1 THEN
    RAISE EXCEPTION 'o novo dono nao foi cadastrado: nada foi trocado';
  END IF;
END $$;
COMMIT;
```

Se o novo e-mail não for admin nas duas fontes, a verificação final dá erro e a transação
desfaz também o `DELETE`: o dono antigo continua. Em seguida, rodar a consulta 89.

Cuidados que valem na troca e no dia a dia:

- **A conta do dono não pode ser apagada** enquanto ele for o dono (chave estrangeira com
  `ON DELETE RESTRICT`). Para apagar a conta, troque o dono antes.
- **O cargo do dono não muda pelo app**, nem por ele mesmo (`definir_cargo` recusa). Por isso
  a troca é feita no banco, como acima.
- O registro de quem mudou o cargo de quem fica em `cargo_log` (só o dono e o admin atual leem).

## 5. Quais lojas

Cada loja tem o **seu** banco, e por isso o seu dono. Confirmado em `AGENTS.md`,
`scripts/frota/canais-de-backend.json` e `scripts/frota/politica.json`:

| Loja | Alvo dos workflows de banco | Observação |
|---|---|---|
| IKCOUS (a "CAF", loja de desenvolvimento) | `ikcous-publicada` (é o mesmo banco do alvo `loja`) | exige o SHA completo do commit |
| Savy (loja cliente) | `savy` | exige o SHA completo do commit |
| Sandbox | `sandbox` | só ensaio, sem cliente; cadastre um dono de teste se for provar a tela |
| Loja nova | a que o cadastro da frota (`frota_lojas`) registrar | entra neste roteiro assim que tiver banco; o inventário vem do cadastro, não deste arquivo |

As lojas Almeida, Brand Meliz e Space foram descontinuadas pelo dono em 16/10/2026 e não
entram na atualização.

**Quem é o dono de cada uma é decisão do dono do produto**, nunca do agente. Registrar a
resposta dele junto com a loja, sem e-mail nem identificador neste repositório.

## 6. O que este roteiro não faz

- Não aplica nada sozinho e não guarda e-mail, identificador ou credencial de ninguém.
- Não decide quem é o dono nem corrige cargo de ninguém.
- A consulta 89 prova o **cadastro** e o cargo **de agora**. A prova de que `definir_cargo`
  funciona de ponta a ponta (dono nomeia, nomeado não nomeia, ninguém rebaixa o dono) está
  em `tests/banco/definir-cargo-so-o-dono-viva.cjs`, no Postgres efêmero do CI, e não toca
  nenhuma loja.

Referências: cabeçalho de
[`20261383000000_so_o_dono_da_loja_define_cargo.sql`](../../supabase/migrations/20261383000000_so_o_dono_da_loja_define_cargo.sql),
seção "Domínio do negócio — entidades, dinheiro e papéis" do [`AGENTS.md`](../../AGENTS.md), consultas em
[`scripts/publicacao/consultas/`](../../scripts/publicacao/consultas/) (`8b`, `88a`, `88b`, `89-dono-cadastrado`).
