-- Banners: as 15 colunas que o formulario ja grava e o banco nunca teve.
--
-- Achado 1 da auditoria
-- docs/auditoria/2026-08-20-painel-banners-carrosseis-avaliacoes-qa-whatsapp-dashboard.md
-- (veredicto ABERTO no levantamento de 25/08): a tabela `banners` tem 8
-- colunas e o app grava 23 — `useBanners.ts` manda subtitle, cores, botao,
-- selo, modelo, produto e agendamento que nao existem no banco. Resultado:
-- NENHUM banner nasce ou edita pelo formulario desde fevereiro (erro ao
-- salvar, rascunho perdido); os 4 banners do ar sao manuais de 18/22-02.
--
-- As duas pontas ja estavam prontas: o formulario grava (useBanners) e a
-- loja desenha (BannerCarousel.tsx:129-215 — subtitulo, selo, botao,
-- overlay, cores e os modelos split/glassmorphic/neon). Faltava o meio:
-- esta migration. Tipos copiados do conferidor canonico
-- (src/types/supabase.ts:145-215), todos nullable: banner antigo continua
-- valido, banner novo pode usar só o que preencheu.
--
-- Expand puro (lote v3, condicao de entrada): só ADICIONA colunas
-- nullable; nada renomeia, nada aperta NOT NULL, nada remove. App antigo
-- sem as colunas segue funcionando; app novo passa a gravar de verdade.
--
-- SEM BEGIN/COMMIT (regra da casa). Faixa 20261000* a 20261009* da frente
-- cacador-b-dorso, reservada por escrito no _REGRAS.md ANTES de existir.
-- NAO aplicar sem prova de ROLLBACK (inteira E interrompida) e sem o
-- Gabriel autorizar NESTA sessao.
--
-- FICHA DE VERIFICACAO pos-aplicacao (por coluna, nunca por tela):
--   SELECT count(*) FROM information_schema.columns
--    WHERE table_name = 'banners' AND column_name IN (
--      'subtitle','subtitle_color','title_color','button_text',
--      'button_bg_color','button_text_color','font_family','overlay_color',
--      'overlay_opacity','badge_text','template_type','product_id',
--      'start_date','end_date','show_text_overlay');
--     -> espera 15
--   Painel: criar banner com subtitulo/selo/modelo -> recarregar ->
--     o banner volta COMPLETO (unico efeito observavel desta migration).

ALTER TABLE public.banners ADD COLUMN subtitle text;
ALTER TABLE public.banners ADD COLUMN subtitle_color text;
ALTER TABLE public.banners ADD COLUMN title_color text;
ALTER TABLE public.banners ADD COLUMN button_text text;
ALTER TABLE public.banners ADD COLUMN button_bg_color text;
ALTER TABLE public.banners ADD COLUMN button_text_color text;
ALTER TABLE public.banners ADD COLUMN font_family text;
ALTER TABLE public.banners ADD COLUMN overlay_color text;
ALTER TABLE public.banners ADD COLUMN overlay_opacity numeric;
ALTER TABLE public.banners ADD COLUMN badge_text text;
ALTER TABLE public.banners ADD COLUMN template_type text;
ALTER TABLE public.banners ADD COLUMN product_id uuid;
ALTER TABLE public.banners ADD COLUMN start_date timestamptz;
ALTER TABLE public.banners ADD COLUMN end_date timestamptz;
ALTER TABLE public.banners ADD COLUMN show_text_overlay boolean;
