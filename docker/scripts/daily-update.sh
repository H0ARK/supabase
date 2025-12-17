#!/bin/bash

###############################################################################
# TCGPlayer Daily Data Update Script
#
# This script downloads the latest TCGPlayer data from TCGCSV and updates
# the database with new products, groups, and price history.
#
# Usage:
#   ./daily-update.sh [--force] [--skip-prices] [--skip-history]
#
# Options:
#   --force          Force update even if data is recent
#   --skip-prices    Skip current price updates
#   --skip-history   Skip price history download
#   --date YYYY-MM-DD Download specific date's history
###############################################################################

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOCKER_ROOT="$(dirname "$SCRIPT_DIR")"
TCGCSV_DIR="$DOCKER_ROOT/tcgcsv"
PRICE_HISTORY_DIR="$TCGCSV_DIR/price-history"
TEMP_DIR="/tmp/tcgplayer-update"
LOG_FILE="$DOCKER_ROOT/logs/daily-update-$(date +%Y%m%d).log"

# Load environment from Supabase Docker .env
SUPABASE_ENV="$DOCKER_ROOT/.env"
if [ -f "$SUPABASE_ENV" ]; then
    source "$SUPABASE_ENV"
    export POSTGRES_PASSWORD
    export DB_PASSWORD="$POSTGRES_PASSWORD"
    export DB_USER="${DB_USER:-postgres}"
    export DB_NAME="${DB_NAME:-postgres}"
    export DB_HOST="${DB_HOST:-localhost}"
fi

# Fallback defaults (for Docker container usage)
DB_HOST="${DB_HOST:-localhost}"
DB_NAME="${DB_NAME:-postgres}"
DB_USER="${DB_USER:-postgres}"

# Parse arguments
FORCE_UPDATE=false
SKIP_PRICES=false
SKIP_HISTORY=false
SPECIFIC_DATE=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --force)
            FORCE_UPDATE=true
            shift
            ;;
        --skip-prices)
            SKIP_PRICES=true
            shift
            ;;
        --skip-history)
            SKIP_HISTORY=true
            shift
            ;;
        --date)
            SPECIFIC_DATE="$2"
            shift 2
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

# Add Bun to PATH for cron job execution
export PATH="$HOME/.bun/bin:$PATH"

# Logging functions
log_info() {
    echo -e "${GREEN}[INFO]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $1" | tee -a "$LOG_FILE"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $1" | tee -a "$LOG_FILE"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $1" | tee -a "$LOG_FILE"
}

log_step() {
    echo -e "\n${BLUE}===================================================${NC}" | tee -a "$LOG_FILE"
    echo -e "${BLUE}$1${NC}" | tee -a "$LOG_FILE"
    echo -e "${BLUE}===================================================${NC}\n" | tee -a "$LOG_FILE"
}

# Ensure directories exist
mkdir -p "$TCGCSV_DIR" "$PRICE_HISTORY_DIR" "$TEMP_DIR" "$(dirname "$LOG_FILE")"

log_step "Starting TCGPlayer Daily Update (Skipping categories 69-70: comics)"

###############################################################################
# Step 1: Check if update is needed
###############################################################################

