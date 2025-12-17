#!/usr/bin/env python3
"""
Automated script to download Korean Pokémon cards from Pokemon Korea CDN,
remove watermarks using Chutes API, and save as WebP files.

Processes cards from group ID 10102 backwards, naming files as product_{id}.webp
"""

import argparse
import os
import subprocess
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Dict, List, Optional

import requests


class KoreanCardDownloader:
    def __init__(
        self, output_dir: Path, chutes_token: str, supabase_url: str, supabase_key: str
    ):
        self.output_dir = output_dir
        self.chutes_token = chutes_token
        self.supabase_url = supabase_url
        self.supabase_key = supabase_key
        self.session = requests.Session()
        self.session.timeout = 30
        self.session.headers.update(
            {"apikey": supabase_key, "Authorization": f"Bearer {supabase_key}"}
        )

        # Create output directory
        self.output_dir.mkdir(parents=True, exist_ok=True)

    def get_korean_cards_data(
        self, start_group_id: int = 10102, limit: Optional[int] = None
    ) -> List[Dict]:
        """Get Korean card data from Supabase REST API - only truly Korean cards"""
        print("Fetching verified Korean cards...")

        # Get all Korean language links first (this guarantees Korean cards)
        korean_links = []
        page_size = 1000
        offset = 0
        try:
            while True:
                range_header = f"{offset}-{offset + page_size - 1}"
                lang_response = self.session.get(
                    f"{self.supabase_url}/rest/v1/card_language_links",
                    params={
                        "select": "synthetic_product_id,language_code",
                        "language_code": "eq.ko",
                        "synthetic_product_id": "gte.100000000",  # Only synthetic Korean products
                    },
                    headers={"Range": range_header},
                )
                lang_response.raise_for_status()
                batch = lang_response.json()
                if not batch:
                    break
                korean_links.extend(batch)
                if len(batch) < page_size:
                    break
                offset += page_size
        except requests.exceptions.RequestException as e:
            print(f"Failed to fetch Korean language links: {e}")
            return []

        if not korean_links:
            print("No Korean language links found")
            return []

        korean_product_ids = [link["synthetic_product_id"] for link in korean_links]
        print(f"Found {len(korean_product_ids)} verified Korean products")

        # Now get the product details for these verified Korean products
        all_products = []
        batch_size = 100

        for i in range(0, len(korean_product_ids), batch_size):
            batch_ids = korean_product_ids[i : i + batch_size]
            id_list = ",".join(map(str, batch_ids))

            prod_params = {
                "select": "id,group_id,card_number,groups(name,category_id)",
                "id": f"in.({id_list})",
                "order": "group_id.desc,card_number.asc",
            }

            if limit and len(all_products) >= limit:
                break

            if limit:
                remaining = limit - len(all_products)
                prod_params["limit"] = min(remaining, len(batch_ids))

            try:
                prod_response = self.session.get(
                    f"{self.supabase_url}/rest/v1/products", params=prod_params
                )
                prod_response.raise_for_status()
                batch_products = prod_response.json()

                all_products.extend(batch_products)

                if len(all_products) % 1000 == 0:
                    print(f"Fetched {len(all_products)} Korean cards...")

            except requests.exceptions.RequestException as e:
                print(f"Failed to fetch product batch {i//batch_size + 1}: {e}")
                continue

        # Count unique groups
        unique_groups = set(
            p.get("group_id") for p in all_products if p.get("group_id")
        )
        print(
            f"Found {len(all_products)} Korean cards across {len(unique_groups)} groups"
        )

        return all_products

    def extract_set_code(self, group_name: str) -> Optional[str]:
        """Extract set code from group name - preserves mixed case like SV9a"""
        if ":" in group_name:
            set_code = group_name.split(":")[0].strip()
            # Keep original casing - Korean CDN expects SV9a not SV9A
            # Only uppercase the letter portion, keep lowercase 'a' suffix
            import re
            match = re.match(r'^([A-Z]+)(\d+)([a-z]*)$', set_code, re.IGNORECASE)
            if match:
                letters, numbers, suffix = match.groups()
                return letters.upper() + numbers + suffix.lower()
            return set_code
        return None

    def get_cdn_era(self, set_code: str) -> Optional[str]:
        """Determine CDN era folder from set code"""
        if set_code.lower().startswith("sv"):
            return "SV"
        elif set_code.startswith("S") and not set_code.startswith("SM"):
            return "S"
        elif set_code.startswith("SM"):
            return "SM"
        elif set_code.startswith("M") or set_code.lower().startswith("m"):
            return "MEGA"
        elif set_code.startswith("XY"):
            return "XY"
        return None

    def build_cdn_url(self, era: str, set_code: str, card_number: str) -> str:
        """Build CDN URL for Korean card"""
        # Handle card numbers like "001/080" or "001" - extract the first part
        if "/" in card_number:
            card_num = card_number.split("/")[0]
        else:
            card_num = card_number

        # Format card number as 3-digit with leading zeros
        card_num = f"{int(card_num):03d}"
        return f"https://cards.image.pokemonkorea.co.kr/data/wmimages/{era}/{set_code}/{set_code}_{card_num}.png"

    def card_number_value(self, card_number: Optional[str]) -> int:
        """Numeric card number for ordering (gracefully handles missing/invalid)."""
        if not card_number:
            return -1
        try:
            base = card_number.split("/")[0]
            return int(base)
        except (ValueError, TypeError):
            return -1

    def download_card_image(self, url: str, product_id: int) -> Optional[Path]:
        """Download card image to temporary file and resize to 734x1024"""
        try:
            from PIL import Image
            import io
            
            response = self.session.get(url)
            response.raise_for_status()

            # Open image and resize to 734x1024
            img = Image.open(io.BytesIO(response.content))
            
            # Resize maintaining aspect ratio within 734x1024 bounds
            img.thumbnail((734, 1024), Image.Resampling.LANCZOS)
            
            # Save to temp file with unique name for parallel processing
            temp_file = (
                Path(tempfile.gettempdir())
                / f"korean_card_{product_id}_{os.getpid()}_{id(self)}.png"
            )
            img.save(temp_file, "PNG")

            return temp_file

        except requests.exceptions.RequestException as e:
            print(f"Failed to download {url}: {e}")
            return None
        except Exception as e:
            print(f"Failed to process image {url}: {e}")
            return None

    def process_with_watermark_removal(
        self, input_path: Path, output_path: Path
    ) -> bool:
        """Process image with watermark removal and convert to WebP"""
        cmd = [
            "/home/ubuntu/.venv-korean/bin/python3",
            "/home/ubuntu/chutes_remove_watermark.py",
            "--input",
            str(input_path),
            "--output",
            str(output_path),
            "--prompt",
            "remove the diagonal 'Pokemon Card Game' watermark text and reconstruct the card background seamlessly. do not alter other text or artwork.",
            "--steps",
            "6",
            "--cfg",
            "0",
            "--target",
            "1024",
            "--format",
            "WEBP",
            "--patch",
            "0,0,0,0",
        ]

        env = os.environ.copy()
        env["CHUTES_API_TOKEN"] = self.chutes_token

        try:
            result = subprocess.run(
                cmd, env=env, capture_output=True, text=True, timeout=300
            )
            if result.returncode == 0:
                print(f"Successfully processed {output_path}")
                return True
            else:
                print(f"Failed to process {input_path}: {result.stderr}")
                return False
        except subprocess.TimeoutExpired:
            print(f"Timeout processing {input_path}")
            return False
        except Exception as e:
            print(f"Error processing {input_path}: {e}")
            return False

    def convert_to_webp_75_quality(self, input_path: Path, output_path: Path) -> bool:
        """Convert processed image to WebP with 75 quality"""
        try:
            from PIL import Image

            # Open and convert to WebP with 75 quality
            img = Image.open(input_path)
            if img.mode != "RGB":
                img = img.convert("RGB")

            img.save(output_path, "WEBP", quality=75)
            print(f"Converted to WebP (75 quality): {output_path}")
            return True

        except Exception as e:
            print(f"Failed to convert {input_path} to WebP: {e}")
            return False

    def process_card(self, card_data: Dict) -> bool:
        """Process a single Korean card"""
        product_id = card_data["id"]
        group_id = card_data.get("group_id")
        card_number = card_data.get("card_number")
        group_data = card_data.get("groups", {})

        if not group_data or not group_data.get("name"):
            print(f"Missing group data for product {product_id}")
            return False

        group_name = group_data["name"]
        # Use the specific Pokemon Korea category (100087) for all Korean cards
        category_id = 100087

        # Check if output file already exists
        category_dir = self.output_dir / str(category_id) / str(group_id)
        final_file = category_dir / f"product_{product_id}.webp"

        if final_file.exists():
            print(f"Skipping product {product_id} (already exists: {final_file})")
            return True  # Consider this "successful" since file exists

        print(f"Processing product {product_id} (group {group_id}, card {card_number})")

        # Extract set code and determine era
        set_code = self.extract_set_code(group_name)
        if not set_code:
            print(f"Could not extract set code from {group_name}")
            return False

        era = self.get_cdn_era(set_code)
        if not era:
            print(f"Unsupported era for set code {set_code}")
            return False

        # Build URL and download
        url = self.build_cdn_url(era, set_code, card_number)
        temp_file = self.download_card_image(url, product_id)
        if not temp_file:
            return False

        # Process with watermark removal (this already outputs WebP)
        category_dir = self.output_dir / str(category_id) / str(group_id)
        category_dir.mkdir(parents=True, exist_ok=True)
        final_file = category_dir / f"product_{product_id}.webp"

        success = self.process_with_watermark_removal(temp_file, final_file)

        # Clean up temp file after processing is complete
        temp_file.unlink(missing_ok=True)

        return success

    def get_existing_product_ids(self) -> set:
        """Query Supabase storage to find already uploaded product IDs"""
        existing_ids = set()
        
        try:
            # Query storage.objects for existing Korean card images
            offset = 0
            page_size = 1000
            
            while True:
                range_header = f"{offset}-{offset + page_size - 1}"
                response = self.session.get(
                    f"{self.supabase_url}/rest/v1/storage.objects",
                    params={
                        "select": "name",
                        "bucket_id": "eq.card-images",
                        "name": "like.100087/%/product_%.webp"
                    },
                    headers={"Range": range_header}
                )
                response.raise_for_status()
                batch = response.json()
                
                if not batch:
                    break
                
                # Extract product IDs from names like "100087/100001/product_100000001.webp"
                for obj in batch:
                    name = obj.get("name", "")
                    if "product_" in name:
                        try:
                            product_id = int(name.split("product_")[1].replace(".webp", ""))
                            existing_ids.add(product_id)
                        except (ValueError, IndexError):
                            continue
                
                if len(batch) < page_size:
                    break
                offset += page_size
            
            print(f"Found {len(existing_ids)} cards in storage")
            
        except Exception as e:
            print(f"Warning: Could not query storage for existing cards: {e}")
            print("Will continue but may reprocess some cards")
        
        return existing_ids

    def run(
        self,
        start_group_id: int = 10102,
        limit: Optional[int] = None,
        max_workers: int = 4,
        set_codes: Optional[List[str]] = None,
        group_ids: Optional[List[int]] = None,
    ):
        """Main processing function with parallel execution"""
        print(
            f"Starting Korean card download and processing from group {start_group_id} (parallel: {max_workers} workers)"
        )

        # Get existing product IDs to skip
        print("Scanning for existing cards...")
        existing_ids = self.get_existing_product_ids()
        print(f"Found {len(existing_ids)} cards already processed, will skip these")

        # Get card data
        cards_data = self.get_korean_cards_data(start_group_id, limit)

        if not cards_data:
            print("No Korean cards found to process")
            return

        # Filter out cards that already exist
        cards_data = [card for card in cards_data if card["id"] not in existing_ids]
        print(f"After filtering existing cards: {len(cards_data)} cards remaining to process")

        # Optional filter by set code (e.g., M1L, M1S, SV2A, ...)
        if set_codes:
            normalized = {code.upper() for code in set_codes}
            filtered = []
            for card in cards_data:
                group = card.get("groups") or {}
                gname = group.get("name") if isinstance(group, dict) else None
                sc = self.extract_set_code(gname or "")
                if sc and sc.upper() in normalized:
                    filtered.append(card)
            print(
                f"Filtered to {len(filtered)} cards matching set codes {sorted(normalized)} (from {len(cards_data)} total)"
            )
            cards_data = filtered

        # Optional filter by group IDs
        if group_ids:
            filtered = [
                card for card in cards_data if card.get("group_id") in group_ids
            ]
            print(
                f"Filtered to {len(filtered)} cards matching group IDs {sorted(group_ids)} (from {len(cards_data)} total)"
            )
            cards_data = filtered

        # Always process newest first: higher group_id, then card number, then product ID
        cards_data.sort(
            key=lambda card: (
                card.get("group_id") if card.get("group_id") is not None else -1,
                self.card_number_value(card.get("card_number")),
                card.get("id", -1),
            ),
            reverse=True,
        )
        print("Processing Korean cards newest first (descending order).")

        print(f"Found {len(cards_data)} Korean cards to process")

        success_count = 0
        failed_count = 0

        # Process cards in parallel
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            # Submit all tasks
            future_to_card = {
                executor.submit(self.process_card, card_data): card_data
                for card_data in cards_data
            }

            # Process completed tasks as they finish
            for future in as_completed(future_to_card):
                card_data = future_to_card[future]
                product_id = card_data["id"]

                try:
                    result = future.result()
                    if result:
                        success_count += 1
                        print(f"✅ Completed: {product_id}")
                    else:
                        failed_count += 1
                        print(f"❌ Failed: {product_id}")
                except Exception as e:
                    failed_count += 1
                    print(f"❌ Exception processing {product_id}: {e}")

        print(
            f"Processing complete: {success_count} successful, {failed_count} failed, {len(cards_data)} total"
        )


