from __future__ import annotations

from control_tower.backend.config import ControlTowerConfig


def test_factory_backend_default_migrates_without_removing_env_override() -> None:
    # Given: a fresh runtime and an explicit isolated override.
    default_config = ControlTowerConfig.from_env({})
    override_config = ControlTowerConfig.from_env(
        {"CONTROL_TOWER_FACTORY_BACKEND_URL": "http://127.0.0.1:41999"},
    )

    # When/Then: new sessions use the assigned port while explicit test/runtime isolation remains supported.
    assert default_config.factory_backend_url == "http://127.0.0.1:43030"
    assert override_config.factory_backend_url == "http://127.0.0.1:41999"
