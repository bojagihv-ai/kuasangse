from __future__ import annotations

import os
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Final
from urllib.parse import urlsplit


DEFAULT_BACKEND_HOST: Final = "127.0.0.1"
DEFAULT_BACKEND_PORT: Final = 5062
DEFAULT_FRONTEND_HOST: Final = "127.0.0.1"
DEFAULT_FRONTEND_PORT: Final = 8082
DEFAULT_FACTORY_FRONTEND_URL: Final = "http://127.0.0.1:8081"
DEFAULT_FACTORY_BACKEND_URL: Final = "http://127.0.0.1:5050"
DEFAULT_API_HUB_URL: Final = "http://127.0.0.1:4321"
DEFAULT_CACHE_ROOT: Final = "output/batch-control"
DEFAULT_PDP_CONTROL_URL: Final = "http://127.0.0.1:8200/api/pdp-control/v1"
DEFAULT_PDP_ASSETS_URL: Final = "http://127.0.0.1:8200/api/pdp-assets/v1"


class ConfigurationError(Exception):
    def __init__(self, field: str, value: str, reason: str) -> None:
        self.field = field
        self.value = value
        self.reason = reason
        super().__init__(field, value, reason)

    def __str__(self) -> str:
        return f"invalid {self.field}={self.value!r}: {self.reason}"


def _env_value(
    env: Mapping[str, str],
    names: tuple[str, ...],
    default: str,
) -> str:
    for name in names:
        if name in env:
            return env[name]
    return default


def _parse_port(raw: str, field: str) -> int:
    value = raw.strip()
    if not value.isdecimal():
        raise ConfigurationError(field, raw, "must be a decimal integer from 1 to 65535")
    try:
        port = int(value)
    except ValueError as error:
        raise ConfigurationError(field, raw, "must be a decimal integer from 1 to 65535") from error
    if not 1 <= port <= 65535:
        raise ConfigurationError(field, raw, "must be a decimal integer from 1 to 65535")
    return port


def _validate_port(port: int, field: str) -> None:
    if type(port) is not int or not 1 <= port <= 65535:
        raise ConfigurationError(field, str(port), "must be an integer from 1 to 65535")


def _parse_bind_host(raw: str, field: str) -> str:
    value = raw.strip()
    if value != DEFAULT_BACKEND_HOST:
        raise ConfigurationError(field, raw, "only 127.0.0.1 is allowed")
    return value


def _parse_local_origin(raw: str, field: str) -> str:
    value = raw.strip()
    if value == "*":
        raise ConfigurationError(field, raw, "wildcard origins are not allowed")
    parsed = urlsplit(value)
    if parsed.scheme != "http" or parsed.hostname not in {"127.0.0.1", "localhost"}:
        raise ConfigurationError(field, raw, "must be an http origin on 127.0.0.1 or localhost")
    if parsed.username is not None or parsed.password is not None:
        raise ConfigurationError(field, raw, "credentials are not allowed in an origin")
    if parsed.path or parsed.query or parsed.fragment:
        raise ConfigurationError(field, raw, "must not contain a path, query, or fragment")
    try:
        port = parsed.port
    except ValueError as error:
        raise ConfigurationError(field, raw, "origin port must be from 1 to 65535") from error
    if port is not None and not 1 <= port <= 65535:
        raise ConfigurationError(field, raw, "origin port must be from 1 to 65535")
    if parsed.netloc != value.removeprefix("http://"):
        raise ConfigurationError(field, raw, "origin must use its exact local HTTP form")
    return value


def _parse_origins(raw: str, default: str) -> tuple[str, ...]:
    values = tuple(item.strip() for item in raw.split(",") if item.strip()) if raw.strip() else (default,)
    origins = tuple(dict.fromkeys(_parse_local_origin(value, "CONTROL_TOWER_CORS_ORIGINS") for value in values))
    if not origins:
        raise ConfigurationError("CONTROL_TOWER_CORS_ORIGINS", raw, "at least one local origin is required")
    return origins


