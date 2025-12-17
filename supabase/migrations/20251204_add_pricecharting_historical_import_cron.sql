-- Add PriceCharting Historical Import Cron Job
DO $$
BEGIN
  -- Remove existing job if it exists
  PERFORM cron.unschedule('pricecharting-historical-import');
EXCEPTION WHEN OTHERS THEN
  NULL; -- Job doesn't exist, continue
END $$;

SELECT cron.schedule(
  'pricecharting-historical-import',
  '0 2 * * *', -- Daily at 2 AM
  $$
  SELECT net.http_post(
    -- Use internal Kong URL to avoid DNS/SSL issues
    url := 'http://kong:8000/functions/v1/import-pricecharting-csv',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      -- Service Role Key (should be rotated if exposed)
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIiwiaXNzIjoic3VwYWJhc2UiLCJpYXQiOjE3NjQwOTEyNDEsImV4cCI6MjA3OTQ1MTI0MX0.DmcwbbC8zUuDapUTgd9hTO5ThVw2rY7hTdmontLKcQ8'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 300000
  );
  $$
);

-- Update helper function to include new job
CREATE OR REPLACE FUNCTION list_marketplace_cron_jobs()
RETURNS TABLE (
  job_name TEXT,
  schedule TEXT,
  active BOOLEAN,
  last_run TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    j.jobname::TEXT,
    j.schedule::TEXT,
    j.active,
    (SELECT MAX(end_time) FROM cron.job_run_details WHERE jobid = j.jobid) as last_run
  FROM cron.job j
  WHERE j.jobname IN (
    'process-expired-auctions',
    'check-price-alerts',
    'expire-old-offers',
    'daily-cleanup',
    'daily-tcgcsv-price-import',
    'weekly-tcgcsv-backfill-check',
    'pricecharting-historical-import'
  )
  ORDER BY j.jobname;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION list_marketplace_cron_jobs() TO authenticated;
GRANT EXECUTE ON FUNCTION list_marketplace_cron_jobs() TO service_role;

-- Add local_image_url column to products table for local image storage
ALTER TABLE products ADD COLUMN IF NOT EXISTS local_image_url TEXT;

-- Update the example card (product 654517) with local path
UPDATE products SET local_image_url = '/public/3/24380/product_654517.webp' WHERE id = 654517;
