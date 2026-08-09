import os
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def test_task_owned_runtime_paths_follow_server_only_environment(tmp_path):
    archive_root = tmp_path / "archive"
    state_root = tmp_path / "state"
    env = {
        **os.environ,
        "PYTHONPATH": str(ROOT / "backend"),
        "KUASANGSE_LOCAL_ARCHIVE_FOLDER": str(archive_root),
        "KUASANGSE_LOCAL_STATE_FOLDER": str(state_root),
    }
    command = (
        "from config import Config;"
        "print(Config.LOCAL_ARCHIVE_FOLDER);"
        "print(Config.LOCAL_STATE_FOLDER)"
    )

    result = subprocess.run(
        [sys.executable, "-c", command],
        cwd=ROOT,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    lines = result.stdout.strip().splitlines()
    assert lines == [
        str(archive_root.resolve()),
        str(state_root.resolve()),
    ]


def test_workspace_authority_uses_task_owned_state_folder(tmp_path):
    state_root = tmp_path / "state"
    env = {
        **os.environ,
        "PYTHONPATH": str(ROOT / "backend"),
        "KUASANGSE_LOCAL_STATE_FOLDER": str(state_root),
        "GEMINI_API_KEY": "test-only-placeholder",
        "GOOGLE_GENAI_USE_VERTEXAI": "false",
    }
    env.pop("SSL_CERT_FILE", None)
    command = (
        "from routes.api_workspace_lock import _DEFAULT_STATE_PATH;"
        "print(_DEFAULT_STATE_PATH)"
    )

    result = subprocess.run(
        [sys.executable, "-c", command],
        cwd=ROOT,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == str(
        (state_root / "workspace-authority.json").resolve()
    )
