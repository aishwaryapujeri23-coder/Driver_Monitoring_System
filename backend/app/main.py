"""
Application entrypoint.

Run with:
    uvicorn app.main:app --reload
or:
    python run.py   (from the project root)

FastAPI serves BOTH the API (/api/*) and the static frontend (/) so the
whole app is a single process — no separate frontend server, no Node.js,
no build step. This is a deliberate simplicity choice for the 3-hour MVP
scope: one command starts everything.
"""

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.config import settings
from app.database import init_db
from app.routes import analytics, auth, calibration, sessions

logging.basicConfig(
    level=logging.DEBUG if settings.DEBUG else logging.INFO,
    format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
)
logger = logging.getLogger(__name__)

BASE_DIR = Path(__file__).resolve().parent.parent.parent
FRONTEND_DIR = BASE_DIR / "frontend"


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting %s (env=%s)", settings.APP_NAME, settings.APP_ENV)
    init_db()
    logger.info("Database ready at %s", settings.DATABASE_URL)
    yield
    logger.info("Shutting down %s", settings.APP_NAME)


app = FastAPI(
    title=settings.APP_NAME,
    description=(
        "Real-time driver drowsiness and distraction detection — MediaPipe "
        "face-landmark analysis in the browser, YOLO phone detection and "
        "session persistence on the backend."
    ),
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
app.include_router(calibration.router, prefix="/api/calibration", tags=["calibration"])
app.include_router(sessions.router, prefix="/api/sessions", tags=["sessions"])
app.include_router(analytics.router, prefix="/api/analytics", tags=["analytics"])


@app.get("/api/health", tags=["health"])
def health_check() -> dict:
    return {"status": "ok", "service": settings.APP_NAME}


# Serve the frontend's static assets (css/js/assets) under /css, /js, /assets
if FRONTEND_DIR.exists():
    app.mount("/css", StaticFiles(directory=str(FRONTEND_DIR / "css")), name="css")
    app.mount("/js", StaticFiles(directory=str(FRONTEND_DIR / "js")), name="js")
    assets_dir = FRONTEND_DIR / "assets"
    if assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=str(assets_dir)), name="assets")

    # Explicit page routes (kept explicit rather than a catch-all so /api/*
    # and /docs are never accidentally shadowed by the static file server).
    from fastapi.responses import FileResponse

    def _serve(filename: str):
        def _handler():
            return FileResponse(str(FRONTEND_DIR / filename))
        return _handler

    for page in [
        "index.html",
        "login.html",
        "register.html",
        "dashboard.html",
        "history.html",
        "session-details.html",
    ]:
        app.get(f"/{page}", include_in_schema=False)(_serve(page))

    app.get("/", include_in_schema=False)(_serve("index.html"))
