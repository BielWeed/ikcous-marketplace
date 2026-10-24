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
não presume, e **nem fica sabendo o e-mail**: quem cadastra é você, por uma receita de telas
(seção 3.3). A escolha é por loja (a
mesma pessoa pode ser dona de mais de uma, ou não).

**O que acontece enquanto não houver dono cadastrado.** Nada quebra, mas nada se move:

- a opção **Tornar administrador** não aparece no painel;
- se alguém tentar chamar a função de cargo por fora do painel, o banco recusa
  (erro `42501`, "só o dono da loja define cargos");
- quem já é administrador **continua administrador**; só ninguém consegue nomear nem remover.

**Como você sabe que ficou pronto.** O programador roda uma conferência (a consulta 88c,
abaixo) e mostra que **todas** as linhas dela dizem "sim" para aquela loja. Depois, quem
estava com o painel aberto precisa **recarregar a página (F5)** ou fechar a aba (ou o aplicativo)
e abrir de novo; sair da tela do painel e voltar dentro do aplicativo não basta. Senão a opção
**Tornar administrador** só aparece na abertura seguinte.

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
     de aplicar. O **futuro dono** não pode ser um desses casos (a 88c prova isso depois).
3. **Antes de aplicar, o SQL da 1383 precisa de revisão Opus.** O cabeçalho da migration (linhas
   2 a 5) diz que ela é rascunho para essa revisão e que, mesmo aditiva, **muda permissão**
   (o gatilho novo recusa o que antes passava). Sem a aprovação da revisão sobre o SQL que vai
   ser aplicado, não aplique. Depois: aplicar pelo fluxo normal de migrations da loja (workflow
   `Aplicar migrations`, alvo da loja; as lojas `ikcous-publicada` e `savy` exigem o SHA
   completo do commit).
   A migration é **aditiva** (tabelas novas vazias, duas funções e um gatilho) e não muda
   nenhuma linha existente. Reaplicar deixa o mesmo estado (idempotente), mas o aplicador só
   deixa reaplicar com `permitir_reaplicar=true`, por causa do registro de migrations já aplicadas.

### 3.2 Logo depois do apply, antes de cadastrar o dono

4. **Consulta 88a** (`88a-conferir-so-o-dono-define-cargo-aplicado`): 9 linhas, todas `ok`.
   Prova que os **objetos** existem com o corpo certo. Ela **não** prova que há dono.
5. **Consulta 88c** (`88c-conferir-o-dono-cadastrado`): neste momento as linhas do dono dizem **"nao"**.
   Isso é o esperado (tabela vazia). As três linhas de controle e as duas primeiras
   (tabela e função existem) devem estar `sim`.

### 3.3 Cadastrar o dono (uma vez por loja): receita para o dono do produto

**Quem faz: você, o dono do produto, na sua conta do Supabase.** O e-mail da pessoa escolhida
é dado pessoal (na Savy, de cliente) e **o programador (o agente) nunca o digita, nunca o
lê e não o recebe**. Por isso o cadastro é feito por você, em cinco telas, uma de cada vez.

**Regra geral para qualquer dúvida ou erro (vale em todas as telas e na seção 4):**

- Se uma tela aparecer diferente do que está descrito, **pare nela** e avise o programador
  dizendo **só o número da tela** ("a Tela 2 está diferente"). **Não descreva em palavras suas o
  que apareceu**: a descrição pode repetir pedaços do e-mail.
- Se aparecer um **erro em vermelho**, o motivo mais comum é uma aspa apagada ou o marcador
  `<e-mail-do-dono>` que ficou sem trocar. Apague tudo, **cole o texto de novo do jeito que está
  neste roteiro** e tente outra vez.
- Se o erro continuar, avise **só** "deu erro na Tela N". **Nunca copie nem fotografe a
  mensagem de erro**: ela pode repetir pedaços do e-mail, e a linha de erro do editor pode
  mostrar a consulta inteira, com o e-mail dentro.

Antes de começar, tenha à mão: o nome da loja, e o e-mail da pessoa que você escolheu como dono
dela (conta que já existe na loja e já é administradora). Faça uma loja por vez.

**Tela 1. Abrir o projeto da loja.**
1. Entre em `supabase.com/dashboard` com a sua conta.
2. Clique no projeto **daquela loja** (IKCOUS ou Savy, conforme a seção 5). Você reconhece o
   projeto pelo nome que você mesmo deu a ele.
   - Vai aparecer: o painel do projeto, com o nome dele no alto e um menu na esquerda.
   - Deu certo se: o nome no alto é o da loja certa. Confira, porque o cadastro vale só para
     essa loja.
   - Se aparecer diferente, **pare e avise "Tela 1"**: não aparece o projeto na sua lista (falta
     acesso); ou há **dois projetos com nomes parecidos** e você não tem certeza de qual é a
     loja; ou aparece um projeto chamado **`ikcous-loja`**, que é o antigo e **não deve ser
     usado**.