check_last_update() {
    log_info "Checking last update time..."

    # Check TCGCSV's last-updated timestamp
    log_info "Checking TCGCSV last-updated.txt..."
    TCGCSV_LAST_UPDATE=$(curl -s https://tcgcsv.com/last-updated.txt)

    if [ -n "$TCGCSV_LAST_UPDATE" ]; then
        log_info "TCGCSV last updated: $TCGCSV_LAST_UPDATE"
        TCGCSV_TIMESTAMP=$(date -d "$TCGCSV_LAST_UPDATE" +%s 2>/dev/null || echo 0)
    else
        log_warn "Could not fetch TCGCSV last-updated.txt, continuing anyway..."
        TCGCSV_TIMESTAMP=0
    fi

    # Check our local last update time
    if [ -f "$TCGCSV_DIR/product-download-summary.json" ]; then
        LAST_UPDATE=$(jq -r '.downloadedAt' "$TCGCSV_DIR/product-download-summary.json")
        LAST_UPDATE_TIMESTAMP=$(date -d "$LAST_UPDATE" +%s 2>/dev/null || echo 0)
        CURRENT_TIMESTAMP=$(date +%s)
        HOURS_SINCE=$((($CURRENT_TIMESTAMP - $LAST_UPDATE_TIMESTAMP) / 3600))

        log_info "Our last update: $LAST_UPDATE ($HOURS_SINCE hours ago)"

        # If TCGCSV hasn't been updated since our last download, skip
        if [ $TCGCSV_TIMESTAMP -gt 0 ] && [ $LAST_UPDATE_TIMESTAMP -gt 0 ]; then
            if [ $TCGCSV_TIMESTAMP -le $LAST_UPDATE_TIMESTAMP ] && [ "$FORCE_UPDATE" = false ]; then
                log_warn "TCGCSV data hasn't been updated since our last download. Skipping."
                return 1
            fi
        fi

        # Also skip if we updated less than 12 hours ago (as a safety)
        if [ "$FORCE_UPDATE" = false ] && [ $HOURS_SINCE -lt 12 ]; then
            log_warn "Data was updated less than 12 hours ago. Use --force to override."
            return 1
        fi
    else
        log_info "No previous update found. Performing first-time download."
    fi

    return 0
}

if ! check_last_update; then
    log_info "Skipping update (data is recent)"
    exit 0
fi

###############################################################################
# Step 2: Incremental Product Sync from TCGCSV
###############################################################################

log_step "Step 1: Syncing Products from TCGCSV (Incremental)"

sync_products() {
    log_info "Running incremental product sync from tcgcsv.com..."
    cd "$PROJECT_ROOT"
    
    # Build sync command with options
    SYNC_ARGS=""
    if [ "$FORCE_UPDATE" = true ]; then
        SYNC_ARGS="--full"
    fi
    
    # Use npx tsx (works with Node.js) or fall back to bun if available
    if command -v bun &> /dev/null; then
        if bun run "$SCRIPT_DIR/sync-tcgcsv-products.ts" $SYNC_ARGS 2>&1 | tee -a "$LOG_FILE"; then
            log_info "✓ Product sync complete"
            return 0
        else
            log_error "✗ Product sync failed"
            return 1
        fi
    else
        if npx tsx "$SCRIPT_DIR/sync-tcgcsv-products.ts" $SYNC_ARGS 2>&1 | tee -a "$LOG_FILE"; then
            log_info "✓ Product sync complete"
            return 0
        else
            log_error "✗ Product sync failed"
            return 1
        fi
    fi
}

if ! sync_products; then
    log_error "Failed to sync products. Exiting."
    exit 1
fi

###############################################################################
# Step 3: Download Current Prices (DISABLED - Use archives only)
###############################################################################

# NOTE: Downloading from live API creates bloated files with wrapper JSON
# We rely on the archive downloads instead which are compressed and efficient
if [ "$SKIP_PRICES" = false ]; then
    log_info "Skipping live API price downloads (using archives only to avoid bloat)"
    log_info "Note: Categories 69 and 70 (comics) are excluded from all downloads"
else
    log_info "Skipping current prices download (--skip-prices)"
fi

###############################################################################
# Step 4: Download Price History Archive
###############################################################################

if [ "$SKIP_HISTORY" = false ]; then
    log_step "Step 3: Downloading Price History Archive"

    download_price_history() {
        # Determine which dates to download
        if [ -n "$SPECIFIC_DATE" ]; then
            DATES_TO_TRY=("$SPECIFIC_DATE")
            log_info "Downloading price history for specific date: $SPECIFIC_DATE"
        else
            # Try yesterday first (archives usually lag by 1-2 days), then last 3 days
            YESTERDAY=$(date -d "yesterday" +%Y-%m-%d)
            TWO_DAYS_AGO=$(date -d "2 days ago" +%Y-%m-%d)
            THREE_DAYS_AGO=$(date -d "3 days ago" +%Y-%m-%d)
            DATES_TO_TRY=("$YESTERDAY" "$TWO_DAYS_AGO" "$THREE_DAYS_AGO")
            log_info "Will try downloading: $YESTERDAY, $TWO_DAYS_AGO, $THREE_DAYS_AGO"
        fi

        # Try each date until we find one that works
        for TARGET_DATE in "${DATES_TO_TRY[@]}"; do
            # Check if already downloaded
            if [ -d "$PRICE_HISTORY_DIR/$TARGET_DATE" ] && [ "$FORCE_UPDATE" = false ]; then
                log_info "Price history for $TARGET_DATE already exists. Skipping."
                continue
            fi

            ARCHIVE_URL="https://tcgcsv.com/archive/tcgplayer/prices-$TARGET_DATE.ppmd.7z"
            ARCHIVE_FILE="$TEMP_DIR/prices-$TARGET_DATE.ppmd.7z"
            EXTRACT_DIR="$TEMP_DIR/extracted-$TARGET_DATE"

            # Download archive
            log_info "Downloading archive for $TARGET_DATE: $ARCHIVE_URL"

            # First check if archive exists with HEAD request
            HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -I "$ARCHIVE_URL")

            if [ "$HTTP_STATUS" != "200" ]; then
                log_warn "✗ Archive not available for $TARGET_DATE (HTTP $HTTP_STATUS, trying next date...)"
                continue
            fi

            # Archive exists, download it
            if curl -f -L -o "$ARCHIVE_FILE" "$ARCHIVE_URL" 2>&1 | tee -a "$LOG_FILE"; then
                ARCHIVE_SIZE=$(du -h "$ARCHIVE_FILE" 2>/dev/null | cut -f1)
                log_info "✓ Downloaded ${ARCHIVE_SIZE:-unknown size} archive"
            else
                log_warn "✗ Download failed for $TARGET_DATE (trying next date...)"
                rm -f "$ARCHIVE_FILE"
                continue
            fi

            # Check if 7z is installed
            if ! command -v 7z &> /dev/null; then
                log_error "7zip is not installed. Installing..."
                sudo apt-get update && sudo apt-get install -y p7zip-full
            fi

            # Extract archive
            log_info "Extracting archive..."
            mkdir -p "$EXTRACT_DIR"
            if 7z x "$ARCHIVE_FILE" -o"$EXTRACT_DIR" -y > /dev/null 2>&1; then
                log_info "✓ Archive extracted successfully"
            else
                log_error "✗ Failed to extract archive for $TARGET_DATE"
                rm -f "$ARCHIVE_FILE"
                rm -rf "$EXTRACT_DIR"
                continue
            fi

            # Move extracted data to price history directory
            if [ -d "$EXTRACT_DIR/$TARGET_DATE" ]; then
                log_info "Moving price data to $PRICE_HISTORY_DIR/$TARGET_DATE"
                mv "$EXTRACT_DIR/$TARGET_DATE" "$PRICE_HISTORY_DIR/"
                log_info "✓ Price history for $TARGET_DATE ready"
            else
                log_error "✗ Extracted directory not found for $TARGET_DATE"
                rm -f "$ARCHIVE_FILE"
                rm -rf "$EXTRACT_DIR"
                continue
            fi

            # Cleanup archive files
            rm -f "$ARCHIVE_FILE"
            rm -rf "$EXTRACT_DIR"

            log_info "✓ Successfully downloaded and extracted price history for $TARGET_DATE"

            # IMMEDIATELY import the data to database and delete files
            log_info "Importing $TARGET_DATE to database..."

            # Count files to import
            PRICE_FILE_COUNT=$(find "$PRICE_HISTORY_DIR/$TARGET_DATE" -name "prices" -type f 2>/dev/null | wc -l)
            log_info "Found $PRICE_FILE_COUNT price files to import for $TARGET_DATE"

            if [ $PRICE_FILE_COUNT -gt 0 ]; then
                # Set environment for import script and run it for this date only
                if TCGCSV_PATH="$TCGCSV_DIR" START_DATE="$TARGET_DATE" END_DATE="$TARGET_DATE" bun run "$PROJECT_ROOT/scripts/migrate-price-history.ts" 2>&1 | tee -a "$LOG_FILE"; then
                    log_info "✓ Imported $TARGET_DATE to database"

                    # Delete the imported files to save disk space
                    log_info "Deleting imported price files for $TARGET_DATE..."
                    rm -rf "$PRICE_HISTORY_DIR/$TARGET_DATE"
                    log_info "✓ Cleaned up $TARGET_DATE (data is now in database)"
                else
                    log_warn "✗ Failed to import $TARGET_DATE, keeping files for retry"
                fi
            else
                log_warn "No price files found in $TARGET_DATE, deleting empty directory"
                rm -rf "$PRICE_HISTORY_DIR/$TARGET_DATE"
            fi

            return 0
        done

        log_warn "Could not download price history for any of the attempted dates"
        return 1
    }

    download_price_history
