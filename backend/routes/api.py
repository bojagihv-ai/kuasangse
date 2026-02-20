"""
API Routes for the Product Detail Page Generator
"""
import os
import uuid
import threading
from flask import Blueprint, request, jsonify, send_file
from werkzeug.utils import secure_filename
from services.pipeline import pipeline
from services.section_definitions import get_all_sections
from config import Config

api = Blueprint("api", __name__)

ALLOWED_EXTENSIONS = {"png", "jpg", "jpeg", "gif", "webp", "bmp"}


def allowed_file(filename):
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS


# ── Project Management ──────────────────────────────────────────

@api.route("/projects", methods=["POST"])
def create_project():
    """Upload product image and create a new project."""
    if "image" not in request.files:
        return jsonify({"error": "No image file provided"}), 400

    file = request.files["image"]
    if file.filename == "":
        return jsonify({"error": "No file selected"}), 400

    if not allowed_file(file.filename):
        return jsonify({"error": "File type not allowed"}), 400

    # Save uploaded file
    ext = file.filename.rsplit(".", 1)[1].lower()
    filename = f"{uuid.uuid4().hex[:12]}.{ext}"
    filepath = os.path.join(Config.UPLOAD_FOLDER, filename)
    file.save(filepath)

    product_name = request.form.get("product_name", "")
    project = pipeline.create_project(filepath, product_name)

    return jsonify({
        "project_id": project["id"],
        "status": project["status"],
        "message": "프로젝트가 생성되었습니다.",
    }), 201


@api.route("/projects/<project_id>", methods=["GET"])
def get_project(project_id):
    """Get project status and summary."""
    summary = pipeline.get_project_summary(project_id)
    if not summary:
        return jsonify({"error": "Project not found"}), 404
    return jsonify(summary)


@api.route("/projects/<project_id>/full", methods=["GET"])
def get_project_full(project_id):
    """Get full project data including all sections."""
    project = pipeline.get_project(project_id)
    if not project:
        return jsonify({"error": "Project not found"}), 404

    # Convert image paths to URLs
    result = {
        "id": project["id"],
        "status": project["status"],
        "progress": project["progress"],
        "progress_message": project["progress_message"],
        "analysis": project.get("analysis"),
        "competitor_data": project.get("competitor_data"),
        "sections": {},
    }

    for sid, sdata in project.get("sections", {}).items():
        section_info = {**sdata}
        if section_info.get("image_path"):
            # Convert to relative URL
            section_info["image_url"] = "/static/generated/" + os.path.basename(section_info["image_path"])
        result["sections"][sid] = section_info

    # Product image URL
    if project.get("image_path"):
        result["product_image_url"] = "/static/uploads/" + os.path.basename(project["image_path"])

    return jsonify(result)


# ── Analysis Pipeline ────────────────────────────────────────────

@api.route("/projects/<project_id>/analyze", methods=["POST"])
def analyze_product(project_id):
    """Run product image analysis."""
    project = pipeline.get_project(project_id)
    if not project:
        return jsonify({"error": "Project not found"}), 404

    try:
        analysis = pipeline.run_analysis(project_id)
        return jsonify({"status": "success", "analysis": analysis})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@api.route("/projects/<project_id>/search-competitors", methods=["POST"])
def search_competitors(project_id):
    """Search for competitor products."""
    project = pipeline.get_project(project_id)
    if not project:
        return jsonify({"error": "Project not found"}), 404

    try:
        data = pipeline.run_competitor_search(project_id)
        return jsonify({"status": "success", "competitor_data": data})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ── Section Generation ───────────────────────────────────────────

@api.route("/projects/<project_id>/sections/<section_id>/generate", methods=["POST"])
def generate_section(project_id, section_id):
    """Generate content for a specific section."""
    project = pipeline.get_project(project_id)
    if not project:
        return jsonify({"error": "Project not found"}), 404

    body = request.get_json(silent=True) or {}
    custom_instructions = body.get("custom_instructions", "")

    try:
        content = pipeline.generate_section(project_id, section_id, custom_instructions)
        return jsonify({"status": "success", "content": content})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@api.route("/projects/<project_id>/sections/<section_id>/generate-image", methods=["POST"])
