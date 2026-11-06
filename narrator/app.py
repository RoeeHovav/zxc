"""FastAPI application (local-only HTTP API + static UI)."""
from __future__ import annotations

import logging
import os
import shutil
import tempfile
import traceback
from typing import List, Optional

from fastapi import Body, FastAPI, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from . import config
from .service import ConsentRequired, NarratorService
from .tts.base import TTSError
from .llm.client import LLMError

log = logging.getLogger(__name__)
STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")


def create_app(service: Optional[NarratorService] = None) -> FastAPI:
    svc = service or NarratorService()
    app = FastAPI(title=config.APP_NAME, version=config.VERSION)
    app.state.svc = svc

    @app.middleware("http")
    async def local_only(request: Request, call_next):
        """Only serve this computer's own UI: reject foreign Host headers (DNS
        rebinding) and state-changing requests from other web origins (CSRF)."""
        host = request.headers.get("host", "")
        if host.rsplit(":", 1)[0].strip("[]") not in ("127.0.0.1", "localhost", "::1", "testserver"):
            return JSONResponse(status_code=403, content={"error": "forbidden_host"})
        origin = request.headers.get("origin")
        if origin and request.method not in ("GET", "HEAD", "OPTIONS") and origin != f"http://{host}":
            return JSONResponse(status_code=403, content={"error": "forbidden_origin"})
        return await call_next(request)

    @app.exception_handler(ConsentRequired)
    async def _consent(_req: Request, exc: ConsentRequired):
        i = exc.info
        return JSONResponse(status_code=409, content={"error": "consent_required", "provider": exc.provider,
                                                      "name": i.name, "privacy": i.privacy})

    @app.exception_handler(TTSError)
    async def _tts(_req: Request, exc: TTSError):
        return JSONResponse(status_code=502, content={"error": "tts_failed", "message": str(exc), "retryable": exc.retryable})

    @app.exception_handler(LLMError)
    async def _llm(_req: Request, exc: LLMError):
        return JSONResponse(status_code=502, content={"error": "llm_failed", "message": str(exc)})

    @app.exception_handler(Exception)
    async def _unexpected(req: Request, exc: Exception):
        """Never hide the cause: this server only talks to this computer, so show the
        error (and write it to narrator.log) instead of a bare "Internal Server Error"."""
        log.error("Unhandled error in %s %s", req.method, req.url.path, exc_info=exc)
        trace = "".join(traceback.format_exception(type(exc), exc, exc.__traceback__))[-2500:]
        return JSONResponse(status_code=500, content={
            "error": "internal", "message": f"{type(exc).__name__}: {exc}",
            "where": f"{req.method} {req.url.path}", "trace": trace, "log": os.path.join(config.data_dir(), "narrator.log")})

    @app.exception_handler(KeyError)
    async def _nf(_req: Request, exc: KeyError):
        return JSONResponse(status_code=404, content={"error": "not_found", "message": str(exc)})

    # ----------------------------------------------------------- general
    @app.get("/api/state")
    async def state():
        return {
            "version": config.VERSION,
            "settings": svc.settings(),
            "providers": svc.providers_info(),
            "secrets": svc.secret_status(),
            "ocr": svc.ocr.status(),
            "test_mode": svc.test_mode,
            "data_dir": svc.data_dir,
        }

    @app.put("/api/settings")
    async def put_settings(patch: dict = Body(...)):
        return svc.update_settings(patch)

    @app.post("/api/secrets")
    async def put_secret(body: dict = Body(...)):
        try:
            svc.set_secret(body.get("key", ""), body.get("value", ""))
        except ValueError as exc:
            raise HTTPException(400, str(exc))
        return {"secrets": svc.secret_status(), "providers": svc.providers_info()}

    @app.post("/api/consent")
    async def consent(body: dict = Body(...)):
        svc.give_consent(body["provider"])
        return {"ok": True, "settings": svc.settings()}

    @app.get("/api/voices")
    async def voices(provider: Optional[str] = None):
        return {"voices": await svc.voices(provider)}

    @app.post("/api/shutdown")
    async def shutdown(request: Request):
        # only reachable from this computer (server binds to 127.0.0.1)
        fn = getattr(app.state, "shutdown", None)
        if fn:
            fn()
            return {"ok": True}
        return {"ok": False}

    @app.post("/api/ocr/refresh")
    async def ocr_refresh():
        svc.ocr.refresh()
        return svc.ocr.status()

    # --------------------------------------------------------- documents
    @app.get("/api/documents")
    async def documents():
        return {"documents": svc.library()}

    @app.post("/api/documents")
    async def upload(files: List[UploadFile] = File(...), combine: bool = Form(False)):
        tmpdir = tempfile.mkdtemp(dir=svc.data_dir, prefix="upload-")
        saved = []
        try:
            for f in files:
                name = os.path.basename(f.filename or "document.pdf")
                path = os.path.join(tmpdir, f"{len(saved)}.pdf")
                with open(path, "wb") as out:
                    while True:
                        chunk = await f.read(1 << 20)
                        if not chunk:
                            break
                        out.write(chunk)
                saved.append((path, name))
            docs = []
            if combine and len(saved) > 1:
                merged = os.path.join(tmpdir, "combined.pdf")
                svc.combine_pdfs([p for p, _ in saved], merged)
                title = os.path.splitext(saved[0][1])[0]
                docs.append(svc.import_pdf(merged, saved[0][1], title=title))
            else:
                for p, name in saved:
                    docs.append(svc.import_pdf(p, name))
            return {"documents": docs}
        except ValueError as exc:
            raise HTTPException(400, str(exc))
        finally:
            shutil.rmtree(tmpdir, ignore_errors=True)

    @app.get("/api/documents/{doc_id}")
    async def document(doc_id: str):
        svc.open(doc_id)
        info = svc.document_info(doc_id)
        st = svc.open(doc_id)
        info["page_sizes"] = st.pdf.metadata()["page_sizes"]
        info["rtl"] = st.pdf.stats().rtl
        info["doc_settings"] = svc.db.doc_settings(doc_id)
        svc.db.log(doc_id, "open")
        return info

    @app.delete("/api/documents/{doc_id}")
    async def delete_document(doc_id: str):
        svc.delete_document(doc_id)
        return {"ok": True}

    @app.patch("/api/documents/{doc_id}")
    async def patch_document(doc_id: str, body: dict = Body(...)):
        if "title" in body and body["title"].strip():
            svc.db.x("UPDATE documents SET title=? WHERE id=?", (body["title"].strip(), doc_id))
        for k, v in (body.get("doc_settings") or {}).items():
            svc.db.set_doc_setting(doc_id, k, v)
        return svc.document_info(doc_id)

    @app.get("/api/documents/{doc_id}/file")
    async def document_file(doc_id: str):
        d = svc.db.document(doc_id)
        if not d:
            raise HTTPException(404)
        return FileResponse(d["path"], media_type="application/pdf", filename=d["filename"])

    @app.get("/api/documents/{doc_id}/progress")
    async def progress(doc_id: str):
        return svc.progress(doc_id)

    @app.get("/api/documents/{doc_id}/pages/{n}/layout")
    async def layout(doc_id: str, n: int):
        import asyncio
        return await asyncio.get_running_loop().run_in_executor(None, svc.page_layout, doc_id, n)

    @app.get("/api/documents/{doc_id}/pages/{n}/image")
    async def image(doc_id: str, n: int, scale: float = Query(1.5)):
        import asyncio
        data = await asyncio.get_running_loop().run_in_executor(None, svc.render, doc_id, n, scale)
        return Response(content=data, media_type="image/png", headers={"Cache-Control": "max-age=86400"})

    @app.get("/api/documents/{doc_id}/outline")
    async def outline(doc_id: str):
        return svc.outline(doc_id)

    @app.get("/api/documents/{doc_id}/search")
    async def search(doc_id: str, q: str):
        return svc.search(doc_id, q)

    # ------------------------------------------------------------- units
    @app.get("/api/documents/{doc_id}/units")
    async def units(doc_id: str, page: int = 0, count: int = 20):
        import asyncio
        return await asyncio.get_running_loop().run_in_executor(None, svc.units, doc_id, page, count)

    @app.get("/api/documents/{doc_id}/units/{unit_id}")
    async def unit(doc_id: str, unit_id: str):
        return svc.unit(doc_id, unit_id)

    @app.get("/api/documents/{doc_id}/units/{unit_id}/next")
    async def next_unit(doc_id: str, unit_id: str, direction: int = 1):
        import asyncio
        u = await asyncio.get_running_loop().run_in_executor(None, svc.neighbour, doc_id, unit_id, direction)
        return {"unit": u}

    @app.get("/api/documents/{doc_id}/unit_at")
    async def unit_at(doc_id: str, page: int, word: int):
        r = svc.unit_at(doc_id, page, word)
        if r is None:
            raise HTTPException(404, "no narration unit at this position")
        return r

    @app.post("/api/documents/{doc_id}/speech")
    async def speech(doc_id: str, body: dict = Body(...)):
        return await svc.speech(doc_id, body["unit_id"], int(body.get("chunk", 0)), prefetch=bool(body.get("prefetch", True)))

    @app.get("/api/audio/{name}")
    async def audio(name: str):
        key, _, ext = name.partition(".")
        if not key.isalnum() or ext not in ("mp3", "wav", "ogg"):
            raise HTTPException(400)
        path = svc.cache.path_for(key)
        if not path:
            raise HTTPException(404)
        mime = {"mp3": "audio/mpeg", "wav": "audio/wav", "ogg": "audio/ogg"}[ext]
        return FileResponse(path, media_type=mime, headers={"Cache-Control": "max-age=31536000, immutable"})

    @app.post("/api/documents/{doc_id}/explain")
    async def explain(doc_id: str, body: dict = Body(...)):
        return await svc.explain(doc_id, body["unit_id"], body.get("scope", "paragraph"))

    @app.get("/api/llm/status")
    async def llm_status():
        return await svc.llm_status()

    @app.post("/api/preview")
    async def preview(body: dict = Body(...)):
        return await svc.preview(body["text"], body["voice"], body.get("lang", "he"))

    # ------------------------------------------------- position / bookmarks
    @app.get("/api/documents/{doc_id}/position")
    async def get_position(doc_id: str):
        return {"position": svc.db.position(doc_id)}

    @app.put("/api/documents/{doc_id}/position")
    async def put_position(doc_id: str, body: dict = Body(...)):
        svc.db.save_position(doc_id, body)
        if body.get("event"):
            svc.db.log(doc_id, body["event"], body.get("page"), body.get("unit_id"))
        return {"ok": True}

    @app.get("/api/documents/{doc_id}/bookmarks")
    async def bookmarks(doc_id: str):
        return {"bookmarks": svc.db.bookmarks(doc_id)}

    @app.post("/api/documents/{doc_id}/bookmarks")
    async def add_bookmark(doc_id: str, body: dict = Body(...)):
        bid = svc.db.add_bookmark(doc_id, body)
        return {"id": bid, "bookmarks": svc.db.bookmarks(doc_id)}

    @app.put("/api/documents/{doc_id}/bookmarks/{bid}")
    async def update_bookmark(doc_id: str, bid: int, body: dict = Body(...)):
        svc.db.update_bookmark(doc_id, bid, body)
        return {"bookmarks": svc.db.bookmarks(doc_id)}

    @app.delete("/api/documents/{doc_id}/bookmarks/{bid}")
    async def delete_bookmark(doc_id: str, bid: int):
        svc.db.delete_bookmark(doc_id, bid)
        return {"bookmarks": svc.db.bookmarks(doc_id)}

    @app.get("/api/history")
    async def history():
        return {"history": svc.db.history()}

    # --------------------------------------------------------- lexicon
    @app.get("/api/lexicon")
    async def lexicon(doc_id: Optional[str] = None):
        return {"entries": svc.db.lexicon(doc_id), "builtin": [
            {"written": e.written, "spoken": e.spoken, "lang": e.lang, "context": e.context} for e in svc._builtin]}

    @app.post("/api/lexicon")
    async def add_lexicon(body: dict = Body(...)):
        if not body.get("written", "").strip() or not body.get("spoken", "").strip():
            raise HTTPException(400, "written and spoken forms are required")
        lid = svc.db.add_lexicon(body)
        svc.lexicon_changed()
        return {"id": lid}

    @app.put("/api/lexicon/{lid}")
    async def put_lexicon(lid: int, body: dict = Body(...)):
        svc.db.update_lexicon(lid, body)
        svc.lexicon_changed()
        return {"ok": True}

    @app.delete("/api/lexicon/{lid}")
    async def delete_lexicon(lid: int):
        svc.db.delete_lexicon(lid)
        svc.lexicon_changed()
        return {"ok": True}

    @app.post("/api/documents/{doc_id}/occurrence")
    async def occurrence(doc_id: str, body: dict = Body(...)):
        svc.set_occurrence(doc_id, int(body["page"]), int(body["word"]), (body.get("spoken") or "").strip() or None)
        return {"ok": True}

    # --------------------------------------------------------- voice lab
    @app.post("/api/ratings")
    async def add_rating(body: dict = Body(...)):
        return {"id": svc.db.add_rating(body)}

    @app.get("/api/ratings")
    async def ratings():
        return {"ratings": svc.db.ratings()}

    @app.get("/api/cache")
    async def cache_info():
        return {"bytes": svc.cache.size(), "limit": svc.cache.max_bytes}

    @app.delete("/api/cache")
    async def cache_clear():
        svc.cache.clear()
        return {"ok": True}

    # ---------------------------------------------------------- static UI
    if os.path.isdir(STATIC_DIR):
        app.mount("/assets", StaticFiles(directory=os.path.join(STATIC_DIR, "assets"), check_dir=False), name="assets")

        @app.get("/{path:path}")
        async def spa(path: str):
            if path.startswith("api/"):
                raise HTTPException(404)
            candidate = os.path.join(STATIC_DIR, path)
            if path and os.path.isfile(candidate) and os.path.realpath(candidate).startswith(os.path.realpath(STATIC_DIR)):
                return FileResponse(candidate)
            return FileResponse(os.path.join(STATIC_DIR, "index.html"), headers={"Cache-Control": "no-cache"})

    return app
