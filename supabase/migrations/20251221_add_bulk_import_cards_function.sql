-- Create bulk_import_cards function for importing multiple cards at once
-- This function handles CSV-style imports with product name lookups

CREATE OR REPLACE FUNCTION bulk_import_cards(
  p_user_id uuid,
  p_portfolio_id uuid DEFAULT NULL,
  p_cards jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  card_record jsonb;
  product_name text;
  set_name text;
  card_number text;
  card_condition text;
  quantity integer;
  average_cost_paid numeric;
  date_added date;
  grade_company text;
  variance text;
  product_id integer;
  variant_id integer := 1; -- Default to Normal
  existing_record record;
  inserted_count integer := 0;
  updated_count integer := 0;
  error_count integer := 0;
  errors jsonb := '[]'::jsonb;
BEGIN
  -- Validate input
  IF p_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'User ID is required'
    );
  END IF;

  IF p_cards IS NULL OR jsonb_array_length(p_cards) = 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Cards array is required and cannot be empty'
    );
  END IF;

  -- Process each card
  FOR card_record IN SELECT * FROM jsonb_array_elements(p_cards)
  LOOP
    BEGIN
      -- Extract fields from the card record
      product_name := card_record->>'Product Name';
      set_name := card_record->>'Set';
      card_number := card_record->>'Card Number';
      card_condition := card_record->>'Card Condition';
      quantity := (card_record->>'Quantity')::integer;
      average_cost_paid := (card_record->>'Average Cost Paid')::numeric;
      date_added := (card_record->>'Date Added')::date;
      grade_company := card_record->>'Grade Company';
      variance := card_record->>'Variance';

      -- Validate required fields
      IF product_name IS NULL OR set_name IS NULL THEN
        errors := errors || jsonb_build_object(
          'card', card_record,
          'error', 'Product Name and Set are required'
        );
        error_count := error_count + 1;
        CONTINUE;
      END IF;

      -- Find the product_id by matching name, set, and optionally card number
      SELECT p.id INTO product_id
      FROM products p
      JOIN groups g ON g.id = p.group_id
      WHERE p.name ILIKE '%' || product_name || '%'
        AND g.name ILIKE '%' || set_name || '%'
        AND (card_number IS NULL OR p.card_number = card_number)
      ORDER BY
        CASE WHEN p.card_number = card_number THEN 1 ELSE 2 END,
        p.name ILIKE product_name DESC,
        g.name ILIKE set_name DESC
      LIMIT 1;

      IF product_id IS NULL THEN
        errors := errors || jsonb_build_object(
          'card', card_record,
          'error', format('Product not found: %s from set %s', product_name, set_name)
        );
        error_count := error_count + 1;
        CONTINUE;
      END IF;

      -- Determine variant_id based on variance field
      IF variance IS NOT NULL THEN
        -- Map common variance descriptions to variant IDs
        CASE
          WHEN variance ILIKE '%reverse holo%' THEN variant_id := 3; -- Reverse Holofoil
          WHEN variance ILIKE '%holo%' AND variance NOT ILIKE '%reverse%' THEN variant_id := 2; -- Holofoil
          WHEN variance ILIKE '%1st edition%' THEN variant_id := 4; -- 1st Edition
          WHEN variance ILIKE '%master ball%' THEN variant_id := 5; -- Special variants
          WHEN variance ILIKE '%poke ball%' THEN variant_id := 6;
          ELSE variant_id := 1; -- Normal
        END CASE;
      END IF;

      -- Check if this card already exists in the user's collection
      SELECT * INTO existing_record
      FROM user_collections
      WHERE user_id = p_user_id
        AND tcgplayer_product_id = product_id
        AND card_variant_id = variant_id
        AND (portfolio_id = p_portfolio_id OR (portfolio_id IS NULL AND p_portfolio_id IS NULL));

      IF existing_record.id IS NOT NULL THEN
        -- Update existing record
        UPDATE user_collections
        SET
          quantity = quantity + existing_record.quantity,
          condition = COALESCE(card_condition, condition),
          acquired_date = COALESCE(date_added, acquired_date),
          purchase_price = COALESCE(average_cost_paid, purchase_price),
          grade_company = COALESCE(grade_company, grade_company),
          updated_at = now()
        WHERE id = existing_record.id;

        updated_count := updated_count + 1;
      ELSE
        -- Insert new record
        INSERT INTO user_collections (
          user_id,
          portfolio_id,
          tcgplayer_product_id,
          card_variant_id,
          quantity,
          condition,
          acquired_date,
          purchase_price,
          grade_company
        ) VALUES (
          p_user_id,
          p_portfolio_id,
          product_id,
          variant_id,
          quantity,
          card_condition,
          date_added,
          average_cost_paid,
          grade_company
        );

        inserted_count := inserted_count + 1;
      END IF;

    EXCEPTION WHEN OTHERS THEN
      errors := errors || jsonb_build_object(
        'card', card_record,
        'error', SQLERRM
      );
      error_count := error_count + 1;
    END;
  END LOOP;

  -- Return results
  RETURN jsonb_build_object(
    'success', true,
    'inserted', inserted_count,
    'updated', updated_count,
    'errors', error_count,
    'error_details', errors
  );

END;
$$;

-- Add comment
COMMENT ON FUNCTION bulk_import_cards IS 'Bulk import cards from CSV-style data. Matches products by name/set/card number and handles variant detection.';</content>
<parameter name="filePath">/home/ubuntu/supabase/supabase/migrations/20251221_add_bulk_import_cards_function.sql