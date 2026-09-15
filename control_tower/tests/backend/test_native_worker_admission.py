from copy import deepcopy

import pytest

from control_tower.backend.factory_sync import FactorySyncBridge, FactorySyncError
from test_factory_sync import _hello


def test_visible_worker_cannot_replace_a_live_session_or_reduce_its_projection() -> None:
    bridge = FactorySyncBridge()
    first = _hello()
    bridge.hello(first)
    before = deepcopy(bridge.current_state())
    target = bridge.active_worker_target()
    second = {**_hello(session_id="new-console"), "startedAt": 2000, "replaceExistingSession": False}
    with pytest.raises(FactorySyncError, match="factory_worker_already_connected"):
        bridge.hello(second)
    assert bridge.current_state() == before
    assert bridge.active_worker_target() == target


def test_visible_worker_admits_when_idle_and_repeated_own_hello_is_allowed() -> None:
    bridge = FactorySyncBridge()
    assert bridge.hello({**_hello(), "replaceExistingSession": False})["accepted"] is True
    assert bridge.hello({**_hello(cursor=2), "replaceExistingSession": False})["accepted"] is True


def test_existing_hidden_worker_recovery_contract_is_unchanged() -> None:
    bridge = FactorySyncBridge()
    bridge.hello(_hello())
    assert bridge.hello({**_hello(session_id="replacement"), "startedAt": 2000})["accepted"] is True
