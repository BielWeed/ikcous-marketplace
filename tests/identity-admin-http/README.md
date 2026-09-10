# Contrato administrativo por HTTP local

Ensaio A5e1, separado do aplicativo e dos bancos das lojas. Na raiz do worktree:

```powershell
node tests/identity-admin-http/run.mjs
```

Requer Docker já em execução, as imagens locais exatas Postgres 17.6.1.153 e
PostgREST 14.8, Node e as dependências já instaladas neste projeto. O script não
aceita argumentos nem lê arquivos de ambiente. Não baixa imagens ou dependências.

Cada execução cria uma rede interna, um PostgreSQL sem porta host, quatro bancos
sintéticos e quatro PostgREST sem portas host. Quatro pequenas pontes HTTP Node
escutam portas efêmeras exclusivamente em 127.0.0.1 e encaminham via `docker exec curl`
para o PostgREST próprio na rede interna. Nenhum container ganha rede com saída. Nomes,
IDs, labels e imagens são conferidos antes de operar recursos. O container antigo
ikcous-identidade-sql-20260909 fornece somente schema-only auth/storage; continua
sem rede e sem portas, e nenhum de seus dados é alterado.

As fixtures/migrations A2/A5 são lidas literalmente da lista fechada no módulo de
ambiente. Não se aplica a fila histórica de migrations. A2/A5 recusam baseline
divergente; os dados existentes aqui são apenas os dois usuários e duas linhas
sintéticas da fixture. A ausência de linha é testada em outros dois bancos próprios.

Antes de A5, o ensaio exige o RED: as RPCs ausentes devem receber 404/PGRST202 e o
cliente precisa distinguir indisponibilidade. Depois de A5, exige 20 casos por variante
principal/savy, 40 no total. Setup incompleto, timeout ou contagem menor saem com erro.
Os casos cobrem JWT, permissão, revisão textual, no-op, conflito, escritor antigo,
resposta perdida após gravação, releitura, cancelamento e revisão acima de 2^53.

O bundle browser ESM em memória contém o cliente e SDK reais. O adaptador de teste
traduz somente duas URLs Supabase fictícias para a ponte loopback do PostgREST próprio,
preservando corpo/headers do SDK e devolvendo a URL virtual. Escrita antiga fica fora desse
adaptador. JWTs e senhas são gerados só para a execução; não são impressos. Os logs
selecionam status/códigos conhecidos/revisões/hashes, nunca bodies de erro, senhas,
DSNs ou Authorization. A chave pública sintética não é validada por gateway neste
ensaio. Curl real faz o HTTP interno; nenhuma consulta SQL substitui uma resposta HTTP.
A ponte possui token próprio de bancada, três rotas fechadas e apenas POST. Não
aceita DELETE ou destino arbitrário. Curl roda sem shell, sem curlrc/proxy, sem
redirect/retry automático e com limite de tempo e tamanho. Configuração/corpo/headers
via stdin usam escaping de curlconfig (não escaping de shell). Há controle comparando
status, MIME e hash do corpo entre curl direto e ponte, além de nome com caracteres
UTF-8, aspas, backslash, tab e CR/LF para conferir a passagem literal do JSON.

Os recursos ficam preservados e são parados no final, inclusive em falha. Nenhuma
rede, volume, banco ou container é removido. Evidências com IDs/portas/hashes/casos
ficam em C:/Users/Gabriel/recuperacao-ikcous/20260909-ecossistema/controle/tarefa-A5e1-<runId>/.
Reexecutar cria outros recursos; não reinicia nem reutiliza os anteriores. Uma
interrupção externa do processo pode impedir o finally; conferir os IDs/labels
registrados antes de qualquer parada manual. Não executar prune ou apagar volumes.

## Módulo do ambiente

environment.mjs não executa Docker ao ser importado. createEnvironment(runId,evidence)
fecha nomes/recursos próprios e retorna start(), createDatabase(suffix), sql(db,source),
startRest(db,suffix), stop() e jwtSecret de fixture somente em memória. start,
startRest e stop são assíncronas. sql aceita
apenas bancos criados por essa instância; não é uma API para SQL de usuário.
startRest devolve origin loopback, guard(), fetch(url,init) que acrescenta o token
de bancada, e direct(name,headers,body,signal) para o controle curl sem ponte Node.
Não devolve DSN/senha. O consumidor deve usar try/finally com await stop() e nunca
serializar o ambiente nem jwtSecret. Os nomes DNS dos recursos são limitados a 63 caracteres.

O papel de conexão é novo, identity_http_authenticator_<runId>, limitado a LOGIN e
troca para anon/authenticated. Não altera o authenticator reservado da imagem.
Prontidão do PostgreSQL usa TCP dentro do próprio container: o servidor temporário
da inicialização aceita socket Unix antes de a configuração estar concluída.

O Docker Engine 29.7.2 local aceita `--publish` numa rede exclusivamente interna,
mas não cria o mapeamento operacional. A ponte mantém o isolamento definido no plano;
não há alteração do daemon, firewall ou conexão a segunda rede. Essa fronteira é
parte explícita do ensaio, não uma prova de fetch nativo direto a um servidor remoto.

## Fronteiras

O ensaio verifica cliente/SDK/PostgREST/PostgreSQL reais com dados inventados.
is_admin conserva o corpo da fixture: claims app_metadata ou auth.users.raw_app_meta_data
via auth.uid; os JWTs de teste não incluem app_metadata. O papel SQL é authenticated,
inclusive para admin. Não se substitui a função por um mock.

Não prova GoTrue/login/refresh, gateway/apikey, TUS/Storage/RLS de objetos, CORS/TLS/CDN,
interface do painel, pixels das marcas, PWA ou produção. Os descritores de imagem
vêm da fixture SQL: não afirmam arquivos enviados ou visualmente verificados.
Este comando não integra o CI geral automaticamente; o revisor deve executá-lo.
