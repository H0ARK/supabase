#!/usr/bin/env python3
"""
Scrape Simplified Chinese Pokemon cards from KrystalKollectz.
Downloads card images and extracts metadata for database registration.
"""

import re
import json
import time
import requests
from pathlib import Path
from urllib.parse import urljoin, urlparse
from bs4 import BeautifulSoup
from PIL import Image
from io import BytesIO
import concurrent.futures
from typing import Dict, List, Optional, Tuple

# Configuration
BASE_URL = "https://krystalkollectz.com"
CARD_LISTS_PAGE = f"{BASE_URL}/pages/card-lists"
OUTPUT_DIR = Path("/home/ubuntu/chinese-card-images-krystalkollectz")
METADATA_FILE = Path("/home/ubuntu/chinese-cards-metadata.json")
SYNTHETIC_ID_BASE = 100022563  # Start after highest product ID (100022562)

# Chinese set patterns to match
CHINESE_SET_PATTERNS = [
    r"simplified-chinese",
    r"s-chinese",
    r"csm\d+[abc]?c",  # csm1aC, csm1bC, etc.
    r"cs\d+[abc]?\.?\d*c",  # cs1aC, cs2.5C, etc.
    r"csv\d+[abc]?\.?\d*c",  # csv1C, csv2.5C, etc.
]

