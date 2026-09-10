# Aplicativo real com as marcas originais

Execute da raiz reservada do worktree: `node tests/browser-identity-app/run.mjs`.
Contraprovas do contrato: `node --test tests/browser-identity-app/contracts.spec.mjs`.

Requer a reserva exclusiva de `dist-test` e fontes de build, kit local aprovado,
OpenSSL no caminho fixo e Chrome do Puppeteer instalado. Não instala dependências.
Cada execução cria evidência nova e preserva os perfis curtos em TEMP; os fecha em finally.
Nunca reexecute o preparador do kit. A execução não é idempotente sobre o mesmo
diretório: escreve com exclusividade, sempre em um novo diretório por execução.

O preflight usa artefato existente e perfis separados para aceitar somente a chave
TLS da execução e recusar certificado ausente/incorreto, destino desconhecido,
rota externa desconhecida, query duplicada e recurso local ausente.
Depois são feitos quatro builds integrais fixture; o plugin exclusivo desta pasta
define apenas dois campos públicos fictícios. Provedores, SDK, App, Header e SW
permanecem originais. Os artefatos preservados têm hashes e fotografia da identidade.

Proxy e HTTPS terminam localmente; nenhum destino é encaminhado ou resolvido.
Quatro consultas públicas têm respostas sintéticas fechadas. Realtime é recusado;
Google Fonts também, com fonte substituta explícita nas capturas. Não há login.
Arquivos locais ausentes respondem 404, nunca HTML de fallback para JavaScript.
Todos os recursos recebem no-store no transporte de ensaio. Isso não prova os
cabeçalhos de qualquer hospedagem real. Trocar artefato troca uma referência em
memória atomicamente; o servidor não conserva versões antigas inexistentes.

A primeira navegação espera o controle e o precache reais, sem recarga online
adicional para aquecer. Captura desktop e mobile sem navegar, corta conexões de
verdade e recarrega. Caches são somente lidos, nunca criados/preenchidos pelo teste.
Atualização usa visibilidade real, aviso e clique real, depois confere cache,
marcador e identidade novos e repete offline. A propriedade performNuclearPurge
exportada pelo hook é alias de handleUpdate; não se exige limpeza nuclear no botão.

Falha de produto é preservada e devolvida; esta pasta não corrige o aplicativo.
Aceite não certifica autenticação, banco, RLS, produção, instalação no SO ou Inter.
O replay independente A6c verificou identidade, atualização e segunda abertura offline
nas duas marcas, com ressalva: o estado terminal do catálogo offline não foi certificado.

A6c2 valida os eventos acumulados ao terminar cada fase e depois de fechar Chrome,
drenar a observação e fechar o transporte. O resultado só é gravado e anunciado
depois disso. Os dois cortes offline têm sonda de rede e conferência de ausência
de respostas por posição no log, inclusive respostas tardias durante o fechamento.
Falha de observação/fechamento reprova; logs de falha continuam preservados.

Página e workers usam o mesmo contrato: arquivos realmente presentes nos dois
artefatos, consultas públicas exatas, logos exatos, URL exata da fonte Inter
recusada e websocket Realtime com os três parâmetros conhecidos. Falhas de rede
offline são esperadas somente em URL já admitida. Recusa do proxy sem identidade
permanece sem atribuição; nunca isenta pedido do app pelo nome do domínio.
Pedidos correlacionam targetId, sessionId e requestId, conservando URL, iniciador,
redirecionamento, resposta e falha. Valores de apikey permanecem redigidos.

O observador usa CDP Target.autoAttachRelated numa sessão própria do alvo browser,
antes da primeira navegação. Não mistura setAutoAttach com esse comando. Workers
novos pausam para Network/Runtime serem habilitados após instalar os handlers;
Runtime.runIfWaitingForDebugger os libera, também se a instrumentação falhar.
Esta pausa de depuração altera brevemente o tempo de início, mas não altera
scripts, respostas, caches, TLS, relógio ou sentinela. O encerramento normal fecha
o Chrome antes de remover os handlers; a bancada não reutiliza perfis anteriores.

APIs conferidas na versão realmente resolvida: Puppeteer e seu puppeteer-core
interno 25.3.0, CDPSession.connection(), Connection.session() e eventos públicos
do protocolo. A cópia top-level de puppeteer-core não é a resolução desse import.
Fonte: https://chromedevtools.github.io/devtools-protocol/tot/Target/.

