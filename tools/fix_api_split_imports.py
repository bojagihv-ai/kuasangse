# -*- coding: utf-8 -*-
from pathlib import Path
import re

root = Path(r"C:\Users\kua\Documents\GitHub\kuasangse\backend\routes")

def patch(path: Path, inject: str) -> None:
    text = path.read_text(encoding="utf-8")
    # Replace only the generated import block at top (after docstring)
    new, n = re.subn(
        r'(?s)^(""".*?"""\s*)from routes\.api_shared import \*  # noqa: F401,F403\nfrom routes\.api_shared import api  # re-export blueprint\n(?:from routes\.api_archive import \*  # noqa: F401,F403\n)?(?:from routes\.api_marketplus import \*  # noqa: F401,F403\n)?\n?',
        r"\1" + inject + "\n",
        text,
        count=1,
    )
    if n != 1:
        raise SystemExit(f"import block not replaced in {path.name}: n={n}")
    path.write_text(new, encoding="utf-8")
    # sanity: must still contain first route
    if "@api.route" not in new:
        raise SystemExit(f"routes missing in {path.name}")
    print("patched", path.name, "len", len(new))

INJECT_SHARED = """import routes.api_shared as _api_shared
from routes.api_shared import api  # noqa: F401
globals().update({k: v for k, v in vars(_api_shared).items() if not k.startswith("__")})
"""

INJECT_MP = INJECT_SHARED + """
import routes.api_archive as _api_archive
globals().update({k: v for k, v in vars(_api_archive).items() if not k.startswith("__") and k != "api"})
"""

INJECT_CORE = INJECT_MP + """
import routes.api_marketplus as _api_marketplus
globals().update({k: v for k, v in vars(_api_marketplus).items() if not k.startswith("__") and k != "api"})
"""

patch(root / "api_archive.py", INJECT_SHARED)
patch(root / "api_marketplus.py", INJECT_MP)
patch(root / "api_core.py", INJECT_CORE)
print("ok")
