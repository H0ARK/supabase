-- Create the card_grid_hashes table for image recognition
CREATE TABLE IF NOT EXISTS public.card_grid_hashes (
    id BIGSERIAL PRIMARY KEY,
    product_id INTEGER NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    cell_index SMALLINT NOT NULL, -- 0-15 for a 4x4 grid
    hash_value BIGINT NOT NULL,   -- 64-bit perceptual hash
    variant_type TEXT NOT NULL,   -- 'original', 'glare', 'low_light', 'noise'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for fast lookups by hash value and cell index
CREATE INDEX IF NOT EXISTS idx_card_grid_hashes_lookup 
ON public.card_grid_hashes (hash_value, cell_index);

-- Index for product_id to speed up deletions/updates
CREATE INDEX IF NOT EXISTS idx_card_grid_hashes_product_id 
ON public.card_grid_hashes (product_id);

-- Add comment to the table
COMMENT ON TABLE public.card_grid_hashes IS 'Stores 4x4 grid perceptual hashes for Pokemon cards, including synthetic variants for robust recognition.';
