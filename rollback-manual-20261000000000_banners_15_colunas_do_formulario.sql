-- ROLLBACK MANUAL de 20261000000000_banners_15_colunas_do_formulario.sql
--
-- Remove as 15 colunas adicionadas. CUSTO DECLARADO do rollback: banner
-- criado/editado ENTRE a aplicacao e o rollback perde os campos ricos
-- (subtitulo, cores, botao, selo, modelo, produto, agendamento) — as 8
-- colunas originais (id, image_url, title, link, position, active, order,
-- created_at) e os banners antigos seguem intactos. Como a tela so passou
-- a salvar DEPOIS da migration, tudo que ela gravou depende das colunas
-- novas; voltar atras e perder esses campos, e isso esta dito aqui em vez
-- de descoberto na hora.
--
-- Ordem unica, sem dependencia entre os DROPs — qualquer interrupcao no
-- meio deixa a migration parcialmente revertida, e rodar o resto do
-- arquivo conclui (DROP COLUMN IF EXISTS aceita reexecucao).

-- RESTAURA: as 15 colunas de banners (DROP COLUMN de volta ao schema de 8).
-- NAO RESTAURA: dado gravado nas 15 colunas entre apply e rollback
-- (banner criado/editado no periodo perde os campos ricos - custo
-- ja declarado acima); as 8 colunas originais e seus dados, intactos.
-- ALCANCE: so-DDL. Sem DML.

ALTER TABLE public.banners DROP COLUMN IF EXISTS subtitle;
ALTER TABLE public.banners DROP COLUMN IF EXISTS subtitle_color;
ALTER TABLE public.banners DROP COLUMN IF EXISTS title_color;
ALTER TABLE public.banners DROP COLUMN IF EXISTS button_text;
ALTER TABLE public.banners DROP COLUMN IF EXISTS button_bg_color;
ALTER TABLE public.banners DROP COLUMN IF EXISTS button_text_color;
ALTER TABLE public.banners DROP COLUMN IF EXISTS font_family;
ALTER TABLE public.banners DROP COLUMN IF EXISTS overlay_color;
ALTER TABLE public.banners DROP COLUMN IF EXISTS overlay_opacity;
ALTER TABLE public.banners DROP COLUMN IF EXISTS badge_text;
ALTER TABLE public.banners DROP COLUMN IF EXISTS template_type;
ALTER TABLE public.banners DROP COLUMN IF EXISTS product_id;
ALTER TABLE public.banners DROP COLUMN IF EXISTS start_date;
ALTER TABLE public.banners DROP COLUMN IF EXISTS end_date;
ALTER TABLE public.banners DROP COLUMN IF EXISTS show_text_overlay;
