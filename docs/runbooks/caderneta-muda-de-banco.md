# A caderneta muda de banco — do projeto antigo para o banco da IKCOUS (sem nenhuma loja fora do ar)

A caderneta da frota (`public.frota_lojas`, `public.frota_segredo`, `public.frota_estado_historico` e, desde a
20261570000000, `public.frota_enderecos_que_encaminham`) é o cadastro que diz ao porteiro de cada loja "este endereço
é a loja X, banco Y" (e "este endereço antigo agora é o endereço Z"). Ela mora no banco para onde `IKCOUS_FROTA_URL`
aponta. Até a virada, esse banco é o projeto antigo `dekxabvqdsuukijblazl`, que não recebe migrations pelos canais e
pode pausar; se ele pausar, **todas as lojas mostram "em manutenção" em até 1 hora**. Depois da virada, a caderneta
mora no banco da IKCOUS (`cafkrminfnokvgjqtkle`), que já tem as tabelas (as migrations da caderneta vão a todo banco
do canal) e recebe migration pelo caminho normal.

**Nenhuma linha do porteiro muda.** A virada é: copiar as linhas, conferir que as duas cadernetas ficaram iguais, e
trocar duas variáveis **públicas** na Vercel. A `IKCOUS_FROTA_CHAVE` (secreta) **não muda**: o hash dela é copiado.

**Quando:** a partir de 01/12/2026 (fora da semana da Black Friday), em hora calma, **nunca sexta**. A medição
(passo 1) pode ser feita antes.

## Os três arquivos

| Arquivo | Onde roda | O que faz |
|---|---|---|
| [`caderneta-impressao-digital.sql`](../../scripts/frota/banco-da-caderneta/caderneta-impressao-digital.sql) | nos DOIS bancos | só lê; devolve linhas `bloco`, `valor` (contagens e md5, nunca o hash em claro nem dado de loja) |
| [`copiar-caderneta-gerar.sql`](../../scripts/frota/banco-da-caderneta/copiar-caderneta-gerar.sql) | no banco ANTIGO (origem) | só lê; devolve UMA coluna `script`: o texto que roda no banco da IKCOUS |
| o texto gerado | no banco da IKCOUS (destino) | confere, grava as linhas e confere de novo — tudo ou nada |

Pelo MCP do Supabase, **sempre `execute_sql`, nunca `apply_migration`** (isto não é migration: gravaria uma versão
falsa no histórico). Prova viva dos três: `tests/banco/a-caderneta-muda-de-banco-viva.cjs` (roda no `rpc-ci.yml`).

## 1. Antes (só leitura, pode ser até 30/11)

1. `execute_sql` no `dekxabvqdsuukijblazl` com o conteúdo de `caderneta-impressao-digital.sql`. Guardar a saída.
2. O mesmo no `cafkrminfnokvgjqtkle`. Esperado no banco da IKCOUS: `frota_lojas.linhas`, `frota_segredo.linhas` e
   `frota_estado_historico.linhas` e `frota_enderecos_que_encaminham.linhas` = `0`, e as seis linhas `ledger.*` =
   `registrada`. **A 20261570 tem de estar nos DOIS bancos** (no antigo também): sem a tabela dos endereços, a digital e
   o gerador falham com `relation "public.frota_enderecos_que_encaminham" does not exist` — aplicar a 20261570 lá antes.
3. Nos dois: os blocos `funcao.*.corpo` iguais, e `tabela.*.forma` iguais.
4. O JS de produção ainda carrega o banco antigo? (sem credencial)
   `curl.exe -s https://<loja>/ | Select-String "dekxab"` e o mesmo nos arquivos `assets/*.js` que a página carrega.
5. `vercel env ls production` (só os NOMES): as três `IKCOUS_FROTA_*` existem.

**Para aqui (não segue) se:** o banco da IKCOUS já tem linha na caderneta; falta alguma das seis versões no ledger
dele (aplicar pelo canal antes, fora da semana da BF); ou algum `funcao.*.corpo` do banco antigo difere do da IKCOUS.

## 2. A virada (01/12 ou depois)

1. **Congelar:** recado no mural — nenhuma loja nova cadastrada e nenhum `estado-da-loja` até o passo 8.
2. **Gerar:** `execute_sql` no `dekxabvqdsuukijblazl` com o conteúdo de `copiar-caderneta-gerar.sql`. A resposta é UMA
   linha com a coluna `script`. Esse texto leva o hash bcrypt da chave da frota (nunca a chave): **não colar em
   conversa, bastão, arquivo nem commit**; ele só passa pela saída do MCP.
3. **Revisar:** o revisor (Opus) lê o texto gerado antes de ele rodar.
4. **Copiar:** `execute_sql` no `cafkrminfnokvgjqtkle` com `begin;` + o texto gerado + `commit;`, **na mesma chamada**.
   Se qualquer trava recusar, nada é gravado (veja a tabela abaixo).
