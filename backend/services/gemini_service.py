"""
Gemini API Service - Handles all interactions with Google Gemini API
Supports: Vision analysis, text generation, image generation
"""
import base64
import os
import json
import time
from google import genai
from google.genai import types
from config import Config


class GeminiService:
    def __init__(self):
        self.client = genai.Client(api_key=Config.GEMINI_API_KEY)

    def analyze_product_image(self, image_path: str) -> dict:
        """Analyze product image and extract comprehensive features using Gemini Vision."""
        with open(image_path, "rb") as f:
            image_data = f.read()

        image_part = types.Part.from_bytes(data=image_data, mime_type=self._get_mime_type(image_path))

        prompt = """You are a professional e-commerce product analyst. Analyze this product image in extreme detail.
Return a JSON object with the following fields:

{
    "product_name": "detected product name in Korean",
    "product_name_en": "detected product name in English",
    "category": "product category",
    "brand": "brand name if visible",
    "colors": ["list of colors detected"],
    "materials": ["detected or estimated materials"],
    "shape": "product shape description",
    "size_estimate": "estimated size",
    "key_features": ["list of 5-10 key features"],
    "target_audience": "target customer demographic",
    "price_range_estimate": "estimated price range in KRW",
    "mood": "overall mood/aesthetic of the product",
    "use_cases": ["list of use cases"],
    "selling_points": ["list of unique selling points"],
    "style_keywords": ["style-related keywords for design"],
    "background_recommendation": "recommended background style",
    "complementary_colors": ["colors that complement the product"],
    "text_color_recommendation": "recommended text color for overlay",
    "packaging_visible": true/false,
    "logo_visible": true/false,
    "detailed_description": "A detailed Korean description for marketing"
}

Respond ONLY with the JSON object, no other text."""

        response = self.client.models.generate_content(
            model=Config.GEMINI_VISION_MODEL,
            contents=[prompt, image_part],
            config=types.GenerateContentConfig(
                temperature=0.3,
                max_output_tokens=4096,
            ),
        )

        text = response.text.strip()
        if text.startswith("```json"):
            text = text[7:]
        if text.startswith("```"):
            text = text[3:]
        if text.endswith("```"):
            text = text[:-3]

        return json.loads(text.strip())

    def generate_section_content(self, section_config: dict, product_analysis: dict, competitor_data: dict = None) -> dict:
        """Generate content for a specific detail page section."""
        prompt = f"""You are a Korean e-commerce detail page content creator.

Product Analysis:
{json.dumps(product_analysis, ensure_ascii=False, indent=2)}

{"Competitor Reference Data:" + json.dumps(competitor_data, ensure_ascii=False, indent=2) if competitor_data else ""}

Section to create: {section_config['section_name']}
Section number: {section_config['section_number']}
Section purpose: {section_config['purpose']}
User custom instructions: {section_config.get('custom_instructions', 'None')}

Based on the product analysis, generate content for this section.
Return a JSON object:
{{
    "headline": "Main headline text in Korean (impactful, short)",
    "subheadline": "Sub headline in Korean",
    "body_text": "Body copy in Korean (2-3 sentences)",
    "cta_text": "Call to action text if applicable",
    "layout_suggestion": "Layout recommendation",
    "color_scheme": {{
        "background": "#hex",
        "text_primary": "#hex",
        "text_secondary": "#hex",
        "accent": "#hex"
    }},
    "font_suggestion": {{
        "headline_font": "font name",
        "headline_size": "px value",
        "body_font": "font name",
        "body_size": "px value"
    }},
    "image_prompt": "Detailed prompt for generating the section background/decorative image",
    "product_placement": "Description of how the product image should be placed",
    "design_notes": "Additional design recommendations"
}}

Respond ONLY with the JSON object."""

        response = self.client.models.generate_content(
            model=Config.GEMINI_TEXT_MODEL,
            contents=[prompt],
            config=types.GenerateContentConfig(
                temperature=0.7,
                max_output_tokens=2048,
            ),
        )

        text = response.text.strip()
        if text.startswith("```json"):
            text = text[7:]
        if text.startswith("```"):
            text = text[3:]
        if text.endswith("```"):
            text = text[:-3]

        return json.loads(text.strip())

    def generate_section_image(self, prompt: str, section_name: str, project_id: str) -> str:
        """Generate an image for a detail page section using Gemini's image generation."""
        try:
            response = self.client.models.generate_content(
                model=Config.GEMINI_IMAGE_MODEL,
                contents=prompt,
                config=types.GenerateContentConfig(
                    response_modalities=["TEXT", "IMAGE"],
                    temperature=0.8,
                ),
            )

            output_path = None
            for part in response.candidates[0].content.parts:
                if part.inline_data and part.inline_data.mime_type.startswith("image/"):
                    ext = part.inline_data.mime_type.split("/")[-1]
                    filename = f"{project_id}_{section_name.replace(' ', '_')}.{ext}"
                    output_path = os.path.join(Config.GENERATED_FOLDER, filename)
                    with open(output_path, "wb") as f:
                        f.write(part.inline_data.data)
                    break

            return output_path
        except Exception as e:
            print(f"Image generation failed for {section_name}: {e}")
            return None

    def generate_composite_image(self, prompt: str, product_image_path: str, section_name: str, project_id: str) -> str:
        """Generate a composite image with the product placed in a styled background."""
        try:
            with open(product_image_path, "rb") as f:
                product_data = f.read()

            product_part = types.Part.from_bytes(
                data=product_data,
                mime_type=self._get_mime_type(product_image_path)
            )

            full_prompt = f"""Based on this product image, create a professional e-commerce detail page section image.
Requirements: {prompt}
The product should be the focal point. Create a clean, professional Korean e-commerce style layout."""

            response = self.client.models.generate_content(
                model=Config.GEMINI_IMAGE_MODEL,
                contents=[full_prompt, product_part],
                config=types.GenerateContentConfig(
                    response_modalities=["TEXT", "IMAGE"],
                    temperature=0.7,
                ),
            )

            output_path = None
            for part in response.candidates[0].content.parts:
                if part.inline_data and part.inline_data.mime_type.startswith("image/"):
                    ext = part.inline_data.mime_type.split("/")[-1]
                    filename = f"{project_id}_{section_name.replace(' ', '_')}_composite.{ext}"
                    output_path = os.path.join(Config.GENERATED_FOLDER, filename)
                    with open(output_path, "wb") as f:
                        f.write(part.inline_data.data)
                    break

            return output_path
        except Exception as e:
            print(f"Composite image generation failed for {section_name}: {e}")
            return None

    def _get_mime_type(self, path: str) -> str:
        ext = os.path.splitext(path)[1].lower()
        mime_map = {
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".png": "image/png",
            ".gif": "image/gif",
            ".webp": "image/webp",
            ".bmp": "image/bmp",
        }
        return mime_map.get(ext, "image/jpeg")
