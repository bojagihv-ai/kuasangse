from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
BOOTSTRAP = ROOT / "tools" / "bootstrap_jepumscraper_vm_worker.ps1"


def test_bootstrap_syncs_current_worker_patch_from_unc_share_without_z_drive() -> None:
    source = BOOTSTRAP.read_text(encoding="utf-8")

    assert "function Get-WorkerSharedSourceRoot" in source
    assert "KuasangseBootstrap\\output\\vm-rebuild\\source-stage\\JepumScraper" in source
    assert "$sourceRoot = Get-WorkerSharedSourceRoot" in source