def main():
    parser = argparse.ArgumentParser(
        description="Download and process Korean Pokémon cards"
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path(
            "/Users/conrad/Documents/GitHub/card-trader/data/korean-card-images"
        ),
        help="Output directory for processed images",
    )
    parser.add_argument(
        "--start-group-id",
        type=int,
        default=10102,
        help="Starting group ID to process from (backwards)",
    )
    parser.add_argument(
        "--limit", type=int, help="Limit number of cards to process (for testing)"
    )
    parser.add_argument(
        "--max-workers",
        type=int,
        default=4,
        help="Maximum number of parallel workers (default: 4)",
    )
    parser.add_argument(
        "--set-codes",
        type=lambda s: [code.strip().upper() for code in s.split(",") if code.strip()],
        help="Comma-separated set codes to filter (e.g., M1L,M1S,SV2A)",
    )
    parser.add_argument(
        "--group-ids",
        type=lambda s: [int(gid.strip()) for gid in s.split(",") if gid.strip()],
        help="Comma-separated group IDs to filter (e.g., 100044,100076)",
    )
    parser.add_argument(
        "--supabase-url", default="https://api.rippzz.com", help="Supabase API URL"
    )
    parser.add_argument(
        "--supabase-key",
        default="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzY0MDkxMjQxLCJleHAiOjIwNzk0NTEyNDF9.ojsQD2cUXN8YHQa6cw55uMKu3iEfgVKUW4dG96tIc4I",
        help="Supabase anonymous key",
    )

    args = parser.parse_args()

    chutes_token = os.getenv("CHUTES_API_TOKEN")
    if not chutes_token:
        print("Error: CHUTES_API_TOKEN environment variable not set")
        sys.exit(1)

    downloader = KoreanCardDownloader(
        args.output_dir, chutes_token, args.supabase_url, args.supabase_key
    )
    downloader.run(
        args.start_group_id,
        args.limit,
        args.max_workers,
        args.set_codes,
        args.group_ids,
    )


if __name__ == "__main__":
    main()
