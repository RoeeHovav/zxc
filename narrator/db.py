"""SQLite persistence: library, reading positions, bookmarks, history,
pronunciation dictionary, settings, voice-lab ratings."""
from __future__ import annotations

import json
import sqlite3
import threading
import time
from typing import Any, Dict, List, Optional

SCHEMA = """
CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    filename TEXT NOT NULL,
    path TEXT NOT NULL,
    pages INTEGER NOT NULL,
    size INTEGER NOT NULL,
    added_at REAL NOT NULL,
    opened_at REAL,
    lang TEXT,
    rtl INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS positions (
    doc_id TEXT PRIMARY KEY,
    unit_id TEXT,
    word INTEGER DEFAULT 0,
    page INTEGER DEFAULT 0,
    chunk INTEGER DEFAULT 0,
    offset REAL DEFAULT 0,
    progress REAL DEFAULT 0,
    updated_at REAL
);
CREATE TABLE IF NOT EXISTS bookmarks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    doc_id TEXT NOT NULL,
    page INTEGER NOT NULL,
    unit_id TEXT,
    word INTEGER DEFAULT 0,
    label TEXT,
    note TEXT,
    created_at REAL
);
CREATE TABLE IF NOT EXISTS history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    doc_id TEXT NOT NULL,
    event TEXT NOT NULL,
    page INTEGER,
    unit_id TEXT,
    at REAL
);
CREATE TABLE IF NOT EXISTS lexicon (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scope TEXT NOT NULL,
    doc_id TEXT,
    lang TEXT NOT NULL,
    written TEXT NOT NULL,
    spoken TEXT NOT NULL,
    context TEXT DEFAULT 'any',
    note TEXT,
    enabled INTEGER DEFAULT 1,
    created_at REAL
);
CREATE TABLE IF NOT EXISTS occurrences (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    doc_id TEXT NOT NULL,
    page INTEGER NOT NULL,
    word INTEGER NOT NULL,
    spoken TEXT NOT NULL,
    created_at REAL,
    UNIQUE(doc_id, page, word)
);
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS doc_settings (
    doc_id TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    PRIMARY KEY (doc_id, key)
);
CREATE TABLE IF NOT EXISTS quiz_answers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    doc_id TEXT NOT NULL,
    qid TEXT NOT NULL,
    question TEXT NOT NULL,
    score REAL NOT NULL,
    picked INTEGER,
    revisit INTEGER DEFAULT 0,
    at REAL
);
CREATE INDEX IF NOT EXISTS quiz_answers_doc ON quiz_answers (doc_id, id);
CREATE TABLE IF NOT EXISTS ratings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sample TEXT NOT NULL,
    voice TEXT NOT NULL,
    variant TEXT,
    rating INTEGER NOT NULL,
    notes TEXT,
    at REAL
);
"""


