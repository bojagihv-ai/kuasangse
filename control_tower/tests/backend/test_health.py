from __future__ import annotations

import re
from pathlib import Path

import pytest

from control_tower.backend.app import create_app
from control_tower.backend.config import DEFAULT_BACKEND_PORT, ConfigurationError, ControlTowerConfig


def test_default_config_uses_isolated_local_runtime_defaults() -> None:
    # Given: 환경변수가 없는 새 생산관제 런타임 설정을 준비한다.
    # When: 경계 설정 파서를 호출한다.
    config = ControlTowerConfig.from_env({})
    # Then: 기존 조립공장과 겹치지 않는 기본값을 사용해야 한다.
    assert config.backend_host == "127.0.0.1"
    assert config.backend_port == 5062
    assert config.frontend_host == "127.0.0.1"
    assert config.frontend_port == 8082
    assert config.cors_origins == ("http://127.0.0.1:8082",)


def test_health_is_deterministic_and_exposes_runtime_topology() -> None:
    # Given: 기본 설정으로 Flask test client를 만든다.
    app = create_app(ControlTowerConfig.from_env({}))
    client = app.test_client()
    # When: 같은 health 엔드포인트를 두 번 조회한다.
    first = client.get("/api/health")
    second = client.get("/api/health")
    # Then: 응답은 동일하고 필요한 서비스 및 연결 토폴로지를 포함해야 한다.
    assert first.status_code == 200
    assert first.get_json() == second.get_json()
    assert first.get_json() == {
        "displayName": "생산관제",
        "links": {
            "apiHub": "http://127.0.0.1:4321",
            "factoryBackend": "http://127.0.0.1:5050",
            "factoryFrontend": "http://127.0.0.1:8081",
        },
        "listen": {"host": "127.0.0.1", "port": 5062},
        "schemaVersion": "1",
        "service": "batch-production-control",
        "status": "ready",
        "version": "1.0.0",
    }


def test_default_backend_port_is_browser_safe_without_chrome_bypass() -> None:
    # Given: Chrome이 차단하는 포트와 실제 정적 프론트엔드 소스를 준비한다.
    restricted_ports = {5060, 5061}
    frontend_source = (Path(__file__).parents[2] / "frontend" / "control-tower.html").read_text(encoding="utf-8")
    # When: 기본 백엔드 포트 계약을 읽는다.
    config = ControlTowerConfig.from_env({})
    # Then: 기본값과 프론트 health URL은 우회 없이 browser-safe 5062를 사용해야 한다.
    assert DEFAULT_BACKEND_PORT == 5062
    assert config.backend_port == 5062
    assert config.backend_port not in restricted_ports
    assert "http://127.0.0.1:5062/api/health" in frontend_source
    assert "http://127.0.0.1:5060/api/health" not in frontend_source
    assert "explicitly-allowed-ports" not in frontend_source


def test_frontend_live_css_rejects_raw_values_outside_semantic_token_root() -> None:
    # Given: production control 화면의 전체 CSS와 token root를 준비한다.
    frontend_source = (Path(__file__).parents[2] / "frontend" / "control-tower.html").read_text(encoding="utf-8")
    style = re.search(r"<style>(?P<css>.*?)</style>", frontend_source, flags=re.DOTALL)
    assert style is not None
    root = re.search(r":root\s*\{(?P<body>.*?)\}", style.group("css"), flags=re.DOTALL)
    assert root is not None
    consumer_css = style.group("css")[: root.start()] + style.group("css")[root.end() :]
    media_thresholds = re.findall(r"@media\s*\(\s*max-width:\s*(\d+px)\s*\)", consumer_css)
    css_without_media_threshold = re.sub(
        r"(@media\s*\(\s*max-width:)\s*\d+px",
        r"\1 <documented-threshold>",
        consumer_css,
    )
    # When: token root 밖의 raw px/rgb/hex 소비와 비-token typography/radius를 찾는다.
    raw_visual_values = re.findall(
        r"(?m)^\s*(?P<property>[\w-]+)\s*:\s*(?P<value>[^;]*(?:#[0-9a-fA-F]{3,8}\b|rgba?\(|\d+(?:\.\d+)?px)[^;]*);",
        css_without_media_threshold,
    )
    token_only_properties = {"border-radius", "font-size", "font-weight", "letter-spacing", "line-height"}
    non_tokenized_properties = [
        (name, value.strip())
        for name, value in re.findall(r"(?m)^\s*([\w-]+)\s*:\s*([^;]+);", consumer_css)
        if name in token_only_properties and not value.strip().startswith("var(")
    ]
    token_names = set(re.findall(r"--([\w-]+)\s*:", root.group("body")))
    required_token_names = set(
        (
            "border-width-default card-min-block-size color-accent-wash color-error-border color-ok-border "
            "color-primary-glow color-surface-sheen content-max-width font-size-page-title font-size-panel-copy "
            "font-size-section-title font-weight-strong grid-min-card grid-min-detail line-height-body page-gutter "
            "radius-card radius-circle radius-pill space-page-bottom status-dot-size status-mark-size tracking-kicker"
        ).split()
    )
    # Then: 유일한 raw px는 주석으로 설명된 media threshold이고 나머지는 모두 의미 token을 사용해야 한다.
    assert raw_visual_values == [], f"raw visual consumer declarations: {raw_visual_values}"
    assert non_tokenized_properties == [], f"non-tokenized visual properties: {non_tokenized_properties}"
    assert media_thresholds == ["720px"]
    assert "CSS custom properties are not supported in media conditions; 720px is the sole raw threshold exception." in consumer_css
    assert required_token_names <= token_names