**Tela 2. Abrir o editor de SQL.**
1. No menu da esquerda, clique em **SQL Editor**.
2. Clique em **New query** (consulta nova; um botão com "+").
   - Vai aparecer: uma caixa de texto grande e vazia, e um botão para executar (**Run**).
   - Deixe a opção de papel (role) como está, em `postgres`: é ela que tem permissão de escrever
     na tabela do dono.
   - Se aparecer diferente (por exemplo, o menu da esquerda mostra só ícones, sem nomes):
     passe o mouse sobre os ícones ou abra o menu para ver os nomes. Se não achar o editor
     de SQL, **pare e avise "Tela 2"**.

**Tela 3. Conferir a pessoa (só leitura; não grava nada).**
1. Copie o texto abaixo e cole na caixa.
2. Troque `<e-mail-do-dono>` pelo e-mail da pessoa, **mantendo as aspas simples** em volta
   (fica `'fulana@exemplo.com'`).
3. Clique em **Run**.

   ```sql
   SELECT count(*) AS contas_com_esse_email,
          count(*) FILTER (WHERE (u.raw_app_meta_data ->> 'role') = 'admin') AS admin_em_auth_users,
          count(*) FILTER (WHERE p.role = 'admin') AS admin_em_profiles
     FROM auth.users u
     LEFT JOIN public.profiles p ON p.id = u.id
    WHERE lower(u.email) = lower('<e-mail-do-dono>');
   ```

   - Vai aparecer: uma tabelinha embaixo com três números.
   - **Deu certo se** os três forem `1`, `1`, `1`.
   - Se aparecer diferente, **pare** (não passe para a Tela 4):
     - `0, 0, 0`: não existe conta com esse e-mail nesta loja. Confira se digitou certo e se é a
       loja certa (Tela 1).
     - O primeiro número é **2 ou mais** (duas contas com o mesmo e-mail): **pare e avise "deu 2
       na Tela 3"** (ou o número que veio). Não siga adiante.
     - O primeiro é `1` e depois vem um ou dois `0`: a conta existe, mas não é administradora
       nas duas fontes do cargo. A função `definir_cargo` recusaria esse dono. Corrigir o cargo
       dela é decisão sua e um passo à parte: avise o programador, sem o e-mail.
     - Erro em vermelho: siga a regra geral acima (cole de novo do jeito do roteiro; se
       continuar, avise "deu erro na Tela 3" sem copiar a mensagem).

**Tela 4. Cadastrar o dono.**
1. Apague o texto da caixa, cole o texto abaixo, troque o e-mail como na Tela 3 e clique em **Run**.

   ```sql
   WITH novo AS (
     INSERT INTO public.dono_da_loja (user_id)
     SELECT u.id
       FROM auth.users u
       JOIN public.profiles p ON p.id = u.id
      WHERE lower(u.email) = lower('<e-mail-do-dono>')
        AND (u.raw_app_meta_data ->> 'role') = 'admin'
        AND p.role = 'admin'
     RETURNING 1
   )
   SELECT count(*) AS donos_cadastrados_agora FROM novo;
   ```

   - Vai aparecer: uma tabelinha com um número.
   - **Deu certo se** o número for `1`.
   - Se aparecer diferente:
     - `0`: nada foi gravado (e-mail errado ou conta que não é admin nas duas fontes). Volte à Tela 3.
     - Um erro em vermelho que fala de **`dono_da_loja_pkey`**: esta loja **já tem** um dono, e
       nada foi mudado. Para trocar o dono, veja a seção 4. (Você só reconhece a palavra;
       não copie a mensagem.)
     - Qualquer outro erro em vermelho: regra geral acima (cole de novo do jeito do roteiro;
       se continuar, avise "deu erro na Tela 4", sem copiar a mensagem).
   - Depois do `1`, não clique em **Run** de novo: rodar outra vez só dá o erro
     `dono_da_loja_pkey` (a loja só aceita um dono). É inofensivo, mas desnecessário.

**Tela 5. Limpar o rastro, avisar o programador e conferir.**
1. **Apague a consulta salva.** O editor costuma guardar o que você rodou (com o e-mail dentro)
   numa lista de consultas salvas ou num histórico, na lateral do editor. Se achar essa lista,
   apague a consulta que você usou e feche a aba do editor. Se não achar a lista, não é
   bloqueio: avise "Tela 5" e siga.
2. Diga ao programador apenas: "cadastrei o dono na loja X".
3. Ele roda a consulta 88c daquela loja, que **não usa e-mail nenhum**, e responde se as
   **9 linhas** estão `sim`. Só então a loja está pronta para a opção **Tornar administrador**.

**Depois do cadastro: recarregar o painel.** Quem estava com o painel da loja aberto antes do
cadastro precisa **recarregar a página (tecla F5)** ou **fechar a aba (ou o aplicativo)** e abrir
de novo. **Sair da tela do painel e voltar dentro do aplicativo não adianta**: o painel guarda na
memória da página a leitura "sem dono" feita antes, e só uma página nova lê o dono cadastrado.
Até lá, **Tornar administrador** continua sem aparecer, mesmo com o cadastro certo.

