"""
15 Detail Page Section Definitions
Each section has a specific purpose in the product detail page flow.
"""

SECTIONS = [
    {
        "section_number": 1,
        "section_name": "헤더 (Header)",
        "section_id": "header",
        "purpose": "제품을 깔끔한 화이트톤 배경으로 강조. 제품명을 상단에 크고 임팩트 있게 표시. 첫인상을 결정하는 영역.",
        "default_style": {
            "background": "#FFFFFF",
            "layout": "center-focused",
            "product_position": "center",
            "text_position": "top",
            "font_weight": "bold",
            "font_size_headline": "48px",
        },
        "description": "화이트 배경 + 제품 중앙 배치 + 제품명 강조",
        "icon": "🎯",
    },
    {
        "section_number": 2,
        "section_name": "훅 (Hook)",
        "section_id": "hook",
        "purpose": "구매 욕구를 자극하는 강렬한 비주얼과 카피. 고객의 페인포인트를 건드리고 제품이 해결책임을 암시.",
        "default_style": {
            "background": "gradient",
            "layout": "hero-style",
            "emphasis": "emotional",
            "font_size_headline": "42px",
        },
        "description": "구매 욕구 자극 훅 메시지 + 감성 이미지",
        "icon": "🪝",
    },
    {
        "section_number": 3,
        "section_name": "핵심 특징 (Key Features)",
        "section_id": "key_features",
        "purpose": "제품의 핵심 특장점 3~5가지를 아이콘/이미지와 함께 명확하게 전달.",
        "default_style": {
            "background": "#F8F9FA",
            "layout": "grid-3col",
            "icon_style": "minimal",
            "font_size_headline": "36px",
        },
        "description": "핵심 특장점 3~5가지 아이콘+텍스트 그리드",
        "icon": "⭐",
    },
    {
        "section_number": 4,
        "section_name": "상세 스펙 (Specifications)",
        "section_id": "specifications",
        "purpose": "제품의 상세 사양, 크기, 재질, 무게 등 구체적인 정보 제공.",
        "default_style": {
            "background": "#FFFFFF",
            "layout": "split-image-text",
            "font_size_headline": "32px",
        },
        "description": "상세 사양 테이블 + 제품 디테일 이미지",
        "icon": "📐",
    },
    {
        "section_number": 5,
        "section_name": "사용 시나리오 (Use Scenarios)",
        "section_id": "use_scenarios",
        "purpose": "다양한 사용 상황을 보여주어 고객이 자신의 라이프스타일에서 제품을 상상할 수 있게 함.",
        "default_style": {
            "background": "#F5F0EB",
            "layout": "lifestyle-gallery",
            "font_size_headline": "36px",
        },
        "description": "라이프스타일 이미지 + 사용 상황 텍스트",
        "icon": "🏠",
    },
    {
        "section_number": 6,
        "section_name": "비교 우위 (Competitive Edge)",
        "section_id": "competitive_edge",
        "purpose": "경쟁 제품 대비 우위점을 시각적으로 비교. Before/After 또는 비교 테이블 활용.",
        "default_style": {
            "background": "#FFFFFF",
            "layout": "comparison-table",
            "font_size_headline": "34px",
        },
        "description": "경쟁사 대비 비교표 또는 Before/After",
        "icon": "🏆",
    },
    {
        "section_number": 7,
        "section_name": "소재/기술 (Material & Technology)",
        "section_id": "material_tech",
        "purpose": "사용된 소재의 우수성이나 특허 기술 등을 시각적으로 설명.",
        "default_style": {
            "background": "#1A1A2E",
            "text_color": "#FFFFFF",
            "layout": "tech-showcase",
            "font_size_headline": "36px",
        },
        "description": "소재/기술력 강조 다크톤 섹션",
        "icon": "🔬",
    },
    {
        "section_number": 8,
        "section_name": "인증/수상 (Certifications)",
        "section_id": "certifications",
        "purpose": "제품이 받은 인증, 수상 내역, 테스트 결과 등으로 신뢰도 구축.",
        "default_style": {
            "background": "#F8F9FA",
            "layout": "badge-row",
            "font_size_headline": "32px",
        },
        "description": "인증마크/수상내역 배지 나열",
        "icon": "🏅",
    },
    {
        "section_number": 9,
        "section_name": "리뷰/후기 (Reviews)",
        "section_id": "reviews",
        "purpose": "실제 사용자 후기를 활용한 사회적 증거. 별점, 포토 리뷰 등으로 신뢰 강화.",
        "default_style": {
            "background": "#FFF9F0",
            "layout": "review-cards",
            "font_size_headline": "34px",
        },
        "description": "고객 리뷰 카드 레이아웃",
        "icon": "💬",
    },
    {
        "section_number": 10,
        "section_name": "크기/컬러 가이드 (Size & Color Guide)",
        "section_id": "size_color",
        "purpose": "사이즈 차트, 컬러 옵션 등 선택에 도움되는 정보 제공.",
        "default_style": {
            "background": "#FFFFFF",
            "layout": "option-showcase",
            "font_size_headline": "32px",
        },
        "description": "사이즈표 + 컬러 스와치 옵션",
        "icon": "🎨",
    },
    {
        "section_number": 11,
        "section_name": "프로모션 (Promotion)",
        "section_id": "promotion",
        "purpose": "특별 할인, 세트 구성, 사은품 등 구매 촉진 이벤트 섹션.",
        "default_style": {
            "background": "gradient-warm",
            "layout": "promotion-banner",
            "font_size_headline": "40px",
        },
        "description": "할인/이벤트/세트 구성 프로모션 배너",
        "icon": "🎁",
    },
    {
        "section_number": 12,
        "section_name": "배송/포장 (Shipping & Packaging)",
        "section_id": "shipping",
        "purpose": "배송 정보, 포장 상태, 언박싱 경험 등을 보여줌.",
        "default_style": {
            "background": "#F0F4F8",
            "layout": "info-blocks",
            "font_size_headline": "32px",
        },
        "description": "배송정보 + 패키징 이미지",
        "icon": "📦",
    },
    {
        "section_number": 13,
        "section_name": "FAQ (자주 묻는 질문)",
        "section_id": "faq",
        "purpose": "고객들이 자주 묻는 질문을 미리 답변하여 구매 불안 해소.",
        "default_style": {
            "background": "#FFFFFF",
            "layout": "accordion",
            "font_size_headline": "32px",
        },
        "description": "아코디언 형식 FAQ 섹션",
        "icon": "❓",
    },
    {
        "section_number": 14,
        "section_name": "브랜드 스토리 (Brand Story)",
        "section_id": "brand_story",
        "purpose": "브랜드의 철학, 스토리, 가치를 전달하여 감성적 연결 형성.",
        "default_style": {
            "background": "#1A1A2E",
            "text_color": "#FFFFFF",
            "layout": "story-scroll",
            "font_size_headline": "36px",
        },
        "description": "브랜드 스토리텔링 다크 섹션",
        "icon": "📖",
    },
    {
        "section_number": 15,
        "section_name": "CTA 푸터 (Call to Action Footer)",
        "section_id": "cta_footer",
        "purpose": "최종 구매 결정을 유도하는 강력한 CTA. 가격, 구매 버튼, 긴급성 요소 포함.",
        "default_style": {
            "background": "gradient-brand",
            "layout": "cta-centered",
            "font_size_headline": "44px",
        },
        "description": "최종 CTA + 가격 + 구매버튼",
        "icon": "🛒",
    },
]


def get_section_by_id(section_id: str) -> dict:
    for s in SECTIONS:
        if s["section_id"] == section_id:
            return s
    return None


def get_all_sections() -> list:
    return SECTIONS
