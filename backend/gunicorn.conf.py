"""
Gunicorn configuration for BookWise backend.

Centralises Gunicorn settings and ensures application logging is properly
configured in every worker process. Without the post_fork hook, Gunicorn's
internal dictConfig call (disable_existing_loggers=True) silently discards
the root logger handlers that app.py sets up in the master process, causing
all service logs (gemini_service, pipeline, openlibrary_service…) to vanish
in production while still working locally.
"""
import logging
import sys

# ── Gunicorn settings ────────────────────────────────────────────────────────
loglevel = "info"
timeout = 120  # seconds – allow time for Gemini/OpenLibrary calls
accesslog = "-"   # stdout  → Render captures it
errorlog = "-"    # stderr  → Render captures it
access_log_format = '%(h)s "%(r)s" %(s)s %(b)sB %(Dms)sms'


# ── Logging hook ─────────────────────────────────────────────────────────────
def post_fork(server, worker):  # noqa: ARG001
    """Re-configure root logger in every worker after Gunicorn forks.

    Gunicorn may reset logging in workers via dictConfig. This hook runs
    after that setup and guarantees our handlers are in place for every
    worker process that handles requests.
    """
    fmt = logging.Formatter("%(asctime)s [%(levelname)s] %(name)s: %(message)s")
    root = logging.getLogger()
    root.handlers.clear()
    handler = logging.StreamHandler(sys.stderr)
    handler.setFormatter(fmt)
    root.addHandler(handler)
    root.setLevel(logging.INFO)