@pytest.mark.parametrize(
    ("selector", "required_declaration"),
    [
        ("h1", "font-size: var(--font-size-page-title);"),
        (".section", "padding-top: var(--space-2);"),
        (".panel", "padding: var(--space-2);"),
    ],
)
def test_frontend_visual_hierarchy_follows_design_contract(
    selector: str,
    required_declaration: str,
) -> None:
    # Given: 현재 생산관제 정적 프론트엔드와 DESIGN.md의 계층 계약을 준비한다.
    frontend_source = (Path(__file__).parents[2] / "frontend" / "control-tower.html").read_text(encoding="utf-8")
    # When: 계약 대상 selector의 실제 CSS rule을 읽는다.
    rule = re.search(rf"{re.escape(selector)}\s*\{{(?P<body>[^}}]*)\}}", frontend_source)
    # Then: 제목과 주요 간격은 승인된 token 범위를 사용해야 한다.
    assert rule is not None
    assert required_declaration in rule.group("body")


@pytest.mark.parametrize(
    "selector_pattern",
    [
        r"\.lede\s*,\s*\.section-copy\s*,\s*\.card-copy\s*,\s*\.footer-line\s*",
        r"\.scope-row p\s*",
    ],
)
def test_frontend_korean_copy_uses_keep_all_pretty_wrapping(selector_pattern: str) -> None:
    # Given: 긴 한국어 설명문을 표시하는 production control copy rule을 준비한다.
    frontend_source = (Path(__file__).parents[2] / "frontend" / "control-tower.html").read_text(encoding="utf-8")
    # When: 해당 copy selector의 CSS rule을 읽는다.
    rules = list(re.finditer(rf"{selector_pattern}\{{(?P<body>[^}}]*)\}}", frontend_source))
    assert rules
    rule = rules[-1]
    # Then: 단어를 쪼개지 않고 짧은 마지막 줄을 줄이는 browser-native wrapping을 함께 사용해야 한다.
    assert "word-break: keep-all;" in rule.group("body")
    assert "text-wrap: pretty;" in rule.group("body")


def test_frontend_keeps_short_korean_meaning_units_together() -> None:
    # Given: 모바일 폭에서 한 줄로 유지해야 하는 짧은 한국어 의미 단위를 준비한다.
    frontend_source = (Path(__file__).parents[2] / "frontend" / "control-tower.html").read_text(encoding="utf-8")

    # When/Then: 공통 helper와 각 의미 단위가 명시적으로 연결되어야 한다.
    assert ".keep-together" in frontend_source
    assert "white-space: nowrap;" in frontend_source
    assert '<span class="keep-together">이 런타임의 범위가 아닙니다.</span>' in frontend_source
    assert '<span class="keep-together">시작하거나 종료하지 않습니다.</span>' in frontend_source
    assert '<span class="keep-together">표시 기준: 백엔드 health 응답.</span>' in frontend_source
    assert '<span class="keep-together">연결 대상 카드의 URL은 설정값이며</span>' in frontend_source
    assert '<span class="keep-together">실제 연결 상태를 의미하지 않습니다.</span>' in frontend_source
    assert '<span class="keep-together">URL은 설정값이며</span>' not in frontend_source