5. **Conferir:** a impressão digital nos dois bancos. Esperado: **tudo igual**, menos:
   - `frota_segredo.hash_rapido_nulo`: `nao` no antigo, `sim` na IKCOUS (a cópia não leva o atalho de propósito);
   - `ledger.*`: no antigo pode estar `ausente` (as migrations da caderneta foram aplicadas à mão lá). É informativo;
     quem prova que os objetos são os mesmos são os blocos `tabela.*` e `funcao.*`.

   **Qualquer outra diferença = PARAR.** Nada foi trocado ainda; nenhuma loja lê o banco da IKCOUS.
6. **Trocar e publicar:** na Vercel (produção), `IKCOUS_FROTA_URL` = `https://cafkrminfnokvgjqtkle.supabase.co` e
   `IKCOUS_FROTA_APIKEY` = a chave publishable do banco da IKCOUS (pública; MCP `get_publishable_keys`).
   `IKCOUS_FROTA_CHAVE` **intocada**. Publicar o MESMO SHA que está no ar, pelo portão de sempre:
   `node scripts/frota/publicar-release.mjs --sha <sha40> --deployment <dpl_...> --promover`.
7. **Medir na hora:**
   - `node scripts/frota/conferir-frota.mjs --sha <sha40> --vercel` — toda loja com a caderneta `hit`;
   - `curl.exe -sI https://<cada loja>/ | Select-String "x-ikcous"`;
   - a impressão digital no banco da IKCOUS: `frota_segredo.hash_rapido_nulo` vira `nao`. **Isso prova que o porteiro
     chegou ao banco novo com a chave certa** (a primeira chamada certa grava o atalho).
8. **Em até ~1 h:** as chamadas a `resolver_loja*` no banco antigo caem a zero (logs da API pelo MCP).
9. **24 h boas:** descongelar (recado no mural). Dali em diante a caderneta é a do banco da IKCOUS.
10. Se o passo 1.4 achou `dekxab` no JS: trocar `VITE_SUPABASE_URL` e a chave de produção para o banco da IKCOUS numa
    publicação SEPARADA, medida (`version.json` e o JS sem `dekxab` em cada loja).
11. **7 dias** com zero chamada ao banco antigo: a decisão de pausá-lo é do dono (dá para despausar em até 90 dias).

## Se a cópia recusar (nada foi gravado)

| Código | O que quer dizer | O que fazer |
|---|---|---|
| `COPIA_ORIGEM_VAZIA` | o gerador rodou num banco sem a caderneta semeada | gerar de novo no banco antigo |
| `COPIA_ORIGEM_DIVERGENTE` | as portas do banco antigo não têm os corpos da 20261490 | medir o antigo (passo 1) antes |
| `COPIA_DESTINO_SEM_CADERNETA` | falta tabela da caderneta no destino (inclusive a dos endereços, da 20261570) | aplicar as migrations pelo canal |
| `COPIA_FORMA_DIVERGENTE` | uma tabela do destino tem outra forma (colunas) | aplicar as migrations pelo canal |
| `COPIA_PORTAS_DIVERGENTES` | as portas do destino não são as da 20261490/20261470/20261570 | aplicar as migrations pelo canal |
| `COPIA_GATILHO_AUSENTE` | o gatilho do estado (ou o dos endereços) não está ligado no destino | aplicar a 20261470 (ou a 20261570) pelo canal |
| `COPIA_DESTINO_NAO_VAZIO` | o destino já tem linha (ou a cópia já rodou) | não repetir; medir com a impressão digital |
| `POSVOO_COPIAR_CADERNETA` | o resultado não bateu com a origem | nada ficou (a transação inteira cai); investigar |

## Desfazer

- **Passos 2.2 a 2.5:** nada lê o banco da IKCOUS ainda; basta não trocar as variáveis. Apagar as linhas copiadas lá é
  apagar dado: só com o sim do dono.
- **Passos 2.6 a 2.9:** variáveis de volta para o banco antigo + republicar o mesmo SHA (~3 min). O banco antigo não foi
  tocado e, com as gravações congeladas, continua idêntico; as instâncias quentes cobrem a troca com a ficha de até 1 h.
- **Depois do passo 2.9:** o banco da IKCOUS é a verdade. Voltar exige copiar de volta o que mudou (o mesmo gerador, no
  sentido inverso, com o banco antigo esvaziado — apagar dado é decisão do dono). Por isso o congelamento dura 24 h.

## Os rollbacks que apagariam a caderneta

Depois da virada, o banco da IKCOUS guarda a caderneta de produção. O `rollback-manual-20261141000000` (derruba as
tabelas) e os `rollback-manual-destrutivo-20261460000000` (tira o estado de cada loja) e
`rollback-manual-destrutivo-20261470000000` (apaga o histórico) **recusam com `CADERNETA_SEMEADA`** e não apagam nada
quando qualquer uma das três tabelas tem linha — mesmo com a confirmação `APAGAR` de cada um. Nos bancos das lojas
(caderneta vazia) eles apagam como antes. Apagar a caderneta de verdade é só com o dono, com
`SET LOCAL ikcous.apagar_caderneta = 'sim';` na mesma transação.

Veja também: [estado de vida da loja](estado-de-vida-da-loja.md) ·
[produção — fonte única](producao-unica-fonte.md) ·
[rotação de credenciais do Supabase](rotacao-credenciais-supabase.md).
