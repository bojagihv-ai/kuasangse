"""
Search Service - Finds competitor products and their detail pages
Dual-track: Self-analysis + Competitor reference search
"""
import json
import requests
from bs4 import BeautifulSoup
from config import Config


class SearchService:
    def __init__(self):
        self.serpapi_key = Config.SERPAPI_KEY

    def search_similar_products(self, product_info: dict) -> list:
        """Search for similar products using SerpAPI Google Shopping."""
        query = f"{product_info.get('product_name', '')} {product_info.get('category', '')}"

        try:
            params = {
                "engine": "google_shopping",
                "q": query,
                "hl": "ko",
                "gl": "kr",
                "api_key": self.serpapi_key,
                "num": 10,
            }
            response = requests.get("https://serpapi.com/search", params=params, timeout=15)
            data = response.json()

            results = []
            for item in data.get("shopping_results", [])[:10]:
                results.append({
                    "title": item.get("title", ""),
                    "price": item.get("price", ""),
                    "source": item.get("source", ""),
                    "link": item.get("link", ""),
                    "thumbnail": item.get("thumbnail", ""),
                    "rating": item.get("rating", ""),
                    "reviews": item.get("reviews", 0),
                })
            return results

        except Exception as e:
            print(f"Shopping search failed: {e}")
            return []

    def search_detail_pages(self, product_info: dict) -> list:
        """Search for competitor detail pages for reference."""
        query = f"{product_info.get('product_name', '')} 상세페이지"

        try:
            params = {
                "engine": "google_images",
                "q": query,
                "hl": "ko",
                "gl": "kr",
                "api_key": self.serpapi_key,
                "num": 10,
            }
            response = requests.get("https://serpapi.com/search", params=params, timeout=15)
            data = response.json()

            results = []
            for item in data.get("images_results", [])[:10]:
                results.append({
                    "title": item.get("title", ""),
                    "link": item.get("link", ""),
                    "original": item.get("original", ""),
                    "thumbnail": item.get("thumbnail", ""),
                    "source": item.get("source", ""),
                })
            return results

        except Exception as e:
            print(f"Detail page search failed: {e}")
            return []

    def scrape_product_page(self, url: str) -> dict:
        """Scrape a product page for detail information."""
        try:
            headers = {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
            }
            response = requests.get(url, headers=headers, timeout=10)
            soup = BeautifulSoup(response.text, "html.parser")

            # Extract basic info
            title = soup.find("title")
            title_text = title.get_text() if title else ""

            # Extract meta description
            meta_desc = soup.find("meta", {"name": "description"})
            description = meta_desc.get("content", "") if meta_desc else ""

            # Extract images
            images = []
            for img in soup.find_all("img")[:20]:
                src = img.get("src", "")
                if src and not src.startswith("data:"):
                    images.append(src)

            return {
                "title": title_text,
                "description": description,
                "images": images,
                "url": url,
            }

        except Exception as e:
            print(f"Scraping failed for {url}: {e}")
            return {"title": "", "description": "", "images": [], "url": url}

    def get_competitor_analysis(self, product_info: dict) -> dict:
        """Full competitor analysis: search + scrape + analyze."""
        similar_products = self.search_similar_products(product_info)
        detail_pages = self.search_detail_pages(product_info)

        return {
            "similar_products": similar_products,
            "detail_page_references": detail_pages,
            "market_summary": {
                "total_competitors_found": len(similar_products),
                "price_range": self._extract_price_range(similar_products),
                "top_sources": list(set(p.get("source", "") for p in similar_products[:5])),
                "avg_rating": self._calc_avg_rating(similar_products),
            },
        }

    def _extract_price_range(self, products: list) -> str:
        prices = []
        for p in products:
            price_str = p.get("price", "")
            # Extract numeric values from Korean won format
            nums = "".join(c for c in price_str if c.isdigit())
            if nums:
                prices.append(int(nums))
        if prices:
            return f"₩{min(prices):,} ~ ₩{max(prices):,}"
        return "N/A"

    def _calc_avg_rating(self, products: list) -> float:
        ratings = [float(p["rating"]) for p in products if p.get("rating")]
        return round(sum(ratings) / len(ratings), 1) if ratings else 0.0