else
    log_info "Skipping price history download (--skip-history)"
fi

###############################################################################
# Step 5: Import Price History to Database
###############################################################################

log_step "Step 4: Importing Price History to Database"

import_to_database() {
    # Note: Product metadata is now synced directly by sync-tcgcsv-products.ts
    # This step handles only price history import

    # Check for any remaining price history files (shouldn't be any after immediate import)
    if [ -d "$PRICE_HISTORY_DIR" ] && [ "$(ls -A $PRICE_HISTORY_DIR 2>/dev/null)" ]; then
        log_warn "Found leftover price history files (importing now)..."

        # Count files to import
        PRICE_FILE_COUNT=$(find "$PRICE_HISTORY_DIR" -name "prices" -type f | wc -l)
        log_info "Found $PRICE_FILE_COUNT leftover price files to import"

        if TCGCSV_PATH="$TCGCSV_DIR" bun run scripts/migrate-price-history.ts 2>&1 | tee -a "$LOG_FILE"; then
            log_info "✓ Leftover price history imported successfully"

            # Delete imported price history files to save disk space
            log_info "Cleaning up leftover price history files..."
            DATES_IMPORTED=$(ls "$PRICE_HISTORY_DIR" 2>/dev/null)
            for DATE_DIR in $DATES_IMPORTED; do
                if [ -d "$PRICE_HISTORY_DIR/$DATE_DIR" ]; then
                    log_info "  Removing $DATE_DIR..."
                    rm -rf "$PRICE_HISTORY_DIR/$DATE_DIR"
                fi
            done
            log_info "✓ Leftover price history files cleaned up"
        else
            log_warn "✗ Price history import had errors (check logs)"
            log_warn "  Keeping price history files for retry"
        fi
    else
        log_info "✓ No leftover price history files (all imported immediately)"
    fi

    return 0
}

