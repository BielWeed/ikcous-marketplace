# Banners — inventário anterior à troca de telas (21/10/2026)

Levantamento feito antes de remover a interface antiga. Os testes de regressão continuam sendo o oráculo; navegação de três passos/Simples/Completo será adaptada à escolha de criação e Mais opções.

| Função existente | Destino no redesenho |
| --- | --- |
| Lista por topo/meio/base, contagens, busca sem acentos e filtros de status | Lista A, filtros recolhidos |
| Visão compacta/detalhada persistida; resumo de ativos/distribuição/preenchimento | Opções da lista |
| Miniatura, título, link, estado pausado/agendado/expirado/no ar, período e progresso | Cartão A |
| Ordenar sem mutar estado, limites de posição, uma RPC | moveBanner e botões A |
| Ligar/desligar com indicação de trabalho e aviso de falha | handleToggleActive e interruptor A |
| Editar sem Duplicar; excluir só após confirmação | Cartão A e AlertDialog |
| Carregando, vazio, sem resultados, offline e recarga ao reconectar | Lista A e efeito existente |
| Posição, ordem, ativo | Mais opções D |
| Upload, redução no hook, ajuste 2:1/4:1 e tipo real de recorte | handlers existentes + ImageAdjuster D |
| Input de arquivo limpo após sucesso/falha; repetição do mesmo arquivo | handleFileUpload existente |
| Upload/recorte pertencem à geração do editor; resultado tardio não troca outro banner | refs de geração existentes |
| Limpeza de upload substituído/abandonado; imagem já publicada nunca apagada | adotarImagemEnviada/handleOpenChange; rastrear só arquivo enviado, nunca foto do produto |
| Salvar bloqueia upload/recorte e vice-versa, inclusive no mesmo lote | refs síncronas existentes |
| Fechar durante salvar é vetado; falha preserva editor/rascunho; sucesso limpa | handleSubmit/handleOpenChange existentes |
| Edição durante envio preserva o novo texto, inclusive buffer ainda não descarregado | revisaoDaDigitacao/formularioAtual; handlers existentes |
| Criação durante edição posterior passa a atualizar o id criado, sem duplicar | handleSubmit existente |
| Rascunho por usuário, recuperar/descartar, autosave e dirty | efeitos existentes + aviso em D |
| Modo sem texto/com texto lembrado; banner antigo com texto nunca abre apagando campos | Mais opções de imagem própria; modoAoAbrirOBanner existente |
| Escape fecha só cropper/confirmação superior antes de editor | efeito existente |
| Voltar físico e do painel consomem uma única entrada na mesma URL; idempotência | efeitos de histórico existentes |
| Inativar tela limpa overlays e invalida envios antigos; restauração de scroll | efeito active e useScrollRestoration |
| Datas locais, presets 24h/fim de semana/7/30 dias, remover programação | Mais opções D |
| Fim anterior ao início bloqueia; fim vencido pergunta; confirmação vale uma vez | problemaDasDatas/AlertDialog existentes |
| Mensagem de expiração e campanhas simultâneas no período | Mais opções D |
| Destino sem clique/produto/página/categoria/link, normalização e validação de URL | seletor de produto + Mais opções D |
| Sugestões de título/preço com vírgula, busca de produto sem acento | seletor de produto D e sugestões |
| Título/subtítulo/botão/selo, esconder sobreposição; atalhos de texto do botão e limpar | CamposDeTextoDoBanner; imagem própria e atalhos em Mais opções D |
| Seis layouts antigos, quatro fontes, temas rápidos | Mais opções de imagem própria |
| Cores livres/paletas/marca/extraídas, filtro/opacidade, contraste e otimização | Mais opções de imagem própria |
| Prévia recolhível ao vivo | D, modelo pronto compartilhado; própria mantém desenho antigo |
| Ajuda e evento admin:open-new-banner-dialog | ajuda A e abertura B |
| Veto de atualização durante upload/recorte/gravação | marcarOperacaoSensivel existente |

## Novos comportamentos contratados

B escolhe modelo/imagem/IA; C mostra os seis modelos e filtros; D grava pronto_* com foto e destino do produto, textos limitados e cor em hex; E reutiliza CriarBannerComIa. Sem migrations, sem alterar teto de bytes.

## Isolamento do pacote

A tela já era carregada por `lazy` em `AdminArea.tsx`. Os desenhos da loja são reutilizados diretamente por `BannerPronto`/`BannerProntoPreview`. Os dados de seleção e a montagem do tipo foram movidos para `src/lib/catalogo-de-banners.ts`, importado diretamente pelo painel; o prefixo comum fica em `src/lib/prefixo-do-banner.ts`; `banner-modelos.ts` mantém os mesmos exports aprovados, sem alterar suas assinaturas. Isso evita levar as descrições e paletas administrativas para a loja.

A recuperação de rascunho mantém a procedência do upload (`imagemEnviadaNaoSalva`) e não trata foto de produto ou imagem publicada como arquivo abandonado. Rascunhos antigos do bucket de banners continuam recuperáveis; referências conhecidas da lista/produtos ficam protegidas.
