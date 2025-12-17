#!/usr/bin/env python3
"""
Download Simplified Chinese Pokemon card images from Collectr CDN.
Downloads only - no database registration. 
Files will be registered separately using Node.js scripts.
"""

import json
import os
import requests
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
import io
from PIL import Image

# Configuration
COLLECTR_JSON_PATH = "/home/ubuntu/collectr_chinese_products_latest.json"
STORAGE_BASE_PATH = "/home/ubuntu/supabase/docker/volumes/storage/stub/stub/card-images"

# Synthetic product ID range for Chinese cards (category 100086)
# Using 200000000+ range to avoid conflicts with Korean (100000000+) and Japanese (existing)
SYNTHETIC_ID_BASE = 200000000

# Number of concurrent workers
MAX_WORKERS = 16

def load_chinese_products():
    """Load Chinese products from JSON file."""
    print(f"Loading Chinese products from {COLLECTR_JSON_PATH}...")
    
    with open(COLLECTR_JSON_PATH, 'r', encoding='utf-8') as f:
        products = json.load(f)
    
    # Get unique products (deduplicate by id, since there are multiple entries per card for variants)
    unique_products = {}
    for product in products:
        product_id = product['id']
        if product_id not in unique_products:
            unique_products[product_id] = product
    
    products_list = list(unique_products.values())
    print(f"Loaded {len(products_list)} unique Chinese products from {len(set(p['group_id'] for p in products_list))} sets")
    
    return products_list

def get_existing_files():
    """Check which files already exist in storage."""
    print("Checking for existing Chinese card images...")
    
    existing_ids = set()
    storage_path = Path(STORAGE_BASE_PATH)
    
    if storage_path.exists():
        for file in storage_path.glob("*.webp"):
            try:
                file_id = int(file.stem)
                if file_id >= SYNTHETIC_ID_BASE:
                    existing_ids.add(file_id)
            except ValueError:
                continue
    
    print(f"Found {len(existing_ids)} existing Chinese card images")
    return existing_ids

def download_and_convert_image(image_url, output_path, target_width=734, target_height=1024):
    """
    Download image from URL and convert to WebP format.
    Resizes to fit within target dimensions while maintaining aspect ratio.
    """
    try:
        # Download image
        response = requests.get(image_url, timeout=30)
        response.raise_for_status()
        
        # Load image with PIL
        img = Image.open(io.BytesIO(response.content))
        
        # Convert RGBA to RGB if necessary
        if img.mode in ('RGBA', 'LA', 'P'):
            background = Image.new('RGB', img.size, (255, 255, 255))
            if img.mode == 'P':
                img = img.convert('RGBA')
            background.paste(img, mask=img.split()[-1] if img.mode in ('RGBA', 'LA') else None)
            img = background
        
        # Calculate resize dimensions to fit within target while maintaining aspect ratio
        img_width, img_height = img.size
        aspect_ratio = img_width / img_height
        target_aspect = target_width / target_height
        
        if aspect_ratio > target_aspect:
            # Image is wider than target
            new_width = target_width
            new_height = int(target_width / aspect_ratio)
        else:
            # Image is taller than target
            new_height = target_height
            new_width = int(target_height * aspect_ratio)
        
        # Resize image
        img = img.resize((new_width, new_height), Image.Resampling.LANCZOS)
        
        # Ensure output directory exists
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        
        # Save as WebP with high quality
        img.save(output_path, 'WEBP', quality=85, method=6)
        
        return True, os.path.getsize(output_path)
    
    except Exception as e:
        return False, str(e)

def process_product(product, existing_ids):
    """Process a single Chinese product: download and convert."""
    collectr_id = product['id']
    synthetic_id = SYNTHETIC_ID_BASE + collectr_id
    
    # Skip if already exists
    if synthetic_id in existing_ids:
        return {'status': 'skipped', 'product_id': collectr_id}
    
    group_id = product['group_id']
    card_number = product['card_number']
    image_url = product['image_url']
    product_name = product['product_name']
    
    # Download and convert image
    output_path = os.path.join(STORAGE_BASE_PATH, f"{synthetic_id}.webp")
    
    success, result = download_and_convert_image(image_url, output_path)
    
    if not success:
        return {'status': 'failed', 'product_id': collectr_id, 'error': str(result)}
    
    file_size = result
    
    return {
        'status': 'success',
        'product_id': collectr_id,
        'synthetic_id': synthetic_id,
        'card': f"{product_name} ({card_number})",
        'group_id': group_id,
        'size': file_size
    }