if ! import_to_database; then
    log_error "Database import failed"
    exit 1
fi

###############################################################################
# Step 6: Update Database Statistics
###############################################################################

log_step "Step 5: Updating Database Statistics"

update_stats() {
    log_info "Running VACUUM ANALYZE on key tables..."

    docker exec card-db-postgres psql -U "$DB_USER" -d "$DB_NAME" -c "VACUUM ANALYZE products;" 2>&1 | tee -a "$LOG_FILE"
    docker exec card-db-postgres psql -U "$DB_USER" -d "$DB_NAME" -c "VACUUM ANALYZE price_history;" 2>&1 | tee -a "$LOG_FILE"

    log_info "✓ Database statistics updated"
}

update_stats

###############################################################################
# Step 7: Generate Summary Report
###############################################################################

log_step "Step 6: Generating Summary Report"

generate_report() {
    log_info "Collecting database statistics..."

    PRODUCT_COUNT=$(docker exec card-db-postgres psql -U "$DB_USER" -d "$DB_NAME" -t -c "SELECT COUNT(*) FROM products;" | tr -d ' ')
    PRICE_COUNT=$(docker exec card-db-postgres psql -U "$DB_USER" -d "$DB_NAME" -t -c "SELECT COUNT(*) FROM price_history;" | tr -d ' ')
    LATEST_PRICE_DATE=$(docker exec card-db-postgres psql -U "$DB_USER" -d "$DB_NAME" -t -c "SELECT MAX(recorded_at) FROM price_history;" | tr -d ' ')

    REPORT_FILE="$PROJECT_ROOT/logs/update-summary-$(date +%Y%m%d-%H%M%S).json"

    cat > "$REPORT_FILE" << EOF
{
  "timestamp": "$(date -Iseconds)",
  "success": true,
  "database": {
    "totalProducts": $PRODUCT_COUNT,
    "totalPriceRecords": $PRICE_COUNT,
    "latestPriceDate": "$LATEST_PRICE_DATE"
  },
  "downloads": {
    "metadata": "$(cat $TCGCSV_DIR/product-download-summary.json | jq -c .)",
    "priceHistoryDates": [
      $(find "$PRICE_HISTORY_DIR" -maxdepth 1 -type d -name "20*" -exec basename {} \; | sort | tail -5 | jq -R . | paste -sd,)
    ]
  }
}
EOF

    log_info "Summary report saved to: $REPORT_FILE"
    cat "$REPORT_FILE" | jq '.' | tee -a "$LOG_FILE"
}

generate_report

###############################################################################
# Cleanup
###############################################################################

log_step "Cleanup"

cleanup() {
    log_info "Removing temporary files..."
    rm -rf "$TEMP_DIR"

    # Keep only last 7 days of logs
    find "$PROJECT_ROOT/logs" -name "daily-update-*.log" -mtime +7 -delete

    log_info "✓ Cleanup complete"
}

cleanup

###############################################################################
# Final Summary
###############################################################################

log_step "Daily Update Complete"

DURATION=$(($(date +%s) - $CURRENT_TIMESTAMP))
DURATION_MIN=$((DURATION / 60))
DURATION_SEC=$((DURATION % 60))

log_info "Total duration: ${DURATION_MIN}m ${DURATION_SEC}s"
log_info "Products in database: $PRODUCT_COUNT"
log_info "Price records: $PRICE_COUNT"
log_info "Latest prices: $LATEST_PRICE_DATE"
log_info ""
log_info "Next steps:"
log_info "  - Check logs at: $LOG_FILE"
log_info "  - Verify API: curl https://api.rippzz.com/v2/products/42348"
log_info ""
log_info "To schedule this script daily, add to crontab:"
log_info "  0 2 * * * $SCRIPT_DIR/daily-update.sh >> $LOG_FILE 2>&1"
log_info ""
log_info "Categories downloaded: 1-68, 71-89 (skipping 69-70 which are comics)"

exit 0
