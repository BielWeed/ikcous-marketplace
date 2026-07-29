-- Migration: Add weight and dimensions to produtos table
-- 20260708090000_add_product_dimensions.sql

BEGIN;

-- Add weight and dimensions to public.produtos table
ALTER TABLE public.produtos
ADD COLUMN IF NOT EXISTS peso_kg numeric DEFAULT 0.3 CONSTRAINT check_peso_positive CHECK (
    peso_kg >= 0
),
ADD COLUMN IF NOT EXISTS largura_cm numeric DEFAULT 15 CONSTRAINT check_largura_positive CHECK (
    largura_cm >= 0
),
ADD COLUMN IF NOT EXISTS altura_cm numeric DEFAULT 15 CONSTRAINT check_altura_positive CHECK (
    altura_cm >= 0
),
ADD COLUMN IF NOT EXISTS comprimento_cm numeric DEFAULT 15 CONSTRAINT check_comprimento_positive CHECK (
    comprimento_cm >= 0
);

-- Document changes on the table columns
COMMENT ON COLUMN public.produtos.peso_kg IS 'Peso do produto em quilogramas (kg) para cálculo de frete.';
COMMENT ON COLUMN public.produtos.largura_cm IS 'Largura da embalagem do produto em centímetros (cm) para cálculo de frete.';
COMMENT ON COLUMN public.produtos.altura_cm IS 'Altura da embalagem do produto em centímetros (cm) para cálculo de frete.';
COMMENT ON COLUMN public.produtos.comprimento_cm IS 'Comprimento da embalagem do produto em centímetros (cm) para cálculo de frete.';

COMMIT;
