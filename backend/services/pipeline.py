"""
Pipeline Orchestrator - Coordinates the full detail page generation workflow
Similar to N8N node-based flow but in Python code
"""
import os
import json
import uuid
import time
from datetime import datetime
from services.gemini_service import GeminiService
from services.search_service import SearchService
from services.section_definitions import SECTIONS, get_section_by_id
from config import Config


class PipelineOrchestrator:
    def __init__(self):
        self.gemini = GeminiService()
        self.search = SearchService()
        self.projects = {}  # In-memory project store

    def create_project(self, image_path: str, product_name: str = "") -> dict:
        """Create a new project and start the analysis pipeline."""
        project_id = str(uuid.uuid4())[:8]
        project = {
            "id": project_id,
            "image_path": image_path,
            "product_name": product_name,
            "created_at": datetime.now().isoformat(),
            "status": "created",
            "analysis": None,
            "competitor_data": None,
            "sections": {},
            "generated_images": {},
            "progress": 0,
            "progress_message": "",
        }
        self.projects[project_id] = project
        return project

    def run_analysis(self, project_id: str) -> dict:
        """Step 1: Analyze the product image."""
        project = self.projects[project_id]
        project["status"] = "analyzing"
        project["progress"] = 5
        project["progress_message"] = "제품 이미지 분석 중..."

        try:
            analysis = self.gemini.analyze_product_image(project["image_path"])
            if project["product_name"]:
                analysis["product_name"] = project["product_name"]
            project["analysis"] = analysis
            project["status"] = "analyzed"
            project["progress"] = 20
            project["progress_message"] = "제품 분석 완료"
            return analysis
        except Exception as e:
            project["status"] = "error"
            project["progress_message"] = f"분석 실패: {str(e)}"
            raise

    def run_competitor_search(self, project_id: str) -> dict:
        """Step 2: Search for competitor products and detail pages."""
        project = self.projects[project_id]
        if not project["analysis"]:
            raise ValueError("Product analysis must be done first")

        project["status"] = "searching_competitors"
        project["progress"] = 25
        project["progress_message"] = "경쟁 제품 검색 중..."

        try:
            competitor_data = self.search.get_competitor_analysis(project["analysis"])
            project["competitor_data"] = competitor_data
            project["status"] = "competitors_found"
            project["progress"] = 35
            project["progress_message"] = f"경쟁 제품 {len(competitor_data.get('similar_products', []))}개 발견"
            return competitor_data
        except Exception as e:
            # Non-critical: continue without competitor data
            project["competitor_data"] = {"similar_products": [], "detail_page_references": [], "market_summary": {}}
            project["progress"] = 35
            project["progress_message"] = "경쟁 분석 건너뜀 (API 키 확인 필요)"
            return project["competitor_data"]

    def generate_section(self, project_id: str, section_id: str, custom_instructions: str = "") -> dict:
        """Step 3: Generate content for a specific section."""
        project = self.projects[project_id]
        section_def = get_section_by_id(section_id)
        if not section_def:
            raise ValueError(f"Unknown section: {section_id}")

        section_config = {
            **section_def,
            "custom_instructions": custom_instructions,
        }

        project["progress_message"] = f"섹션 생성 중: {section_def['section_name']}..."

        try:
            content = self.gemini.generate_section_content(
                section_config,
                project["analysis"],
                project.get("competitor_data"),
            )
            project["sections"][section_id] = {
                "config": section_config,
                "content": content,
                "generated_at": datetime.now().isoformat(),
                "image_path": None,
            }
            return content
        except Exception as e:
            raise Exception(f"Section generation failed: {str(e)}")

    def generate_section_image(self, project_id: str, section_id: str) -> str:
        """Step 4: Generate image for a section."""
        project = self.projects[project_id]
        section_data = project["sections"].get(section_id)
        if not section_data:
            raise ValueError(f"Section content not generated yet: {section_id}")

        content = section_data["content"]
        image_prompt = content.get("image_prompt", "")
        section_name = section_data["config"]["section_name"]

        # Build a comprehensive prompt
        full_prompt = f"""Create a professional Korean e-commerce product detail page section image.
Section: {section_name}
Style: {content.get('layout_suggestion', 'modern clean')}
Colors: Background {content.get('color_scheme', {}).get('background', '#FFFFFF')}, Accent {content.get('color_scheme', {}).get('accent', '#000000')}
Headline: {content.get('headline', '')}
Additional: {image_prompt}
Requirements: High quality, 860px wide, Korean e-commerce style. Clean and professional."""

        try:
            # Try composite with product image first
            image_path = self.gemini.generate_composite_image(
                full_prompt,
                project["image_path"],
                section_id,
                project_id,
            )

            if not image_path:
                # Fallback to standalone image generation
                image_path = self.gemini.generate_section_image(
                    full_prompt,
                    section_id,
                    project_id,
                )

            if image_path:
                project["sections"][section_id]["image_path"] = image_path
                project["generated_images"][section_id] = image_path

            return image_path
        except Exception as e:
            print(f"Image generation failed for {section_id}: {e}")
            return None

    def generate_all_sections(self, project_id: str, section_instructions: dict = None) -> dict:
        """Generate all 15 sections sequentially."""
        project = self.projects[project_id]
        results = {}
        total_sections = len(SECTIONS)

        for i, section_def in enumerate(SECTIONS):
            section_id = section_def["section_id"]
            custom = ""
            if section_instructions and section_id in section_instructions:
                custom = section_instructions[section_id]

            progress_base = 35
            progress_per_section = 60 / total_sections
            project["progress"] = int(progress_base + (i * progress_per_section))
            project["progress_message"] = f"[{i+1}/{total_sections}] {section_def['section_name']} 생성 중..."

            try:
                content = self.generate_section(project_id, section_id, custom)
                results[section_id] = {"status": "success", "content": content}

                # Generate image for this section
                project["progress_message"] = f"[{i+1}/{total_sections}] {section_def['section_name']} 이미지 생성 중..."
                image_path = self.generate_section_image(project_id, section_id)
                results[section_id]["image_path"] = image_path

            except Exception as e:
                results[section_id] = {"status": "error", "error": str(e)}

            # Small delay to avoid API rate limiting
            time.sleep(1)

        project["status"] = "completed"
        project["progress"] = 100
        project["progress_message"] = "모든 섹션 생성 완료!"
        return results

    def get_project(self, project_id: str) -> dict:
        return self.projects.get(project_id)

    def get_project_summary(self, project_id: str) -> dict:
        project = self.projects.get(project_id)
        if not project:
            return None

        summary = {
            "id": project["id"],
            "status": project["status"],
            "progress": project["progress"],
            "progress_message": project["progress_message"],
            "product_name": project.get("analysis", {}).get("product_name", ""),
            "created_at": project["created_at"],
            "sections_completed": len(project.get("sections", {})),
            "total_sections": len(SECTIONS),
            "images_generated": len(project.get("generated_images", {})),
        }
        return summary

    def export_project(self, project_id: str) -> dict:
        """Export project data for HTML generation."""
        project = self.projects.get(project_id)
        if not project:
            return None

        export_data = {
            "project_id": project_id,
            "product_analysis": project.get("analysis", {}),
            "competitor_data": project.get("competitor_data", {}),
            "sections": [],
        }

        for section_def in SECTIONS:
            sid = section_def["section_id"]
            section_data = project["sections"].get(sid, {})
            export_data["sections"].append({
                "section_number": section_def["section_number"],
                "section_name": section_def["section_name"],
                "section_id": sid,
                "content": section_data.get("content", {}),
                "image_path": section_data.get("image_path", ""),
                "config": section_def,
            })

        return export_data


# Singleton
pipeline = PipelineOrchestrator()
