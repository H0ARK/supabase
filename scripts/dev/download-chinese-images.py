#!/usr/bin/env python3
"""
Download Simplified Chinese Pokemon card images from Collectr CDN.
Images are downloaded, converted to WebP format, and uploaded to Supabase Storage.
"""

import json
import os
import sys
import requests
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
import io
from PIL import Image

# Configuration
COLLECTR_JSON_PATH = "/home/ubuntu/collectr_chinese_products_latest.json"
STORAGE_BUCKET = "card-images"
STORAGE_BASE_PATH = "/home/ubuntu/supabase/docker/volumes/storage/stub/stub/card-images"

# Supabase REST API Configuration
SUPABASE_URL = "http://127.0.0.1:54321"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU"

# Language code for Simplified Chinese
LANGUAGE_CODE = "zh-CN"

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

def get_existing_product_ids():
    """Query database to get existing Chinese card product IDs from storage.objects."""
    print("Checking for existing Chinese card images in storage...")
    
    try:
        # Use Supabase REST API to query storage.objects
        headers = {
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "Content-Type": "application/json"
        }
        
        # Get all storage objects that match Chinese card pattern
        # Query for files with numeric names >= SYNTHETIC_ID_BASE
        response = requests.get(
            f"{SUPABASE_URL}/rest/v1/objects",
            headers=headers,
            params={
                "bucket_id": f"eq.{STORAGE_BUCKET}",
                "name": f"like.{SYNTHETIC_ID_BASE}*.webp",
                "select": "name"
            }
        )
        
        if response.status_code == 200:
            objects = response.json()
            existing_ids = set()
            
            for obj in objects:
                name = obj.get('name', '')
                # Extract numeric ID from filename (e.g., "210028954.webp" -> 210028954)
                if name.endswith('.webp'):
                    try:
                        product_id = int(name.replace('.webp', ''))
                        if product_id >= SYNTHETIC_ID_BASE:
                            existing_ids.add(product_id)
                    except ValueError:
                        continue
            
            print(f"Found {len(existing_ids)} existing Chinese card images in storage")
            return existing_ids
        else:
            print(f"Warning: Could not query storage objects (HTTP {response.status_code})")
            return set()
    
    except Exception as e:
        print(f"Error querying storage: {e}")
        return set()

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
        
        return True
    
    except Exception as e:
        print(f"Error downloading/converting {image_url}: {e}")
        return False

def register_in_storage_db(product_id, file_size):
    """Register uploaded file in storage.objects table."""
    try:
        headers = {
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates"
        }
        
        # Insert into storage.objects
        data = {
            "bucket_id": STORAGE_BUCKET,
            "name": f"{product_id}.webp",
            "version": None,  # NULL for non-versioned files
            "metadata": {
                "size": file_size,
                "mimetype": "image/webp",
                "cacheControl": "public, max-age=31536000"
            }
        }
        
        response = requests.post(
            f"{SUPABASE_URL}/rest/v1/objects",
            headers=headers,
            json=data
        )
        
        # 201 = created, 200/204 = already exists (upsert)
        if response.status_code in (200, 201, 204):
            return True
        else:
            print(f"Warning: Storage registration returned {response.status_code}: {response.text[:200]}")
            return False
    
    except Exception as e:
        print(f"Error registering {product_id} in storage.objects: {e}")
        return False

def create_card_language_link(collectr_product_id, group_id, card_number):
    """Create card_language_link entry for Chinese card."""
    try:
        headers = {
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates"
        }
        
        # Generate synthetic product ID
        synthetic_id = SYNTHETIC_ID_BASE + collectr_product_id
        
        # First, check if a product exists in the products table for this card
        check_response = requests.get(
            f"{SUPABASE_URL}/rest/v1/products",
            headers=headers,
            params={
                "group_id": f"eq.{group_id}",
                "card_number": f"eq.{card_number}",
                "select": "id",
                "limit": 1
            }
        )
        
        if check_response.status_code == 200:
            products = check_response.json()
            if not products:
                print(f"Warning: No product found for group_id={group_id} card_number={card_number}")
                # We'll still create the synthetic link, but note the issue
        
        # Insert into card_language_links
        data = {
            "synthetic_product_id": synthetic_id,
            "language_code": LANGUAGE_CODE
        }
        
        response = requests.post(
            f"{SUPABASE_URL}/rest/v1/card_language_links",
            headers=headers,
            json=data
        )
        
        # 201 = created, 200/204 = already exists (or conflict handled)
        if response.status_code in (200, 201, 204, 409):
            return True
        else:
            print(f"Warning: Language link creation returned {response.status_code}: {response.text[:200]}")
            return False
    
    except Exception as e:
        print(f"Error creating card_language_link for {collectr_product_id}: {e}")
        return False

def process_product(product, existing_ids):
    """Process a single Chinese product: download, convert, upload, and register."""
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
    
    success = download_and_convert_image(image_url, output_path)
    
    if not success:
        return {'status': 'failed', 'product_id': collectr_id, 'error': 'download_failed'}
    
    # Get file size
    file_size = os.path.getsize(output_path)
    
    # Register in storage.objects
    storage_success = register_in_storage_db(synthetic_id, file_size)
    
    if not storage_success:
        return {'status': 'failed', 'product_id': collectr_id, 'error': 'storage_registration_failed'}
    
    # Create card_language_link
    link_success = create_card_language_link(collectr_id, group_id, card_number)
    
    if not link_success:
        return {'status': 'partial', 'product_id': collectr_id, 'error': 'language_link_failed'}
    
    return {
        'status': 'success',
        'product_id': collectr_id,
        'synthetic_id': synthetic_id,
        'card': f"{product_name} ({card_number})",
        'size': file_size
    }

def main():
    """Main execution function."""
    print("=" * 80)
    print("Chinese Pokemon Card Image Downloader")
    print("=" * 80)
    print(f"Started at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print()
    
    # Load products from JSON
    products = load_chinese_products()
    
    # Get existing product IDs
    existing_ids = get_existing_product_ids()
    
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
        'partial': 0,
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
                print(f"[{i}/{len(products_to_process)}] ✓ Downloaded: {result['card']} (ID: {result['synthetic_id']}, Size: {result['size']} bytes)")
            elif status == 'failed':
                print(f"[{i}/{len(products_to_process)}] ✗ Failed: Product {result['product_id']} - {result.get('error', 'unknown')}")
                results['errors'].append(result)
            elif status == 'partial':
                print(f"[{i}/{len(products_to_process)}] ⚠ Partial: Product {result['product_id']} - {result.get('error', 'unknown')}")
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
    print(f"⚠ Partial: {results['partial']}")
    print(f"⊘ Skipped: {results['skipped']}")
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

if __name__ == "__main__":
    main()