def main():
    """Main execution function."""
    print("=" * 80)
    print("Chinese Pokemon Card Image Downloader (Download-Only)")
    print("=" * 80)
    print(f"Started at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print()
    
    # Load products from JSON
    products = load_chinese_products()
    
    # Get existing files
    existing_ids = get_existing_files()
    
    # Filter products to process (only those not already downloaded)
    products_to_process = [
        p for p in products
        if (SYNTHETIC_ID_BASE + p['id']) not in existing_ids
    ]
    
    print(f"\nProducts to process: {len(products_to_process)}")
    print(f"Products to skip (already exist): {len(products) - len(products_to_process)}")
    print()
    
    if not products_to_process:
        print("No products to process. All Chinese cards are already downloaded.")
        return
    
    # Process products concurrently
    results = {
        'success': 0,
        'failed': 0,
        'skipped': 0,
        'errors': []
    }
    
    print(f"Starting download with {MAX_WORKERS} workers...")
    print()
    
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        future_to_product = {
            executor.submit(process_product, product, existing_ids): product
            for product in products_to_process
        }
        
        for i, future in enumerate(as_completed(future_to_product), 1):
            result = future.result()
            status = result['status']
            
            results[status] += 1
            
            if status == 'success':
                print(f"[{i}/{len(products_to_process)}] ✓ Downloaded: {result['card']} → {result['synthetic_id']}.webp ({result['size']} bytes)")
            elif status == 'failed':
                print(f"[{i}/{len(products_to_process)}] ✗ Failed: Product {result['product_id']} - {result.get('error', 'unknown')}")
                results['errors'].append(result)
            else:  # skipped
                print(f"[{i}/{len(products_to_process)}] ⊘ Skipped: Product {result['product_id']}")
    
    # Print summary
    print()
    print("=" * 80)
    print("Download Summary")
    print("=" * 80)
    print(f"Total products: {len(products_to_process)}")
    print(f"✓ Success: {results['success']}")
    print(f"✗ Failed: {results['failed']}")
    print(f"⊘ Skipped: {results['skipped']}")
    print()
    
    # Save mapping file for database registration
    if results['success'] > 0:
        mapping_file = "/home/ubuntu/chinese-cards-mapping.json"
        mapping_data = []
        
        # Rebuild mapping from all products
        for product in products:
            collectr_id = product['id']
            synthetic_id = SYNTHETIC_ID_BASE + collectr_id
            file_path = os.path.join(STORAGE_BASE_PATH, f"{synthetic_id}.webp")
            
            if os.path.exists(file_path):
                mapping_data.append({
                    "collectr_id": collectr_id,
                    "synthetic_id": synthetic_id,
                    "group_id": product['group_id'],
                    "card_number": product['card_number'],
                    "product_name": product['product_name'],
                    "file_size": os.path.getsize(file_path)
                })
        
        with open(mapping_file, 'w', encoding='utf-8') as f:
            json.dump(mapping_data, f, indent=2)
        
        print(f"Saved mapping data to: {mapping_file}")
        print(f"Total cards in mapping: {len(mapping_data)}")
        print()
    
    print(f"Completed at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 80)
    
    if results['errors']:
        print()
        print(f"Failed products ({len(results['errors'])}):")
        for error in results['errors'][:10]:  # Show first 10 errors
            print(f"  - Product {error['product_id']}: {error.get('error', 'unknown')}")
        if len(results['errors']) > 10:
            print(f"  ... and {len(results['errors']) - 10} more")
    
    print()
    print("Next steps:")
    print("1. Register files in storage.objects using Node.js script")
    print("2. Create card_language_links entries for language code 'zh-CN'")

if __name__ == "__main__":
    main()