class ChineseCardScraper:
    def __init__(self, output_dir: Path, metadata_file: Path):
        self.output_dir = output_dir
        self.metadata_file = metadata_file
        self.output_dir.mkdir(parents=True, exist_ok=True)
        
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        })
        
        self.cards_metadata = []
        self.current_synthetic_id = SYNTHETIC_ID_BASE
        
    def get_chinese_set_urls(self) -> List[Tuple[str, str]]:
        """Fetch all Chinese set card list URLs from the main page."""
        print(f"Fetching set list from {CARD_LISTS_PAGE}...")
        
        try:
            response = self.session.get(CARD_LISTS_PAGE, timeout=30)
            response.raise_for_status()
            soup = BeautifulSoup(response.text, 'html.parser')
            
            # Find all links in the Chinese section
            set_urls = []
            links = soup.find_all('a', href=True)
            
            for link in links:
                href = link.get('href', '')
                title = link.get('title', '') or link.get('alt', '') or ''
                
                # Check if this is a Chinese set
                is_chinese = any(
                    re.search(pattern, href.lower()) or re.search(pattern, title.lower())
                    for pattern in CHINESE_SET_PATTERNS
                )
                
                # Must be in blogs/cardlists or blogs/news AND contain "card-list" or "card list"
                is_card_list = (
                    '/blogs/cardlists/' in href or 
                    ('/blogs/news/' in href and ('card-list' in href.lower() or 'card list' in title.lower()))
                )
                
                # Exclude certain non-card-list pages
                exclude_keywords = ['legit-check', 'how-to', 'promo-cards', 'exclusive-cards']
                is_excluded = any(keyword in href.lower() for keyword in exclude_keywords)
                
                if is_chinese and is_card_list and not is_excluded:
                    full_url = urljoin(BASE_URL, href)
                    set_name = title or href.split('/')[-1]
                    
                    # Avoid duplicates
                    if full_url not in [url for url, _ in set_urls]:
                        set_urls.append((full_url, set_name))
            
            print(f"Found {len(set_urls)} Chinese set URLs")
            return set_urls
            
        except Exception as e:
            print(f"Error fetching set list: {e}")
            return []
    
    def extract_set_code(self, url: str, title: str) -> str:
        """Extract set code from URL or title."""
        # Try to find set codes like csm1aC, cs2.5C, etc.
        patterns = [
            r'(csm\d+[abc]?c)',
            r'(cs\d+[abc]?\.?\d*c)',
            r'(csv\d+[abc]?\.?\d*c)',
        ]
        
        text = f"{url} {title}".lower()
        for pattern in patterns:
            match = re.search(pattern, text, re.IGNORECASE)
            if match:
                return match.group(1).upper()
        
        # Fallback: use last part of URL
        slug = url.rstrip('/').split('/')[-1]
        return slug[:20].upper()
    
    def scrape_set(self, set_url: str, set_name: str) -> List[Dict]:
        """Scrape all cards from a set page."""
        print(f"\nScraping set: {set_name}")
        print(f"URL: {set_url}")
        
        try:
            response = self.session.get(set_url, timeout=30)
            response.raise_for_status()
            soup = BeautifulSoup(response.text, 'html.parser')
            
            # Extract set code
            set_code = self.extract_set_code(set_url, set_name)
            
            # Find all card images
            cards = []
            img_tags = soup.find_all('img')
            
            # Pattern to match card image filenames
            card_image_patterns = [
                r'IMG_\d+\.jpg',
                r'IMG_\d+\.png',
                r'IMG_\d+\.webp',
                r'\d+_\d+\.jpg',
            ]
            
            for img in img_tags:
                src = img.get('src', '') or img.get('data-src', '')
                if not src:
                    continue
                
                # Check if this looks like a card image
                is_card_image = any(
                    re.search(pattern, src, re.IGNORECASE)
                    for pattern in card_image_patterns
                )
                
                if is_card_image and 'cdn.shopify.com' in src:
                    # Ensure full URL
                    if src.startswith('//'):
                        src = 'https:' + src
                    elif not src.startswith('http'):
                        src = urljoin(BASE_URL, src)
                    
                    # Extract card info from surrounding HTML
                    card_info = self.extract_card_info(img, soup)
                    
                    card_data = {
                        'synthetic_id': self.current_synthetic_id,
                        'set_code': set_code,
                        'set_name': set_name,
                        'set_url': set_url,
                        'image_url': src,
                        'card_number': card_info.get('card_number', ''),
                        'card_name': card_info.get('card_name', ''),
                        'rarity': card_info.get('rarity', ''),
                    }
                    
                    cards.append(card_data)
                    self.current_synthetic_id += 1
            
            print(f"Found {len(cards)} cards in {set_name}")
            return cards
            
        except Exception as e:
            print(f"Error scraping set {set_name}: {e}")
            return []
    
    def extract_card_info(self, img_tag, soup) -> Dict[str, str]:
        """Extract card metadata from surrounding HTML."""
        info = {
            'card_number': '',
            'card_name': '',
            'rarity': '',
        }
        
        # Try to find card number/name in alt text
        alt = img_tag.get('alt', '')
        if alt:
            # Try to extract card number (e.g., "001/151", "SV001")
            card_num_match = re.search(r'(\d+)[/\-](\d+)|([A-Z]+\d+)', alt)
            if card_num_match:
                info['card_number'] = card_num_match.group(0)
            
            info['card_name'] = alt[:100]  # Use alt as name
        
        # Try to find info in parent elements
        parent = img_tag.parent
        if parent:
            text = parent.get_text(strip=True)
            
            # Extract card number if found
            card_num_match = re.search(r'(\d+)[/\-](\d+)', text)
            if card_num_match and not info['card_number']:
                info['card_number'] = card_num_match.group(0)
            
            # Look for rarity indicators
            rarity_keywords = {
                'common': 'Common',
                'uncommon': 'Uncommon',
                'rare': 'Rare',
                'ultra rare': 'Ultra Rare',
                'secret rare': 'Secret Rare',
                'special illustration': 'SIR',
                'hyper rare': 'Hyper Rare',
            }
            
            text_lower = text.lower()
            for keyword, rarity in rarity_keywords.items():
                if keyword in text_lower:
                    info['rarity'] = rarity
                    break
        
        return info
    
    def download_card_image(self, card_data: Dict) -> Optional[str]:
        """Download and convert card image to WebP."""
        try:
            synthetic_id = card_data['synthetic_id']
            image_url = card_data['image_url']
            output_path = self.output_dir / f"{synthetic_id}.webp"
            
            # Skip if already exists
            if output_path.exists():
                return str(output_path)
            
            # Download image
            response = self.session.get(image_url, timeout=30)
            response.raise_for_status()
            
            # Open with PIL
            img = Image.open(BytesIO(response.content))
            
            # Convert to RGB if necessary
            if img.mode in ('RGBA', 'LA', 'P'):
                background = Image.new('RGB', img.size, (255, 255, 255))
                if img.mode == 'P':
                    img = img.convert('RGBA')
                background.paste(img, mask=img.split()[-1] if img.mode in ('RGBA', 'LA') else None)
                img = background
            elif img.mode != 'RGB':
                img = img.convert('RGB')
            
            # Resize to standard dimensions (734x1024 like Korean cards)
            target_size = (734, 1024)
            img = img.resize(target_size, Image.Resampling.LANCZOS)
            
            # Save as WebP
            img.save(output_path, 'WEBP', quality=85, method=6)
            
            return str(output_path)
            
        except Exception as e:
            print(f"Error downloading card {card_data['synthetic_id']}: {e}")
            return None
    
    def download_all_cards(self, cards: List[Dict], max_workers: int = 8):
        """Download all card images concurrently."""
        print(f"\nDownloading {len(cards)} card images...")
        
        with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
            futures = {
                executor.submit(self.download_card_image, card): card
                for card in cards
            }
            
            completed = 0
            for future in concurrent.futures.as_completed(futures):
                completed += 1
                if completed % 50 == 0:
                    print(f"Progress: {completed}/{len(cards)} cards downloaded")
        
        print(f"Completed downloading {len(cards)} cards")
    
    def save_metadata(self):
        """Save all card metadata to JSON file."""
        print(f"\nSaving metadata to {self.metadata_file}...")
        
        with open(self.metadata_file, 'w', encoding='utf-8') as f:
            json.dump(self.cards_metadata, f, indent=2, ensure_ascii=False)
        
        print(f"Saved metadata for {len(self.cards_metadata)} cards")
    
    def run(self, max_workers: int = 8, limit_sets: Optional[int] = None):
        """Main execution flow."""
        # Step 1: Get all Chinese set URLs
        set_urls = self.get_chinese_set_urls()
        
        if not set_urls:
            print("No Chinese sets found!")
            return
        
        # Limit sets if specified (for testing)
        if limit_sets:
            set_urls = set_urls[:limit_sets]
            print(f"Limited to first {limit_sets} sets for testing")
        
        # Step 2: Scrape each set
        all_cards = []
        for set_url, set_name in set_urls:
            cards = self.scrape_set(set_url, set_name)
            all_cards.extend(cards)
            self.cards_metadata.extend(cards)
            
            # Be polite to the server
            time.sleep(1)
        
        print(f"\nTotal cards found: {len(all_cards)}")
        
        # Step 3: Download all card images
        if all_cards:
            self.download_all_cards(all_cards, max_workers=max_workers)
        
        # Step 4: Save metadata
        self.save_metadata()
        
        print("\n✓ Scraping complete!")
        print(f"  Images: {self.output_dir}")
        print(f"  Metadata: {self.metadata_file}")


def main():
    import argparse
    
    parser = argparse.ArgumentParser(description='Scrape Chinese Pokemon cards from KrystalKollectz')
    parser.add_argument('--output-dir', type=Path, default=OUTPUT_DIR,
                        help='Output directory for card images')
    parser.add_argument('--metadata-file', type=Path, default=METADATA_FILE,
                        help='Output file for card metadata JSON')
    parser.add_argument('--max-workers', type=int, default=8,
                        help='Maximum concurrent downloads')
    parser.add_argument('--limit-sets', type=int, default=None,
                        help='Limit number of sets to scrape (for testing)')
    
    args = parser.parse_args()
    
    scraper = ChineseCardScraper(args.output_dir, args.metadata_file)
    scraper.run(max_workers=args.max_workers, limit_sets=args.limit_sets)


if __name__ == '__main__':
    main()
