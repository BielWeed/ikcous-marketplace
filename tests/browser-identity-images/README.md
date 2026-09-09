# Ensaio local de imagens originais

Execute `node tests/browser-identity-images/run.mjs` na raiz. Usa somente esbuild,
Sharp, Puppeteer e Chromium já instalados. Não baixa browser nem inicia o app;
não lê configuração Vite, `.env`, cadastro, Storage ou imagens reais.

O servidor em 127.0.0.1 com porta efêmera permite apenas HTML e bundle do ensaio.
Pedidos inesperados são bloqueados e registrados. Fixtures sintéticas, relatório,
hashes, bundle/metafile e captura ficam em diretório novo `tarefa-A5c2a-*` na
central externa de entregas. Falha encerra com código diferente de zero.

Compara bytes/SHA e medidas raster brutas com metadata + raw decode do Sharp,
usando os limites de A4. Registra também bytes/hash do raw Sharp e compara as
variantes JPEG com seu original sem preenchimento. A fixture exata do revisor
(274 bytes, SHA-256 31a4aa557fd7fe9f2986b18a4c2c1810b1bf91fdf10e8eff59a4a5ef30945b76)
é testada sem reencode, assim como FF antes de APP/COM/DQT/SOF, payloads com FF FF,
JPEG progressivo com EXIF 1/6/8 e segmentos truncados. O preparador só adapta a
cópia de consulta até SOF0..SOF3; Blob, decode e hash usam o original. O ensaio
confere igualdade byte a byte do Blob retornado. EXIF não é transformado.
Inclui WebP de um/dois quadros,
ICO com múltiplas representações, SVG como imagem e cancelamento após decode.
ICO certifica apenas a representação selecionada pelo navegador. PNG/APNG não
certifica todos os quadros. Ausência de execução/rede em SVG no modo img não é
sanitização nem garantia ao abrir o arquivo como documento. Não mede paridade
visual de uma marca real, instalação PWA, upload ou publicação.