@pytest.mark.parametrize(
    ("class_attribute", "expected_count"),
    [
        ('class="factory-pill health-chip"', 1),
        ('class="factory-card panel"', 1),
        ('class="factory-card connection-card"', 3),
        ('class="factory-card scope-row"', 4),
        ('class="factory-pill scope-state"', 4),
    ],
)
def test_frontend_composes_existing_factory_component_vocabulary(
    class_attribute: str,
    expected_count: int,
) -> None:
    # Given: 기존 조립공장 디자인 어휘와 생산관제 markup을 준비한다.
    frontend_source = (Path(__file__).parents[2] / "frontend" / "control-tower.html").read_text(encoding="utf-8")
    # When: 실제 DOM class 조합의 사용 횟수를 센다.
    actual_count = frontend_source.count(class_attribute)
    # Then: 모든 상태 pill과 card 계열 요소가 기존 어휘를 합성해야 한다.
    assert actual_count == expected_count


@pytest.mark.parametrize(
    ("selector", "required_declarations"),
    [
        (
            ".factory-card",
            (
                "border: var(--border-width-default) solid var(--color-border-default);",
                "border-radius: var(--radius-card);",
                "background: var(--color-surface-sheen), var(--color-card-background);",
            ),
        ),
        (
            ".factory-pill",
            (
                "display: inline-flex;",
                "align-items: center;",
                "border: var(--border-width-default) solid var(--color-border-default);",
                "border-radius: var(--radius-pill);",
                "font-weight: var(--font-weight-strong);",
                "white-space: nowrap;",
            ),
        ),
    ],
)
def test_frontend_factory_primitives_own_shared_styles(
    selector: str,
    required_declarations: tuple[str, ...],
) -> None:
    # Given: 생산관제 markup에 합성된 공통 factory primitive를 준비한다.
    frontend_source = (Path(__file__).parents[2] / "frontend" / "control-tower.html").read_text(encoding="utf-8")
    # When: primitive selector의 실제 CSS rule을 읽는다.
    rule = re.search(rf"{re.escape(selector)}\s*\{{(?P<body>[^}}]*)\}}", frontend_source)
    # Then: 공통 surface와 pill 속성은 primitive selector가 직접 소유해야 한다.
    assert rule is not None
    assert all(declaration in rule.group("body") for declaration in required_declarations)


@pytest.mark.parametrize(
    ("selector", "forbidden_declarations"),
    [
        (".panel", ("border:", "border-radius:", "background:")),
        (".connection-card", ("border:", "border-radius:", "background:")),
        (".scope-row", ("border:", "border-radius:", "background:")),
        (".health-chip", ("display:", "align-items:", "border:", "border-radius:", "font-weight:", "white-space:")),
        (".scope-state", ("display:", "align-items:", "border:", "border-radius:", "font-weight:", "white-space:")),
    ],
)
def test_frontend_component_modifiers_do_not_redeclare_primitive_styles(
    selector: str,
    forbidden_declarations: tuple[str, ...],
) -> None:
    # Given: 배치, 색상, 크기만 담당하는 component modifier를 준비한다.
    frontend_source = (Path(__file__).parents[2] / "frontend" / "control-tower.html").read_text(encoding="utf-8")
    # When: modifier selector의 실제 CSS rule을 읽는다.
    rule = re.search(rf"{re.escape(selector)}\s*\{{(?P<body>[^}}]*)\}}", frontend_source)
    # Then: 공통 primitive 속성을 modifier가 다시 소유하지 않아야 한다.
    assert rule is not None
    assert all(declaration not in rule.group("body") for declaration in forbidden_declarations)


def test_frontend_card_surface_is_not_owned_by_grouped_modifiers() -> None:
    # Given: factory-card가 적용된 세 card modifier를 준비한다.
    frontend_source = (Path(__file__).parents[2] / "frontend" / "control-tower.html").read_text(encoding="utf-8")
    # When: 과거의 grouped surface selector를 찾는다.
    grouped_rule = re.search(r"\.panel\s*,\s*\.connection-card\s*,\s*\.scope-row\s*\{", frontend_source)
    # Then: 공통 surface는 grouped modifier가 아닌 factory-card가 소유해야 한다.
    assert grouped_rule is None


