"""
API Routes for the Product Detail Page Generator

Domain modules (behavior-preserving split):
- api_shared.py   : blueprint + shared helpers
- api_archive.py  : last-work, recovery, local-archive
- api_marketplus.py : Cafe24 MarketPlus / Chrome CDP automation
- api_core.py     : projects, gemini, sections, provider, scrapers, etc.

Import `api` from this module as before: `from routes.api import api`
"""
from routes.api_shared import api  # noqa: F401

# Register routes (order matches historical file layout)
from routes import api_workspace_lock  # noqa: F401,E402
from routes import api_archive  # noqa: F401,E402
from routes import api_marketplus  # noqa: F401,E402
from routes import api_core  # noqa: F401,E402
from routes import api_vm  # noqa: F401,E402
from routes import api_scrapling  # noqa: F401,E402
from routes import api_workfile_reports  # noqa: F401,E402

__all__ = ["api"]