@dataclass(frozen=True, slots=True)
class ControlTowerConfig:
    backend_host: str = DEFAULT_BACKEND_HOST
    backend_port: int = DEFAULT_BACKEND_PORT
    frontend_host: str = DEFAULT_FRONTEND_HOST
    frontend_port: int = DEFAULT_FRONTEND_PORT
    factory_frontend_url: str = DEFAULT_FACTORY_FRONTEND_URL
    factory_backend_url: str = DEFAULT_FACTORY_BACKEND_URL
    api_hub_url: str = DEFAULT_API_HUB_URL
    cache_root: str = DEFAULT_CACHE_ROOT
    pdp_control_url: str = DEFAULT_PDP_CONTROL_URL
    pdp_assets_url: str = DEFAULT_PDP_ASSETS_URL
    pdp_service_key: str = ""
    cors_origins: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        _parse_bind_host(self.backend_host, "backend_host")
        _parse_bind_host(self.frontend_host, "frontend_host")
        _validate_port(self.backend_port, "backend_port")
        _validate_port(self.frontend_port, "frontend_port")
        default_origin = f"http://{self.frontend_host}:{self.frontend_port}"
        origins = self.cors_origins or (default_origin,)
        parsed_origins = tuple(_parse_local_origin(origin, "cors_origins") for origin in origins)
        object.__setattr__(self, "cors_origins", tuple(dict.fromkeys(parsed_origins)))

    @classmethod
    def from_env(cls, env: Mapping[str, str] | None = None) -> ControlTowerConfig:
        source = os.environ if env is None else env
        backend_host = _parse_bind_host(
            _env_value(source, ("CONTROL_TOWER_BACKEND_HOST", "CONTROL_TOWER_HOST"), DEFAULT_BACKEND_HOST),
            "CONTROL_TOWER_BACKEND_HOST",
        )
        backend_port = _parse_port(
            _env_value(source, ("CONTROL_TOWER_BACKEND_PORT", "CONTROL_TOWER_PORT"), str(DEFAULT_BACKEND_PORT)),
            "CONTROL_TOWER_BACKEND_PORT",
        )
        frontend_host = _parse_bind_host(
            _env_value(source, ("CONTROL_TOWER_FRONTEND_HOST",), DEFAULT_FRONTEND_HOST),
            "CONTROL_TOWER_FRONTEND_HOST",
        )
        frontend_port = _parse_port(
            _env_value(source, ("CONTROL_TOWER_FRONTEND_PORT",), str(DEFAULT_FRONTEND_PORT)),
            "CONTROL_TOWER_FRONTEND_PORT",
        )
        default_origin = f"http://{frontend_host}:{frontend_port}"
        cors_origins = _parse_origins(
            _env_value(source, ("CONTROL_TOWER_CORS_ORIGINS",), ""),
            default_origin,
        )
        return cls(
            backend_host=backend_host,
            backend_port=backend_port,
            frontend_host=frontend_host,
            frontend_port=frontend_port,
            factory_frontend_url=_env_value(
                source,
                ("CONTROL_TOWER_FACTORY_FRONTEND_URL",),
                DEFAULT_FACTORY_FRONTEND_URL,
            ).strip(),
            factory_backend_url=_env_value(
                source,
                ("CONTROL_TOWER_FACTORY_BACKEND_URL",),
                DEFAULT_FACTORY_BACKEND_URL,
            ).strip(),
            api_hub_url=_env_value(source, ("CONTROL_TOWER_API_HUB_URL",), DEFAULT_API_HUB_URL).strip(),
            cache_root=_env_value(source, ("CONTROL_TOWER_CACHE_ROOT",), DEFAULT_CACHE_ROOT).strip(),
            pdp_control_url=_env_value(source, ("PDP_CONTROL_BASE_URL",), DEFAULT_PDP_CONTROL_URL).strip(),
            pdp_assets_url=_env_value(source, ("PDP_ASSETS_BASE_URL",), DEFAULT_PDP_ASSETS_URL).strip(),
            pdp_service_key=_env_value(source, ("PDP_CONTROL_SERVICE_KEY",), ""),
            cors_origins=cors_origins,
        )


def load_config(env: Mapping[str, str] | None = None) -> ControlTowerConfig:
    return ControlTowerConfig.from_env(env)