def test_allowed_local_origin_get_and_options_return_precise_cors_headers() -> None:
    # Given: 기본 로컬 프론트엔드 origin으로 실행하는 test client를 준비한다.
    config = ControlTowerConfig.from_env({})
    client = create_app(config).test_client()
    allowed_origin = "http://127.0.0.1:8082"
    # When: health GET과 preflight OPTIONS를 허용 origin으로 호출한다.
    get_response = client.get("/api/health", headers={"Origin": allowed_origin})
    options_response = client.options(
        "/api/health",
        headers={
            "Origin": allowed_origin,
            "Access-Control-Request-Method": "GET",
        },
    )
    # Then: 정확한 origin만 반사하고 wildcard 및 credentials는 사용하지 않아야 한다.
    assert get_response.status_code == 200
    assert get_response.headers["Access-Control-Allow-Origin"] == allowed_origin
    assert get_response.headers["Vary"] == "Origin"
    assert options_response.status_code == 204
    assert options_response.headers["Access-Control-Allow-Origin"] == allowed_origin
    assert options_response.headers["Access-Control-Allow-Methods"] == "GET, HEAD, OPTIONS"
    assert options_response.headers["Access-Control-Allow-Headers"] == "Content-Type"
    assert "Access-Control-Allow-Credentials" not in get_response.headers
    assert "Access-Control-Allow-Credentials" not in options_response.headers
    assert "*" not in get_response.headers.get("Access-Control-Allow-Origin", "")


def test_disallowed_unsafe_origin_is_rejected_without_cors_permission() -> None:
    # Given: 허용 목록에 없는 origin과 변경 메서드를 준비한다.
    client = create_app(ControlTowerConfig.from_env({})).test_client()
    # When: 변경 요청을 불허 origin으로 보낸다.
    response = client.post(
        "/api/health",
        headers={"Origin": "http://127.0.0.1:9999"},
        json={"claim": True},
    )
    # Then: 명확히 거부되고 허용 origin 헤더가 없어야 한다.
    assert response.status_code == 403
    assert "Access-Control-Allow-Origin" not in response.headers
    assert "*" not in response.headers.values()


@pytest.mark.parametrize(
    ("env_name", "value"),
    [
        ("CONTROL_TOWER_CORS_ORIGINS", "*"),
        ("CONTROL_TOWER_CORS_ORIGINS", "http://example.com"),
        ("CONTROL_TOWER_CORS_ORIGINS", "http://0.0.0.0:8082"),
    ],
)
def test_invalid_cors_origin_is_rejected_at_configuration_boundary(
    env_name: str,
    value: str,
) -> None:
    # Given: wildcard 또는 non-loopback origin을 설정한다.
    # When: 설정 경계를 파싱한다.
    # Then: 서버 준비 전에 명확한 설정 오류가 나야 한다.
    with pytest.raises(ConfigurationError):
        ControlTowerConfig.from_env({env_name: value})


@pytest.mark.parametrize(
    "value",
    ["0", "65536", "999999999999999999999", "not-a-port", ""],
)
def test_invalid_backend_port_is_rejected_before_ready(value: str) -> None:
    # Given: 범위를 벗어나거나 숫자가 아닌 백엔드 포트를 설정한다.
    # When: 서버 설정을 파싱한다.
    # Then: Flask app이 만들어지기 전에 설정 오류가 나야 한다.
    with pytest.raises(ConfigurationError):
        ControlTowerConfig.from_env({"CONTROL_TOWER_BACKEND_PORT": value})


def test_non_loopback_bind_host_is_rejected_before_ready() -> None:
    # Given: 모든 인터페이스에 바인딩하려는 설정을 준비한다.
    # When: 서버 설정을 파싱한다.
    # Then: loopback 외 bind host는 명확히 거부되어야 한다.
    with pytest.raises(ConfigurationError):
        ControlTowerConfig.from_env({"CONTROL_TOWER_BACKEND_HOST": "0.0.0.0"})


def test_unknown_route_does_not_claim_ready() -> None:
    # Given: health 외 경로를 가진 Flask test client를 준비한다.
    client = create_app(ControlTowerConfig.from_env({})).test_client()
    # When: 등록되지 않은 API 경로를 조회한다.
    response = client.get("/api/not-a-real-route")
    # Then: 404이며 ready 상태를 위조하지 않아야 한다.
    assert response.status_code == 404
    assert "ready" not in response.get_data(as_text=True).lower()
