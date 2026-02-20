import os
from dotenv import load_dotenv

load_dotenv()

class Config:
    GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
    SERPAPI_KEY = os.getenv("SERPAPI_KEY", "")
    UPLOAD_FOLDER = os.path.join(os.path.dirname(__file__), "static", "uploads")
    GENERATED_FOLDER = os.path.join(os.path.dirname(__file__), "static", "generated")
    MAX_CONTENT_LENGTH = 50 * 1024 * 1024  # 50MB

    # Gemini model settings
    GEMINI_VISION_MODEL = "gemini-2.0-flash"
    GEMINI_TEXT_MODEL = "gemini-2.0-flash"
    GEMINI_IMAGE_MODEL = "gemini-3-pro-image-preview"