def generate_section_image(project_id, section_id):
    """Generate image for a specific section."""
    project = pipeline.get_project(project_id)
    if not project:
        return jsonify({"error": "Project not found"}), 404

    try:
        image_path = pipeline.generate_section_image(project_id, section_id)
        if image_path:
            image_url = "/static/generated/" + os.path.basename(image_path)
            return jsonify({"status": "success", "image_url": image_url})
        else:
            return jsonify({"status": "warning", "message": "이미지 생성 실패. 텍스트 콘텐츠만 사용됩니다."})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@api.route("/projects/<project_id>/generate-all", methods=["POST"])
def generate_all_sections(project_id):
    """Start generating all 15 sections (runs in background)."""
    project = pipeline.get_project(project_id)
    if not project:
        return jsonify({"error": "Project not found"}), 404

    body = request.get_json(silent=True) or {}
    section_instructions = body.get("section_instructions", {})

    def run_generation():
        try:
            pipeline.generate_all_sections(project_id, section_instructions)
        except Exception as e:
            project["status"] = "error"
            project["progress_message"] = str(e)

    thread = threading.Thread(target=run_generation, daemon=True)
    thread.start()

    return jsonify({
        "status": "started",
        "message": "전체 섹션 생성이 시작되었습니다. 진행 상황을 확인하세요.",
    })


# ── Section Definitions ──────────────────────────────────────────

@api.route("/sections", methods=["GET"])
def list_sections():
    """Get all 15 section definitions."""
    return jsonify(get_all_sections())


# ── Export ───────────────────────────────────────────────────────

@api.route("/projects/<project_id>/export", methods=["GET"])
def export_project(project_id):
    """Export project data for HTML generation."""
    export_data = pipeline.export_project(project_id)
    if not export_data:
        return jsonify({"error": "Project not found"}), 404

    # Convert image paths to URLs
    for section in export_data["sections"]:
        if section.get("image_path"):
            section["image_url"] = "/static/generated/" + os.path.basename(section["image_path"])

    return jsonify(export_data)


@api.route("/projects/<project_id>/export-html", methods=["GET"])
def export_html(project_id):
    """Generate and return a standalone HTML detail page."""
    export_data = pipeline.export_project(project_id)
    if not export_data:
        return jsonify({"error": "Project not found"}), 404

    html = generate_detail_page_html(export_data)
    return html, 200, {"Content-Type": "text/html; charset=utf-8"}


def generate_detail_page_html(data: dict) -> str:
    """Generate a full HTML detail page from project data."""
    product = data.get("product_analysis", {})
    sections_html = ""

    for section in data.get("sections", []):
        content = section.get("content", {})
        if not content:
            continue

        color_scheme = content.get("color_scheme", {})
        bg = color_scheme.get("background", "#FFFFFF")
        text_primary = color_scheme.get("text_primary", "#333333")
        text_secondary = color_scheme.get("text_secondary", "#666666")
        accent = color_scheme.get("accent", "#FF6B35")

        font = content.get("font_suggestion", {})
        headline_size = font.get("headline_size", "36px")
        body_size = font.get("body_size", "16px")

        image_tag = ""
        if section.get("image_url"):
            image_tag = f'<img src="{section["image_url"]}" alt="{section["section_name"]}" style="max-width:100%;border-radius:12px;margin:20px 0;">'

        sections_html += f"""
    <section style="background:{bg};padding:60px 20px;text-align:center;">
      <div style="max-width:860px;margin:0 auto;">
        <h2 style="font-size:{headline_size};color:{text_primary};margin-bottom:12px;font-weight:700;">
          {content.get('headline', '')}
        </h2>
        <h3 style="font-size:20px;color:{text_secondary};margin-bottom:24px;font-weight:400;">
          {content.get('subheadline', '')}
        </h3>
        {image_tag}
        <p style="font-size:{body_size};color:{text_secondary};line-height:1.8;max-width:680px;margin:0 auto;">
          {content.get('body_text', '')}
        </p>
        {"<a href='#' style='display:inline-block;margin-top:24px;padding:14px 40px;background:" + accent + ";color:#fff;border-radius:8px;text-decoration:none;font-size:18px;font-weight:600;'>" + content.get('cta_text', '') + "</a>" if content.get('cta_text') else ""}
      </div>
    </section>"""

    html = f"""<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{product.get('product_name', '상세페이지')}</title>
    <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@300;400;500;700;900&display=swap" rel="stylesheet">
    <style>
        * {{ margin: 0; padding: 0; box-sizing: border-box; }}
        body {{ font-family: 'Noto Sans KR', sans-serif; color: #333; }}
        img {{ max-width: 100%; height: auto; }}
        section {{ width: 100%; }}
    </style>
</head>
<body>
    {sections_html}
</body>
</html>"""
    return html
