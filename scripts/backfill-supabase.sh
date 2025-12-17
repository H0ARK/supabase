#!/bin/bash

###############################################################################
# TCGCSV Price History Backfill Script for Supabase
#
# Downloads TCGCSV price archives and imports them into Supabase
#
# Usage:
#   ./backfill-supabase.sh [--start-date YYYY-MM-DD] [--end-date YYYY-MM-DD]
###############################################################################

set -e

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMP_DIR="/tmp/tcgcsv-backfill"
LOG_FILE="/tmp/tcgcsv-backfill-$(date +%Y%m%d-%H%M%S).log"

# Supabase connection (using Docker)
DB_CONTAINER="supabase-db"
DB_USER="postgres"
DB_NAME="postgres"

# Default date range
START_DATE="${1:-2025-11-16}"
END_DATE="${2:-2025-11-23}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $(date '+%H:%M:%S') - $1" | tee -a "$LOG_FILE"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $(date '+%H:%M:%S') - $1" | tee -a "$LOG_FILE"; }
log_error() { echo -e "${RED}[ERROR]${NC} $(date '+%H:%M:%S') - $1" | tee -a "$LOG_FILE"; }

mkdir -p "$TEMP_DIR"

log_info "Starting TCGCSV backfill: $START_DATE to $END_DATE"

# Generate list of dates
generate_dates() {
    local start="$1"
    local end="$2"
    local current="$start"
    while [[ "$current" < "$end" ]] || [[ "$current" == "$end" ]]; do
        echo "$current"
        current=$(date -d "$current + 1 day" +%Y-%m-%d)
    done
}