class Database:
    def __init__(self, path: str):
        self.path = path
        self._local = threading.local()
        self._lock = threading.RLock()
        with self.conn() as c:
            c.executescript(SCHEMA)

    def conn(self) -> sqlite3.Connection:
        c = getattr(self._local, "conn", None)
        if c is None:
            c = sqlite3.connect(self.path, timeout=30, check_same_thread=False)
            c.row_factory = sqlite3.Row
            c.execute("PRAGMA journal_mode=WAL")
            c.execute("PRAGMA foreign_keys=ON")
            self._local.conn = c
        return c

    def q(self, sql: str, args: tuple = ()) -> List[Dict[str, Any]]:
        with self._lock:
            cur = self.conn().execute(sql, args)
            return [dict(r) for r in cur.fetchall()]

    def x(self, sql: str, args: tuple = ()) -> int:
        with self._lock:
            c = self.conn()
            cur = c.execute(sql, args)
            c.commit()
            return cur.lastrowid

    # ----------------------------------------------------------- documents
    def add_document(self, d: dict) -> None:
        self.x(
            "INSERT OR REPLACE INTO documents (id,title,filename,path,pages,size,added_at,opened_at,lang,rtl) VALUES (?,?,?,?,?,?,?,?,?,?)",
            (d["id"], d["title"], d["filename"], d["path"], d["pages"], d["size"], d.get("added_at", time.time()),
             d.get("opened_at"), d.get("lang"), 1 if d.get("rtl") else 0),
        )

    def document(self, doc_id: str) -> Optional[dict]:
        r = self.q("SELECT * FROM documents WHERE id=?", (doc_id,))
        return r[0] if r else None

    def documents(self) -> List[dict]:
        return self.q(
            "SELECT d.*, p.progress, p.page AS last_page, p.updated_at AS position_at FROM documents d "
            "LEFT JOIN positions p ON p.doc_id=d.id ORDER BY COALESCE(d.opened_at, d.added_at) DESC"
        )

    def touch_document(self, doc_id: str) -> None:
        self.x("UPDATE documents SET opened_at=? WHERE id=?", (time.time(), doc_id))

    def delete_document(self, doc_id: str) -> None:
        for t in ("positions", "bookmarks", "history", "occurrences", "doc_settings", "quiz_answers"):
            self.x(f"DELETE FROM {t} WHERE doc_id=?", (doc_id,))
        self.x("DELETE FROM lexicon WHERE doc_id=?", (doc_id,))
        self.x("DELETE FROM documents WHERE id=?", (doc_id,))

    # ----------------------------------------------------------- positions
    def position(self, doc_id: str) -> Optional[dict]:
        r = self.q("SELECT * FROM positions WHERE doc_id=?", (doc_id,))
        return r[0] if r else None

    def save_position(self, doc_id: str, p: dict) -> None:
        self.x(
            "INSERT OR REPLACE INTO positions (doc_id,unit_id,word,page,chunk,offset,progress,updated_at) VALUES (?,?,?,?,?,?,?,?)",
            (doc_id, p.get("unit_id"), int(p.get("word", 0)), int(p.get("page", 0)), int(p.get("chunk", 0)),
             float(p.get("offset", 0)), float(p.get("progress", 0)), time.time()),
        )

    # ----------------------------------------------------------- bookmarks
    def bookmarks(self, doc_id: str) -> List[dict]:
        return self.q("SELECT * FROM bookmarks WHERE doc_id=? ORDER BY page, word", (doc_id,))

    def add_bookmark(self, doc_id: str, b: dict) -> int:
        return self.x(
            "INSERT INTO bookmarks (doc_id,page,unit_id,word,label,note,created_at) VALUES (?,?,?,?,?,?,?)",
            (doc_id, int(b["page"]), b.get("unit_id"), int(b.get("word", 0)), b.get("label") or "", b.get("note") or "", time.time()),
        )

    def update_bookmark(self, doc_id: str, bid: int, b: dict) -> None:
        self.x("UPDATE bookmarks SET label=?, note=? WHERE id=? AND doc_id=?", (b.get("label") or "", b.get("note") or "", bid, doc_id))

    def delete_bookmark(self, doc_id: str, bid: int) -> None:
        self.x("DELETE FROM bookmarks WHERE id=? AND doc_id=?", (bid, doc_id))

    # ------------------------------------------------------------- history
    def log(self, doc_id: str, event: str, page: Optional[int] = None, unit_id: Optional[str] = None) -> None:
        self.x("INSERT INTO history (doc_id,event,page,unit_id,at) VALUES (?,?,?,?,?)", (doc_id, event, page, unit_id, time.time()))

    def history(self, limit: int = 100) -> List[dict]:
        return self.q(
            "SELECT h.*, d.title FROM history h JOIN documents d ON d.id=h.doc_id ORDER BY h.at DESC LIMIT ?", (limit,)
        )

    # -------------------------------------------------------------- lexicon
    def lexicon(self, doc_id: Optional[str] = None) -> List[dict]:
        if doc_id:
            return self.q("SELECT * FROM lexicon WHERE scope='global' OR doc_id=? ORDER BY id DESC", (doc_id,))
        return self.q("SELECT * FROM lexicon ORDER BY id DESC")

    def add_lexicon(self, e: dict) -> int:
        return self.x(
            "INSERT INTO lexicon (scope,doc_id,lang,written,spoken,context,note,enabled,created_at) VALUES (?,?,?,?,?,?,?,?,?)",
            (e.get("scope", "global"), e.get("doc_id"), e.get("lang", "he"), e["written"].strip(), e["spoken"].strip(),
             e.get("context", "any"), e.get("note", ""), 1 if e.get("enabled", True) else 0, time.time()),
        )

    def update_lexicon(self, lid: int, e: dict) -> None:
        cur = self.q("SELECT * FROM lexicon WHERE id=?", (lid,))
        if not cur:
            return
        c = cur[0]
        self.x(
            "UPDATE lexicon SET scope=?, doc_id=?, lang=?, written=?, spoken=?, context=?, note=?, enabled=? WHERE id=?",
            (e.get("scope", c["scope"]), e.get("doc_id", c["doc_id"]), e.get("lang", c["lang"]), e.get("written", c["written"]).strip(),
             e.get("spoken", c["spoken"]).strip(), e.get("context", c["context"]), e.get("note", c["note"]),
             1 if e.get("enabled", bool(c["enabled"])) else 0, lid),
        )

    def delete_lexicon(self, lid: int) -> None:
        self.x("DELETE FROM lexicon WHERE id=?", (lid,))

    def occurrences(self, doc_id: str) -> List[dict]:
        return self.q("SELECT * FROM occurrences WHERE doc_id=?", (doc_id,))

    def set_occurrence(self, doc_id: str, page: int, word: int, spoken: Optional[str]) -> None:
        if spoken:
            self.x("INSERT OR REPLACE INTO occurrences (doc_id,page,word,spoken,created_at) VALUES (?,?,?,?,?)",
                   (doc_id, page, word, spoken, time.time()))
        else:
            self.x("DELETE FROM occurrences WHERE doc_id=? AND page=? AND word=?", (doc_id, page, word))

    # ------------------------------------------------------------- settings
    def get_settings(self) -> Dict[str, Any]:
        return {r["key"]: json.loads(r["value"]) for r in self.q("SELECT * FROM settings")}

    def set_setting(self, key: str, value: Any) -> None:
        self.x("INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)", (key, json.dumps(value)))

    def doc_settings(self, doc_id: str) -> Dict[str, Any]:
        return {r["key"]: json.loads(r["value"]) for r in self.q("SELECT * FROM doc_settings WHERE doc_id=?", (doc_id,))}

    def set_doc_setting(self, doc_id: str, key: str, value: Any) -> None:
        if value is None:
            self.x("DELETE FROM doc_settings WHERE doc_id=? AND key=?", (doc_id, key))
        else:
            self.x("INSERT OR REPLACE INTO doc_settings (doc_id,key,value) VALUES (?,?,?)", (doc_id, key, json.dumps(value)))

    # -------------------------------------------------------------- ratings
    def add_rating(self, r: dict) -> int:
        return self.x("INSERT INTO ratings (sample,voice,variant,rating,notes,at) VALUES (?,?,?,?,?,?)",
                      (r["sample"], r["voice"], r.get("variant", ""), int(r["rating"]), r.get("notes", ""), time.time()))

    def ratings(self) -> List[dict]:
        return self.q("SELECT * FROM ratings ORDER BY at DESC")

    # ----------------------------------------------------------------- quiz
    def add_quiz_answer(self, doc_id: str, question: dict, score: float, picked: Optional[int], revisit: bool) -> int:
        return self.x("INSERT INTO quiz_answers (doc_id,qid,question,score,picked,revisit,at) VALUES (?,?,?,?,?,?,?)",
                      (doc_id, str(question.get("qid", "")), json.dumps(question, ensure_ascii=False), float(score),
                       picked, 1 if revisit else 0, time.time()))

    def quiz_rows(self, doc_id: str) -> List[Dict[str, Any]]:
        rows = self.q("SELECT * FROM quiz_answers WHERE doc_id=? ORDER BY id", (doc_id,))
        for r in rows:
            try:
                r["question"] = json.loads(r["question"])
            except ValueError:
                r["question"] = {}
        return rows

    def quiz_pending(self, doc_id: str) -> List[Dict[str, Any]]:
        """Questions whose most recent answer was not fully right, oldest first (these come back at a later checkpoint)."""
        latest: Dict[str, Dict[str, Any]] = {}
        for r in self.quiz_rows(doc_id):
            latest[r["qid"]] = r
        return [r for r in latest.values() if r["score"] < 1.0 and r["question"]]

    def clear_quiz(self, doc_id: str) -> None:
        self.x("DELETE FROM quiz_answers WHERE doc_id=?", (doc_id,))
