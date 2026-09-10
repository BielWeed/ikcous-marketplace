# Uma edicao antiga nao substitui a identidade mais recente

Ensaio local da tarefa A5b. Executar na raiz do worktree com Node e Docker ja instalados:

```powershell
node tests/identity-concurrency/run.cjs red
node tests/identity-concurrency/run.cjs green
```

O modo red reproduz A->B->C->A e comprova que repetir B pela RPC antiga sobrescreve A.
Seu exit 0 significa que o defeito esperado foi reproduzido; tambem confirma ausencia das
duas RPCs novas e da revisao. Green aplica A5 e exige conflito na mesma intencao obsoleta.
Nenhum modo aceita argumentos de SQL, nome de container, URL ou banco externo.

O runner exige o container `ikcous-identidade-sql-corrigido-20260909` rodando a imagem
`public.ecr.aws/supabase/postgres:17.6.1.153`, supautils 3.2.3, NetworkMode none e
PortBindings {}. O container anterior `ikcous-identidade-sql-20260909`, tambem sem rede ou
portas, fornece somente pg_dump schema-only de auth/storage. As fixtures A2 sao consumidas
por leitura. Nenhum teste usa HTTP, Storage real, arquivo .env ou dado de cliente.
Todos os bancos novos comecam por `identity_a5_` e ficam preservados para revisao.

Logs com bancos, tempos, saidas, hashes e observacao das travas ficam em
`C:/Users/Gabriel/equipe/entregas/20260909-codex-investigacao-ikcous/aceite-A5b-sql/`.
O SQL usa dois processos psql e confirma seus PIDs distintos e pg_blocking_pids;
o intervalo de polling nao determina a ordem das gravacoes. O limite da RPC e 5 segundos.

`read_store_identity()` devolve `{ revision: string, identity: object }`. Identity tem
exatamente store_name, store_city, store_state, primary_color, secondary_color,
accent_color, logo_url e branding_assets, com null explicito. A revisao decimal canonica
e uma identidade de ocorrencia, nunca contagem de edicoes. Nao converter para Number.

`save_store_identity(expected_revision text, expected_identity jsonb, desired_identity jsonb)`
valida permissao e formato, trava a linha id=1, compara revisao e fotografia bruta e
reutiliza upsert_store_config. Retorno e dados persistidos precisam coincidir com o pedido.
No-op preserva revisao e updated_at. Operacoes de identidade incrementam a revisao tambem
pela RPC antiga e por INSERT/UPDATE autorizados; campos operacionais preservam a revisao.
JSON esperado e desejado admitem no maximo 262144 bytes UTF-8 cada. Primary_color desejada
aceita null ou seis hexadecimais, exceto #000000; valores brutos legados continuam legiveis.
O caller nao escolhe a revisao, inclusive no INSERT ou no caminho ON CONFLICT.

Erros da API: 42501 IDENTITY_PERMISSION, 22023 IDENTITY_INVALID, P0002 IDENTITY_MISSING,
P0001 IDENTITY_CONFLICT e P0001 IDENTITY_WRITE_UNCONFIRMED. Ausencia de EXECUTE retorna
42501 nativo; CHECKs A2 retornam 23514 com mensagem fixa IDENTITY_INVALID, sem DETAIL/HINT.
Somente check_violation da chamada antiga e sanitizada; as demais excecoes continuam
distintas, inclusive IDENTITY_WRITE_UNCONFIRMED. CONTEXT tecnico gerado pelo PostgreSQL
pode existir; a funcao nao interpola o payload em mensagens ou diagnosticos.
Timeout de trava retorna 55P03. Esgotamento da
sequencia NO CYCLE retorna 2200H; a linha nao sofre alteracao parcial.

A migration e transacional. Linhas existentes recebem default constante zero sem UPDATE;
todos os campos antigos, corpos de funcoes, view, owners, ACLs e politicas sao preservados.
A sequencia nao depende da linha nem usa OWNED BY. Exclusao/recriacao ou movimentacao de id
recebe nova ocorrencia. Lacunas, inclusive por rollback e ON CONFLICT, sao normais.
Reaplicacao e objetos/divergencias preexistentes recusam explicitamente sem modificar estado;
nao existe reconciliacao automatica de schema desconhecido.

`rollback.sql` fecha somente a nova entrada de escrita, revogando EXECUTE de
save_store_identity. E transacional e repetivel; conserva leitura, dados, RPC antiga,
coluna, sequencia e trigger. O front anterior pode usar a RPC antiga, que continua com sua
politica anterior: um escritor antigo posterior ainda pode sobrescrever a identidade.
Nao existe promessa de protecao retroativa das intencoes dos clientes antigos.

A releitura igual ao desejado confirma estado presente, nao autoria de uma tentativa cuja
resposta se perdeu. Nao se deve adotar uma revisao nova para repetir uma intencao antiga.
Nao ha protecao contra superuser/DDL hostil, reset manual de sequencia ou restauracao de
backup antigo. Este ensaio nao certifica autenticacao HTTP/JWT, infraestrutura remota,
publicacao ou todas as lojas. Antes de eventual aplicacao, medir novamente as definicoes,
permissoes e dados em cada banco, e obter revisao independente. O CI geral do app nao roda
este ensaio SQL automaticamente; ele deve ser executado explicitamente pelo revisor.