# Check which dates are missing
log_info "Checking for missing dates..."
MISSING_DATES=$(sudo docker exec $DB_CONTAINER psql -U $DB_USER -d $DB_NAME -t -c "
WITH date_series AS (
    SELECT generate_series('$START_DATE'::date, '$END_DATE'::date, INTERVAL '1 day')::date as check_date
),
existing_dates AS (
    SELECT DISTINCT recorded_at FROM price_history 
    WHERE recorded_at >= '$START_DATE' AND recorded_at <= '$END_DATE'
)
SELECT d.check_date 
FROM date_series d
LEFT JOIN existing_dates e ON d.check_date = e.recorded_at
WHERE e.recorded_at IS NULL
ORDER BY d.check_date;
" | tr -d ' ')

if [ -z "$MISSING_DATES" ]; then
    log_info "No missing dates found!"
    exit 0
fi

log_info "Missing dates:"
echo "$MISSING_DATES" | while read date; do
    [ -n "$date" ] && log_info "  - $date"
done

# Process each missing date
for TARGET_DATE in $MISSING_DATES; do
    [ -z "$TARGET_DATE" ] && continue
    
    log_info "Processing $TARGET_DATE..."
    
    ARCHIVE_URL="https://tcgcsv.com/archive/tcgplayer/prices-${TARGET_DATE}.ppmd.7z"
    ARCHIVE_FILE="$TEMP_DIR/prices-${TARGET_DATE}.ppmd.7z"
    EXTRACT_DIR="$TEMP_DIR/extracted-${TARGET_DATE}"
    
    # Check if archive exists
    HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -I "$ARCHIVE_URL")
    
    if [ "$HTTP_STATUS" != "200" ]; then
        log_warn "Archive not available for $TARGET_DATE (HTTP $HTTP_STATUS), skipping..."
        continue
    fi
    
    # Download archive
    log_info "Downloading archive for $TARGET_DATE..."
    if ! curl -f -L -o "$ARCHIVE_FILE" "$ARCHIVE_URL" 2>&1 | tee -a "$LOG_FILE"; then
        log_error "Failed to download archive for $TARGET_DATE"
        continue
    fi
    
    ARCHIVE_SIZE=$(du -h "$ARCHIVE_FILE" | cut -f1)
    log_info "Downloaded $ARCHIVE_SIZE archive"
    
    # Extract archive
    log_info "Extracting archive..."
    mkdir -p "$EXTRACT_DIR"
    if ! 7z x "$ARCHIVE_FILE" -o"$EXTRACT_DIR" -y > /dev/null 2>&1; then
        log_error "Failed to extract archive for $TARGET_DATE"
        rm -f "$ARCHIVE_FILE"
        continue
    fi
    
    # Count files
    PRICE_FILE_COUNT=$(find "$EXTRACT_DIR" -name "prices" -type f | wc -l)
    log_info "Found $PRICE_FILE_COUNT price files to import"
    
    # Import each price file
    IMPORTED=0
    ERRORS=0
    
    find "$EXTRACT_DIR" -name "prices" -type f | while read PRICE_FILE; do
        # Extract category and group from path
        # Path format: extracted-DATE/DATE/CATEGORY_ID/GROUP_ID/prices
        CATEGORY_ID=$(echo "$PRICE_FILE" | grep -oP '\d{4}-\d{2}-\d{2}/\K\d+(?=/)')
        GROUP_ID=$(echo "$PRICE_FILE" | grep -oP '\d{4}-\d{2}-\d{2}/\d+/\K\d+(?=/prices)')
        
        if [ -z "$CATEGORY_ID" ] || [ -z "$GROUP_ID" ]; then
            continue
        fi
        
        # Skip comics (categories 69-70)
        if [ "$CATEGORY_ID" = "69" ] || [ "$CATEGORY_ID" = "70" ]; then
            continue
        fi
        
        # Read and import prices using jq to transform JSON
        # Then pipe to psql for bulk insert
        cat "$PRICE_FILE" | jq -r '
            select(.success == true) | .results[] |
            [
                .productId,
                (.subTypeName // "Normal"),
                .lowPrice,
                .midPrice,
                .highPrice,
                .marketPrice,
                .directLowPrice
            ] | @tsv
        ' 2>/dev/null | while IFS=$'\t' read -r PRODUCT_ID VARIANT_NAME LOW MID HIGH MARKET DIRECT; do
            # Skip if no product ID
            [ -z "$PRODUCT_ID" ] && continue
            
            # This would need to be batched for efficiency
            # For now, we'll use a simpler approach below
        done 2>/dev/null || true
    done
    
    # Actually, let's use a more efficient approach - copy all data at once
    log_info "Importing prices for $TARGET_DATE using bulk insert..."
    
    # Create a temp table and use COPY for fast import
    # First, aggregate all price data into a CSV
    CSV_FILE="$TEMP_DIR/prices-${TARGET_DATE}.csv"
    
    find "$EXTRACT_DIR" -name "prices" -type f -exec cat {} \; | jq -r '
        select(.success == true) | .results[] |
        [
            .productId,
            (.subTypeName // "Normal"),
            (if .lowPrice != null and .lowPrice <= 327.67 then (.lowPrice * 100 | floor) else "" end),
            (if .midPrice != null and .midPrice <= 327.67 then (.midPrice * 100 | floor) else "" end),
            (if .highPrice != null and .highPrice <= 327.67 then (.highPrice * 100 | floor) else "" end),
            (if .marketPrice != null and .marketPrice <= 327.67 then (.marketPrice * 100 | floor) else "" end),
            (if .directLowPrice != null and .directLowPrice <= 327.67 then (.directLowPrice * 100 | floor) else "" end),
            (if .lowPrice != null and .lowPrice > 327.67 then .lowPrice else "" end),
            (if .midPrice != null and .midPrice > 327.67 then .midPrice else "" end),
            (if .highPrice != null and .highPrice > 327.67 then .highPrice else "" end),
            (if .marketPrice != null and .marketPrice > 327.67 then .marketPrice else "" end)
        ] | @csv
    ' 2>/dev/null > "$CSV_FILE" || true
    
    RECORD_COUNT=$(wc -l < "$CSV_FILE")
    log_info "Prepared $RECORD_COUNT records for import"
    
    if [ "$RECORD_COUNT" -gt 0 ]; then
        # Use \copy which works for any user (psql client-side copy)
        # First create the temp table
        sudo docker exec $DB_CONTAINER psql -U $DB_USER -d $DB_NAME -c "
        DROP TABLE IF EXISTS temp_prices_import;
        CREATE TABLE temp_prices_import (
            product_id int,
            variant_name text,
            low_price smallint,
            mid_price smallint,
            high_price smallint,
            market_price smallint,
            direct_low_price smallint,
            low_price_usd numeric,
            mid_price_usd numeric,
            high_price_usd numeric,
            market_price_usd numeric
        );
        " 2>&1 | tee -a "$LOG_FILE"
        
        # Use cat to pipe data through stdin (empty string = NULL)
        cat "$CSV_FILE" | sudo docker exec -i $DB_CONTAINER psql -U $DB_USER -d $DB_NAME -c "
        COPY temp_prices_import FROM STDIN WITH (FORMAT csv, FORCE_NULL (low_price, mid_price, high_price, market_price, direct_low_price, low_price_usd, mid_price_usd, high_price_usd, market_price_usd));
        " 2>&1 | tee -a "$LOG_FILE"
        
        # Now process the data
        sudo docker exec $DB_CONTAINER psql -U $DB_USER -d $DB_NAME -c "
        -- Ensure all variants exist
        INSERT INTO variants (name)
        SELECT DISTINCT variant_name FROM temp_prices_import
        WHERE variant_name IS NOT NULL
        ON CONFLICT (name) DO NOTHING;
        
        -- Remove existing records for this date to avoid duplicates (since no unique constraint)
        DELETE FROM price_history WHERE recorded_at = '$TARGET_DATE'::date;

        -- Insert into price_history
        INSERT INTO price_history (
            product_id, variant_id, recorded_at,
            low_price, mid_price, high_price, market_price, direct_low_price,
            low_price_usd, mid_price_usd, high_price_usd, market_price_usd
        )
        SELECT 
            t.product_id,
            v.id,
            '$TARGET_DATE'::date,
            t.low_price,
            t.mid_price,
            t.high_price,
            t.market_price,
            t.direct_low_price,
            t.low_price_usd,
            t.mid_price_usd,
            t.high_price_usd,
            t.market_price_usd
        FROM temp_prices_import t
        JOIN variants v ON v.name = t.variant_name
        JOIN products p ON p.id = t.product_id;
        
        -- Report how many were inserted
        SELECT 'Inserted ' || count(*) || ' records for $TARGET_DATE' 
        FROM price_history WHERE recorded_at = '$TARGET_DATE';

        -- Update import log
        UPDATE tcgcsv_import_log 
        SET status = 'completed', 
            completed_at = now(), 
            records_imported = (SELECT count(*) FROM price_history WHERE recorded_at = '$TARGET_DATE')
        WHERE target_date = '$TARGET_DATE'::date;
        " 2>&1 | tee -a "$LOG_FILE"
        
        log_info "✓ Imported prices for $TARGET_DATE"
    fi
    
    # Cleanup
    rm -f "$ARCHIVE_FILE" "$CSV_FILE"
    rm -rf "$EXTRACT_DIR"
    
    log_info "✓ Completed $TARGET_DATE"
done

# Cleanup temp directory
rm -rf "$TEMP_DIR"

# Summary
log_info "Backfill complete!"
log_info "Checking final state..."

sudo docker exec $DB_CONTAINER psql -U $DB_USER -d $DB_NAME -c "
SELECT recorded_at as date, count(*) as records
FROM price_history
WHERE recorded_at >= '$START_DATE' AND recorded_at <= '$END_DATE'
GROUP BY recorded_at
ORDER BY recorded_at;
"

log_info "Log file: $LOG_FILE"