Chrome pode emitir o final do download do próprio sw.js depois da criação do
alvo SW, sem emitir o começo nessa sessão. Resposta com URL igual ao scriptURL
do alvo conserva a URL recebida e unassociated:true e passa pelas mesmas guardas.
Um loadingFinished inicial sem associação, identificado pelo requestId igual ao
targetId do SW, fica bootstrap-finished, URL:null; não fabrica pedido nem origem.
Outros terminais sem associação, resposta desconhecida e loadingFailed sem URL
são falhas de observação. Esse limite foi medido na fixture, não presumido.

Verificação local, sem build/replay do aplicativo:

```powershell
node --test tests/browser-identity-app/contracts.spec.mjs tests/browser-identity-app/evidence.spec.mjs tests/browser-identity-app/transport.spec.mjs tests/browser-identity-app/journey.spec.mjs tests/browser-identity-app/observe.spec.mjs tests/browser-identity-app/offline.spec.mjs tests/browser-identity-app/callsites.spec.mjs
```

A fixture real de observe.spec.mjs é opt-in: A6C2_EVIDENCE deve apontar para uma
pasta nova controle/tarefa-A6c2-<runId> na raiz física declarada em evidence.mjs.
Ela usa perfil próprio e proxy HTTP fechado (nenhum encaminhamento), registra
um SW mínimo próprio e sua versão seguinte. Em cada versão exige o primeiro
pedido inesperado com identidade completa e a recusa pelo contrato, além do
controle local permitido. Fecha perfil/proxy e preserva os logs. Nenhum SW de
fixture é registrado no perfil de aceite do aplicativo. Esta prova não certifica
a jornada real. O aceite com ressalva do replay A6c está registrado no relatório central
`tarefa-A6c-replay-pos-retentativa-relatorio.md`; a fixture neutra não aprova o App por si.

journey.spec.mjs executa o corpo real da função, substituindo somente IO. Para
contraprova sem alterar fontes, A6C2_JOURNEY_SOURCE pode apontar para a cópia
original congelada de journey.mjs; as mesmas falhas de update voltam a passar
indevidamente e os testes reprovam. Não usar essa variável no ensaio do aplicativo.

A6c4 conserva exceptionDetails completo, timestamp nativo, iniciador estruturado,
corsErrorStatus e exceptionRevoked. A revisão anterior permanece intacta: bootstrap
sem começo não vira pedido inventado, e handlers observam também a nova versão.
Ausência de exceptionMetaData na notificação permanece falta de prova; não se consulta
o objeto para inventar associação ou substituir a exceção por outra depois da revogação.

Somente dois casos podem receber classificação separada de rede esperada: a logo
HTTPS exata da identidade, ausente antes do corte e recuperada pela arte local íntegra
no Header; e a raiz ausente, com index.html íntegro e um único pedido da página cujo
iniciador seja o aquecimento emitido. A identificação causal é sessão/alvo/requestId
nativo do SW. O pedido da página é uma prova distinta: seus IDs não são associados
aos IDs do worker por horário. Nenhuma exceção é removida do log.

Acorn lê os bytes do sw.js e da única entrada assets/index-*.js, sem executá-los.
As cadeias fetch/then/catch e os avisos exatos identificam os dois ramos do worker;
WARM_CACHE, cache reload, res.ok/cache.put e catch null identificam o aquecimento.
Ausência ou ambiguidade reprova a preparação. As posições derivadas precisam coincidir
com a localização nativa da exceção e o iniciador do pedido ligado. Os hashes dos
arquivos, identidade, caches e recuperação ficam em result.offlineCuts.

Os dois intervalos são delimitados por posição dos eventos, e o transporte precisa
começar pelo corte físico e permanecer sem resposta. O primeiro intervalo é fechado
antes de reconectar; o segundo inclui o encerramento. Uma exceção recebida depois de
fechar o primeiro intervalo não ganha isenção retrospectiva. Falta de metadado,
mudança de sessão, outro destino, CORS/CSP, iniciador desconhecido, erro homônimo,
cache obrigatório ausente e falha tardia continuam fatais.

As novas contraprovas são offline.spec.mjs e callsites.spec.mjs. O teste real do
observador também aceita pasta nova controle/tarefa-A6c4-<runId> em A6C2_EVIDENCE;
ele comprova em duas versões a falha nativa e dois controles TypeError homônimos,
incluindo o tratamento posterior e revogação. Usa SW mínimo próprio, sem App/main,
e não comprova a recuperação visual do produto. O replay independente verificou
identidade, atualização e segunda abertura offline; o estado terminal do catálogo
offline permanece sem certificação.

Esta bancada tem runner Node manual, com os sete arquivos *.spec.mjs selecionados
explicitamente no comando acima. Esses nomes ficam fora da descoberta automática
de testes Deno em tests/. O CI permanece inalterado; esta delimitação não afirma
npm test geral aprovado nem substitui o aceite do aplicativo.