### 3.4 Lendo a consulta 88c

A 88c só lê e só devolve `sim`/`nao`. Nenhum identificador de pessoa sai nela.

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

Rode a 88c de novo **sempre que** o dono for trocado, o cargo dele for mexido (inclusive
direto no painel do Supabase) ou antes de liberar uma release que mexa na tela de cargos.
Hoje ela é conferência manual do programador: não é portão automático do `publicar-release`.

## 4. Trocar o dono (raro; decisão do dono do produto)

Quem faz é o dono do produto, no mesmo SQL Editor da seção 3.3, com as mesmas regras: o agente
nunca vê o e-mail, e a **regra geral de erro** da seção 3.3 vale aqui inteira. Por isso a
receita também é em telas, uma de cada vez.

**Tela A. Abrir o editor.** Faça as Telas 1 e 2 da seção 3.3 (projeto certo da loja, editor
de SQL, consulta nova). Se algo aparecer diferente, pare e avise "Tela A".

**Tela B. Conferir o novo dono.** Faça a Tela 3 da seção 3.3 com o e-mail do **novo** dono.
Só siga se vier `1`, `1`, `1`. Qualquer outra coisa: pare e avise "Tela B", dizendo só os três números que apareceram, sem descrever mais nada.

**Tela C. Trocar.**
1. Apague o texto da caixa, cole o texto abaixo, troque `<e-mail-do-novo-dono>` (mantendo as
   aspas simples) e clique em **Run**.

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
   SELECT count(*) AS donos_na_loja FROM public.dono_da_loja;
   ```

2. **Pode aparecer um aviso do editor** perguntando se você quer mesmo executar, porque o texto
   tem um comando que apaga (`DELETE`). Isso é esperado: ele apaga só a linha do dono antigo, e
   a mesma execução já grava o novo. Clique no botão que **confirma** a execução (o que não é
   cancelar). Se o aviso tiver outra forma e você não tiver certeza de qual botão confirma,
   **pare e avise "Tela C"**.
   - Vai aparecer: uma tabelinha com um número.
   - **Deu certo se** o número for `1`. Foi trocado.
   - Se aparecer diferente:
     - Erro em vermelho com a frase **`o novo dono nao foi cadastrado`**: o novo e-mail não é
       administrador nas duas fontes. **Nada foi trocado** (a execução inteira é desfeita, o
       `DELETE` junto) e o dono antigo continua. Volte à Tela B. Essa frase é do roteiro e
       não tem e-mail; mesmo assim não copie a mensagem inteira.
     - Qualquer outro erro: regra geral (cole de novo do jeito do roteiro; se continuar, avise
       "deu erro na Tela C", sem copiar a mensagem).
     - Não aparece número nenhum e nem erro: **pare e avise "Tela C"**. Não rode de novo
       antes de o programador conferir.

**Tela D. Limpar o rastro e conferir.** Apague a consulta salva e feche a aba (como na Tela 5 da
seção 3.3). Diga ao programador apenas "troquei o dono da loja X". Ele roda a consulta 88c
(9 linhas `sim`). Depois quem estava com o painel aberto **recarrega a página (F5)** ou fecha a
aba (ou o aplicativo) e abre de novo, pelo mesmo motivo da seção 3.3.

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
| Loja nova | o alvo dos workflows de banco vem de `scripts/frota/canais-de-backend.json` (a loja entra ali uma vez, quando o dono cria o segredo e o alvo do workflow); até entrar, a publicação bloqueia e diz o nome dela | entra neste roteiro assim que tiver banco. O cadastro `frota_lojas` só dá o inventário (quais lojas existem), não o alvo do apply |

As lojas Almeida, Brand Meliz e Space foram descontinuadas pelo dono em 16/10/2026 e não
entram na atualização.

**Quem é o dono de cada uma é decisão do dono do produto**, nunca do agente. Registrar a
resposta dele junto com a loja, sem e-mail nem identificador neste repositório.

## 6. O que este roteiro não faz

- Não aplica nada sozinho e não guarda e-mail, identificador ou credencial de ninguém. O agente
  nunca digita nem lê o e-mail do dono.
- Não decide quem é o dono nem corrige cargo de ninguém.
- A consulta 88c prova o **cadastro** e o cargo **de agora**. A prova de que `definir_cargo`
  funciona de ponta a ponta (dono nomeia, nomeado não nomeia, ninguém rebaixa o dono) está
  em `tests/banco/definir-cargo-so-o-dono-viva.cjs`, no Postgres efêmero do CI, e não toca
  nenhuma loja.

Referências: cabeçalho de
[`20261383000000_so_o_dono_da_loja_define_cargo.sql`](../../supabase/migrations/20261383000000_so_o_dono_da_loja_define_cargo.sql),
seção "Domínio do negócio — entidades, dinheiro e papéis" do [`AGENTS.md`](../../AGENTS.md), consultas em
[`scripts/publicacao/consultas/`](../../scripts/publicacao/consultas/) (`8b`, `88a`, `88b`, `88c-conferir-o-dono-cadastrado`).
