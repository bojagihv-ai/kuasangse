"""
Gemini API Service - Handles all interactions with Google Gemini API
Supports: Vision analysis, text generation, image generation
"""
import base64
import os
import json
import time
import requests
import google.auth
from google.auth.transport.requests import Request as GoogleAuthRequest
from google import genai
from google.genai import types
from config import Config


_VERTEX_CONFIG_PATH = os.path.join(os.path.dirname(__file__), "..", ".local", "vertex-config.json")
_GLOBAL_IMAGE_MODELS = {
    "gemini-3.1-flash-image-preview",
    "gemini-3-pro-image-preview",
}
_IMAGE_MODEL_FALLBACKS = {
    "gemini-3.1-flash-image-preview": ["gemini-2.5-flash-image"],
    "gemini-3-pro-image-preview": ["gemini-2.5-flash-image"],
}
_SUPPORTED_IMAGE_SIZES = {"1K", "2K", "4K"}


def _load_vertex_config():
    project = Config.GOOGLE_CLOUD_PROJECT
    location = Config.GOOGLE_CLOUD_LOCATION
    try:
        with open(_VERTEX_CONFIG_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        project = str(data.get("project") or project).strip()
        location = str(data.get("location") or location).strip()
    except Exception:
        pass
    return {
        "project": project,
        "location": location or "global",
    }


def _unique_locations(*locations):
    out = []
    for location in locations:
        value = str(location or "").strip()
        if value and value not in out:
            out.append(value)
    return out or ["global"]


def _is_model_not_found_error(error):
    text = str(error)
    return (
        "404" in text
        or "NOT_FOUND" in text
        or "Publisher Model" in text
        or "was not found" in text
    )


def _is_rate_limit_error(error):
    text = str(error)
    return "429" in text or "RESOURCE_EXHAUSTED" in text


def _normalize_image_size(image_size):
    value = str(image_size or "").strip().upper()
    return value if value in _SUPPORTED_IMAGE_SIZES else None


def _get_adc_access_token():
    credentials, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/cloud-platform"])
    if not credentials.valid:
        credentials.refresh(GoogleAuthRequest())
    return credentials.token


def _ext_from_mime(mime_type):
    if mime_type == "image/jpeg":
        return "jpg"
    if mime_type and "/" in mime_type:
        return mime_type.split("/")[-1].replace("jpeg", "jpg")
    return "jpg"


def _retry_on_rate_limit(fn, retries=2, backoff=(15, 30)):
    for attempt in range(retries + 1):
        try:
            return fn()
        except Exception as e:
            if _is_rate_limit_error(e) and attempt < retries:
                wait = backoff[min(attempt, len(backoff) - 1)]
                print(f"[gemini] 429 rate limit, {wait}초 대기 후 재시도 ({attempt+1}/{retries})...", flush=True)
                time.sleep(wait)
            else:
                raise


def _strip_json_fence(text):
    text = (text or "").strip()
    if text.startswith("```json"):
        text = text[7:].strip()
    elif text.startswith("```"):
        text = text[3:].strip()
    if text.endswith("```"):
        text = text[:-3].strip()
    return text


def _extract_json_object(text):
    text = _strip_json_fence(text)
    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end != -1 and end > start:
        return text[start:end + 1].strip()
    return text


def _escape_raw_newlines_in_json_strings(text):
    out = []
    in_string = False
    escaped = False
    for char in text:
        if in_string:
            if escaped:
                out.append(char)
                escaped = False
                continue
            if char == "\\":
                out.append(char)
                escaped = True
                continue
            if char == '"':
                out.append(char)
                in_string = False
                continue
            if char == "\n":
                out.append("\\n")
                continue
            if char == "\r":
                continue
            if ord(char) < 32:
                out.append(" ")
                continue
            out.append(char)
            continue

        out.append(char)
        if char == '"':
            in_string = True
    return "".join(out)


def _load_json_response(text):
    cleaned = _extract_json_object(text)
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        return json.loads(_escape_raw_newlines_in_json_strings(cleaned))


class GeminiService:
    def __init__(self, api_key=None, image_model=None):
        self.use_vertex = Config.GENAI_USE_VERTEXAI
        self.image_model = image_model or Config.GEMINI_IMAGE_MODEL
        self._vertex_clients = {}
        self.last_image_generation_route = None

        if self.use_vertex:
            vertex_cfg = _load_vertex_config()
            self.vertex_project = vertex_cfg["project"]
            self.vertex_location = vertex_cfg["location"]
            if not self.vertex_project:
                raise ValueError(
                    "Vertex AI mode is enabled, but GOOGLE_CLOUD_PROJECT is not set."
                )
            if self.vertex_project.startswith("your_"):
                raise ValueError(
                    "Set a real GOOGLE_CLOUD_PROJECT value before using Vertex AI mode."
                )
            self.client = self._get_vertex_client(self.vertex_location)
        else:
            key = api_key or Config.GEMINI_API_KEY
            if not key:
                raise ValueError(
                    "Gemini Developer API mode requires GEMINI_API_KEY."
                )
            self.client = genai.Client(api_key=key)

    def _get_vertex_client(self, location):
        location = location or "global"
        if location not in self._vertex_clients:
            self._vertex_clients[location] = genai.Client(
                vertexai=True,
                project=self.vertex_project,
                location=location,
            )
        return self._vertex_clients[location]

    def _image_model_candidates(self):
        return [self.image_model, *_IMAGE_MODEL_FALLBACKS.get(self.image_model, [])]

    def _image_locations(self, model):
        if model in _GLOBAL_IMAGE_MODELS:
            return _unique_locations("global", self.vertex_location, "us-central1")
        return _unique_locations(self.vertex_location, "global")

    def _content_to_vertex_payload(self, contents):
        parts = []
        items = contents if isinstance(contents, list) else [contents]
        for item in items:
            if isinstance(item, str):
                parts.append({"text": item})
                continue

            inline_data = getattr(item, "inline_data", None)
            if inline_data:
                data = inline_data.data
                if isinstance(data, str):
                    encoded = data
                else:
                    encoded = base64.b64encode(data).decode("ascii")
                parts.append({
                    "inlineData": {
                        "mimeType": inline_data.mime_type,
                        "data": encoded,
                    }
                })
                continue

            raise TypeError(f"Unsupported Gemini content part: {type(item)!r}")

        return [{"role": "user", "parts": parts}]

    def _config_to_vertex_payload(self, config, image_size=None, aspect_ratio=None, output_mime_type="image/jpeg"):
        generation_config = {}

        temperature = getattr(config, "temperature", None)
        if temperature is not None:
            generation_config["temperature"] = temperature

        max_output_tokens = getattr(config, "max_output_tokens", None)
        if max_output_tokens is not None:
            generation_config["maxOutputTokens"] = max_output_tokens

        response_modalities = getattr(config, "response_modalities", None)
        if response_modalities:
            generation_config["responseModalities"] = list(response_modalities)

        image_config = {}
        normalized_size = _normalize_image_size(image_size)
        if normalized_size:
            image_config["imageSize"] = normalized_size
        if aspect_ratio:
            image_config["aspectRatio"] = str(aspect_ratio)
        if output_mime_type:
            image_config["imageOutputOptions"] = {"mimeType": output_mime_type}
        if image_config:
            generation_config["imageConfig"] = image_config

        return generation_config

    def _generate_image_content_rest(self, model, location, contents, config, image_size=None, aspect_ratio=None):
        payload = {
            "contents": self._content_to_vertex_payload(contents),
            "generationConfig": self._config_to_vertex_payload(
                config,
                image_size=image_size,
                aspect_ratio=aspect_ratio,
            ),
        }
        token = _get_adc_access_token()
        url = (
            f"https://aiplatform.googleapis.com/v1/projects/{self.vertex_project}"
            f"/locations/{location}/publishers/google/models/{model}:generateContent"
        )
        resp = requests.post(
            url,
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
            },
            json=payload,
            timeout=180,
        )
        if resp.status_code >= 400:
            raise RuntimeError(f"Vertex image request failed ({resp.status_code}): {resp.text}")
        return resp.json()

    def _generate_image_content(self, contents, config, image_size=None, aspect_ratio=None):
        normalized_size = _normalize_image_size(image_size)
        if not self.use_vertex:
            response = self.client.models.generate_content(
                model=self.image_model,
                contents=contents,
                config=config,
            )
            self.last_image_generation_route = {
                "requested_model": self.image_model,
                "model": self.image_model,
                "location": "gemini-api",
                "fallback": False,
                "image_size": normalized_size,
                "aspect_ratio": aspect_ratio,
            }
            return response

        last_error = None
        candidates = self._image_model_candidates()
        for model_idx, model in enumerate(candidates):
            locations = self._image_locations(model)
            for loc_idx, location in enumerate(locations):
                try:
                    def _call(m=model, loc=location):
                        if normalized_size:
                            return self._generate_image_content_rest(
                                m,
                                loc,
                                contents,
                                config,
                                image_size=normalized_size,
                                aspect_ratio=aspect_ratio,
                            )
                        return self._get_vertex_client(loc).models.generate_content(
                            model=m,
                            contents=contents,
                            config=config,
                        )
                    response = _call()
                    self.last_image_generation_route = {
                        "requested_model": self.image_model,
                        "model": model,
                        "location": location,
                        "fallback": model != self.image_model,
                        "image_size": normalized_size,
                        "aspect_ratio": aspect_ratio,
                        "via": "vertex-rest" if normalized_size else "genai-sdk",
                    }
                    return response
                except Exception as error:
                    last_error = error
                    has_next_location = loc_idx < len(locations) - 1
                    has_next_model = model_idx < len(candidates) - 1
                    if not _is_model_not_found_error(error) or (not has_next_location and not has_next_model):
                        raise
                    if has_next_location:
                        target = f"{model} in {locations[loc_idx + 1]}"
                    else:
                        target = f"{candidates[model_idx + 1]} fallback"
                    print(
                        f"[gemini] {model} not available in {location}; retrying with {target}",
                        flush=True,
                    )
        raise last_error

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
                response_mime_type="application/json",
            ),
        )

        return _load_json_response(response.text)

    def generate_section_content(self, section_config: dict, product_analysis: dict, competitor_data: dict = None) -> dict:
        """Generate content for a specific detail page section."""
        sinhwa_context = (product_analysis or {}).get("sinhwa_db_ai_context") or ""
        sinhwa_rules = ""
        if sinhwa_context:
            sinhwa_rules = f"""
Sinhwa DB Required Facts:
{sinhwa_context}

Hard fact rules:
- Treat Sinhwa DB values as authoritative product facts.
- Do not alter or guess size, composition, manufacturing process, manufacturer, supplier, or origin country.
- If a field is listed as missing in Sinhwa DB, do not invent it; write around it or mark it as 확인 필요 only when the section must mention it.
"""
        prompt = f"""You are a Korean e-commerce detail page content creator.

Product Analysis:
{json.dumps(product_analysis, ensure_ascii=False, indent=2)}

{sinhwa_rules}

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

Respond ONLY with one valid JSON object. Do not use markdown fences.
All string values must be single-line strings with escaped newlines if needed."""

        response = self.client.models.generate_content(
            model=Config.GEMINI_TEXT_MODEL,
            contents=[prompt],
            config=types.GenerateContentConfig(
                temperature=0.35,
                max_output_tokens=4096,
                response_mime_type="application/json",
            ),
        )

        return _load_json_response(response.text)

    def generate_section_image(self, prompt: str, section_name: str, project_id: str) -> str:
        """Generate an image for a detail page section using Gemini's image generation."""
        image_prompt = f"""Create one product-only ecommerce image cut.

Creative direction:
{prompt}

Hard rules:
- No text in any language.
- No headline, subtitle, bullet list, badges, captions, labels, CTA, UI cards, infographic panels, or web page layout.
- Do not explain the product visually with written copy.
- Create a single clean photographic product image only.
- Keep the product as the hero and use the requested scene/background naturally."""
        response = self._generate_image_content(
            contents=image_prompt,
            config=types.GenerateContentConfig(
                response_modalities=["TEXT", "IMAGE"],
                temperature=0.55,
                max_output_tokens=4096,
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

    def _first_inline_image(self, response):
        if isinstance(response, dict):
            for candidate in response.get("candidates", []):
                content = candidate.get("content") or {}
                for part in content.get("parts", []):
                    inline = part.get("inlineData") or part.get("inline_data")
                    if not inline:
                        continue
                    mime_type = inline.get("mimeType") or inline.get("mime_type") or "image/jpeg"
                    if not mime_type.startswith("image/"):
                        continue
                    data = inline.get("data") or ""
                    if isinstance(data, str):
                        return mime_type, base64.b64decode(data)
                    return mime_type, data
            return None, None

        for part in response.candidates[0].content.parts:
            inline = getattr(part, "inline_data", None)
            if inline and inline.mime_type.startswith("image/"):
                data = inline.data
                if isinstance(data, str):
                    data = base64.b64decode(data)
                return inline.mime_type, data
        return None, None

    def generate_composite_image(
        self,
        prompt: str,
        product_image_path: str,
        section_name: str,
        project_id: str,
        output_image_size: str = None,
    ) -> str:
        """Generate a composite image with the product placed in a styled background."""
        with open(product_image_path, "rb") as f:
            product_data = f.read()

        product_part = types.Part.from_bytes(
            data=product_data,
            mime_type=self._get_mime_type(product_image_path)
        )

        full_prompt = f"""Using the provided product image as the exact product reference, create one product-only ecommerce image cut.

Creative direction:
{prompt}

Hard rules:
- No text in any language.
- No headline, subtitle, bullet list, badges, captions, labels, CTA, UI cards, infographic panels, or web page layout.
- Do not create a detail-page section, advertisement layout, comparison card, or typography composition.
- Do not explain the product visually with written copy.
- Preserve the product shape, color, material, and key details from the reference image.
- Place the product naturally in the requested scene/background and keep it as the clear focal point.
- Create a single clean photographic product image only."""

        response = self._generate_image_content(
            contents=[full_prompt, product_part],
            config=types.GenerateContentConfig(
                response_modalities=["TEXT", "IMAGE"],
                temperature=0.55,
                max_output_tokens=4096,
            ),
            image_size=output_image_size,
            aspect_ratio="4:3",
        )

        output_path = None
        mime_type, image_bytes = self._first_inline_image(response)
        if image_bytes:
            ext = _ext_from_mime(mime_type)
            filename = f"{project_id}_{section_name.replace(' ', '_')}_composite.{ext}"
            output_path = os.path.join(Config.GENERATED_FOLDER, filename)
            with open(output_path, "wb") as f:
                f.write(image_bytes)

        return output_path

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
