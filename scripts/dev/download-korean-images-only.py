#!/usr/bin/env python3
"""
Download Korean Pokémon card images from Pokemon Korea CDN without processing.
Just downloads and resizes to 734x1024 for later batch processing.
"""

import argparse
import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Dict, List, Optional

import requests
from PIL import Image
import io


class KoreanCardDownloader:
    def __init__(self, output_dir: Path, supabase_url: str, supabase_key: str):
        self.output_dir = output_dir
        self.supabase_url = supabase_url
        self.supabase_key = supabase_key
        self.session = requests.Session()
        self.session.timeout = 30
        self.session.headers.update(
            {"apikey": supabase_key, "Authorization": f"Bearer {supabase_key}"}
        )

        # Create output directory
        self.output_dir.mkdir(parents=True, exist_ok=True)

    def get_existing_product_ids(self) -> set:
        """Query Supabase storage to find already uploaded product IDs"""
        existing_ids = set()
        
        try:
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
            
            print(f"Found {len(existing_ids)} cards already in storage")
            
        except Exception as e:
            print(f"Warning: Could not query storage: {e}")
        
        return existing_ids

    def get_korean_cards_data(
        self, start_group_id: int = 10102, limit: Optional[int] = None
    ) -> List[Dict]:
        """Get Korean card data from Supabase REST API"""
        print("Fetching verified Korean cards...")

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
                        "synthetic_product_id": "gte.100000000",
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
                print(f"Failed to fetch product batch: {e}")
                continue

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
        if "/" in card_number:
            card_num = card_number.split("/")[0]
        else:
            card_num = card_number

        card_num = f"{int(card_num):03d}"
        return f"https://cards.image.pokemonkorea.co.kr/data/wmimages/{era}/{set_code}/{set_code}_{card_num}.png"

    def download_card(self, card_data: Dict) -> bool:
        """Download a single card image"""
        product_id = card_data["id"]
        group_id = card_data.get("group_id")
        card_number = card_data.get("card_number")
        group_data = card_data.get("groups", {})

        if not group_data or not group_data.get("name"):
            print(f"Missing group data for product {product_id}")
            return False

        group_name = group_data["name"]
        category_id = 100087

        # Check if already exists locally
        category_dir = self.output_dir / str(category_id) / str(group_id)
        output_file = category_dir / f"product_{product_id}.png"

        if output_file.exists():
            return True

        # Extract set code and build URL
        set_code = self.extract_set_code(group_name)
        if not set_code:
            print(f"Could not extract set code from {group_name}")
            return False

        era = self.get_cdn_era(set_code)
        if not era:
            print(f"Unsupported era for set code {set_code}")
            return False

        url = self.build_cdn_url(era, set_code, card_number)

        try:
            response = self.session.get(url)
            response.raise_for_status()

            # Resize to 734x1024
            img = Image.open(io.BytesIO(response.content))
            img.thumbnail((734, 1024), Image.Resampling.LANCZOS)

            # Save as PNG
            category_dir.mkdir(parents=True, exist_ok=True)
            img.save(output_file, "PNG")

            print(f"✅ Downloaded: {product_id}")
            return True

        except Exception as e:
            print(f"❌ Failed {product_id}: {e}")
            return False

    def run(self, max_workers: int = 8, limit: Optional[int] = None):
        """Main download function"""
        print(f"Starting Korean card download (parallel: {max_workers} workers)")

        # Get existing cards from storage
        print("Checking storage for existing cards...")
        existing_ids = self.get_existing_product_ids()

        # Get card data
        cards_data = self.get_korean_cards_data(10102, limit)

        if not cards_data:
            print("No Korean cards found to process")
            return

        # Filter out existing cards
        cards_data = [card for card in cards_data if card["id"] not in existing_ids]
        print(f"After filtering: {len(cards_data)} cards to download")

        if not cards_data:
            print("All cards already exist!")
            return

        # Sort newest first
        cards_data.sort(
            key=lambda card: (
                card.get("group_id") if card.get("group_id") is not None else -1,
                card.get("id", -1),
            ),
            reverse=True,
        )

        success_count = 0
        failed_count = 0

        # Download in parallel
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            future_to_card = {
                executor.submit(self.download_card, card_data): card_data
                for card_data in cards_data
            }

            for future in as_completed(future_to_card):
                try:
                    if future.result():
                        success_count += 1
                    else:
                        failed_count += 1
                except Exception as e:
                    failed_count += 1
                    print(f"Exception: {e}")

        print(f"\nComplete: {success_count} downloaded, {failed_count} failed")


def main():
    parser = argparse.ArgumentParser(description="Download Korean Pokémon cards")
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("/home/ubuntu/korean-card-images"),
        help="Output directory for images",
    )
    parser.add_argument(
        "--limit", type=int, help="Limit number of cards (for testing)"
    )
    parser.add_argument(
        "--max-workers",
        type=int,
        default=8,
        help="Maximum parallel workers",
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

    downloader = KoreanCardDownloader(
        args.output_dir, args.supabase_url, args.supabase_key
    )
    downloader.run(args.max_workers, args.limit)


if __name__ == "__main__":
    main()
