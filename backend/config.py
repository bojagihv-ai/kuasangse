import os
from dotenv import load_dotenv

load_dotenv()


def _as_bool(value: str, default: bool = False) -> bool:
    if value is None:
        return default
    return str(value).strip().lower() in {"1", "true", "yes", "y", "on"}


class Config:
    # Gemini transport mode:
    # - GOOGLE_GENAI_USE_VERTEXAI=True  -> Vertex AI (ADC / GCP auth)
    # - GOOGLE_GENAI_USE_VERTEXAI=False -> Gemini Developer API (API key)
    GENAI_USE_VERTEXAI = _as_bool(os.getenv("GOOGLE_GENAI_USE_VERTEXAI"), default=False)
    GOOGLE_CLOUD_PROJECT = os.getenv("GOOGLE_CLOUD_PROJECT", "").strip()
    GOOGLE_CLOUD_LOCATION = os.getenv("GOOGLE_CLOUD_LOCATION", "global").strip() or "global"
    GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
    SERPAPI_KEY = os.getenv("SERPAPI_KEY", "")
    SINHWA_PDP_API_BASE = os.getenv("SINHWA_PDP_API_BASE", "http://127.0.0.1:8200/api/pdp").strip()
    UPLOAD_FOLDER = os.path.join(os.path.dirname(__file__), "static", "uploads")
    GENERATED_FOLDER = os.path.join(os.path.dirname(__file__), "static", "generated")
    LOCAL_ARCHIVE_FOLDER = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "output", "local-archive"))
    MAX_CONTENT_LENGTH = 150 * 1024 * 1024  # 150MB - 로컬 상세페이지/이미지 원본 보관용

    # Gemini model settings
    GEMINI_VISION_MODEL = "gemini-2.5-flash"
    GEMINI_TEXT_MODEL = "gemini-2.5-flash"
    GEMINI_IMAGE_MODEL = "gemini-3.1-flash-image-preview"
