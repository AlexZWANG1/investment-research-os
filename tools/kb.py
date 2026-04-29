#!/usr/bin/env python3
"""
Knowledge Base CLI — semantic search over 200+ investment documents.

Usage:
    python ~/tools/kb.py ingest <file> --company NVDA --type filing
    python ~/tools/kb.py search "AI capex sustainability" --top 5
    python ~/tools/kb.py list [--company NVDA] [--type report]
    python ~/tools/kb.py delete <doc_id>
"""

import argparse
import hashlib
import json
import math
import os
import sqlite3
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

# Fix Windows encoding
if sys.stdout.encoding != "utf-8":
    sys.stdout.reconfigure(encoding="utf-8")
if sys.stderr.encoding != "utf-8":
    sys.stderr.reconfigure(encoding="utf-8")

# ── Config ─────────────────────────────────────────────────

DB_PATH = Path.home() / ".iris-data" / "knowledge.db"
CHUNK_SIZE = 1500
CHUNK_OVERLAP = 200
EMBEDDING_PROVIDER = os.getenv("EMBEDDING_PROVIDER", "ollama").lower()
EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "nomic-embed-text" if EMBEDDING_PROVIDER == "ollama" else "text-embedding-3-small")
OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")


# ── Database ───────────────────────────────────────────────

def get_conn() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("""
        CREATE TABLE IF NOT EXISTS documents (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            company TEXT,
            doc_type TEXT,
            tags TEXT DEFAULT '[]',
            content_hash TEXT UNIQUE,
            file_path TEXT,
            created_at TEXT NOT NULL
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS chunks (
            id TEXT PRIMARY KEY,
            doc_id TEXT NOT NULL,
            chunk_index INTEGER NOT NULL,
            text TEXT NOT NULL,
            embedding BLOB,
            created_at TEXT NOT NULL,
            FOREIGN KEY (doc_id) REFERENCES documents(id) ON DELETE CASCADE
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_docs_company ON documents(company)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_docs_type ON documents(doc_type)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_chunks_doc ON chunks(doc_id)")
    conn.commit()
    return conn


# ── Embedding ──────────────────────────────────────────────

def embed_texts(texts: list[str]) -> list[list[float]]:
    if EMBEDDING_PROVIDER == "ollama":
        return _embed_ollama(texts)
    return _embed_openai(texts)


def _embed_openai(texts: list[str]) -> list[list[float]]:
    from openai import OpenAI
    client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"), base_url=os.getenv("OPENAI_BASE_URL"))
    resp = client.embeddings.create(model=EMBEDDING_MODEL, input=texts)
    return [item.embedding for item in resp.data]


def _embed_ollama(texts: list[str]) -> list[list[float]]:
    import httpx
    vectors = []
    for text in texts:
        truncated = text[:6000]  # nomic-embed-text context limit
        try:
            resp = httpx.post(f"{OLLAMA_BASE_URL}/api/embeddings", json={"model": EMBEDDING_MODEL, "prompt": truncated}, timeout=60.0)
            resp.raise_for_status()
            vectors.append(resp.json()["embedding"])
        except Exception as e:
            print(f"  [warn] embedding failed for chunk ({len(text)} chars), using zero vector: {e}", file=sys.stderr)
            if vectors:
                vectors.append([0.0] * len(vectors[0]))
            else:
                vectors.append([0.0] * 768)  # nomic-embed-text default dim
    return vectors


def cosine_sim(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(x * x for x in b))
    if na == 0 or nb == 0:
        return 0.0
    return dot / (na * nb)


# ── Chunking ───────────────────────────────────────────────

def chunk_text(text: str) -> list[str]:
    if not text or not text.strip():
        return []
    paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]
    if not paragraphs:
        return [text.strip()] if text.strip() else []

    chunks = []
    current_parts = []
    current_len = 0

    for para in paragraphs:
        if current_len + len(para) > CHUNK_SIZE and current_parts:
            chunks.append("\n\n".join(current_parts))
            # Overlap: keep trailing parts within budget
            overlap_parts = []
            overlap_len = 0
            for p in reversed(current_parts):
                if overlap_len + len(p) > CHUNK_OVERLAP:
                    break
                overlap_parts.insert(0, p)
                overlap_len += len(p)
            current_parts = overlap_parts
            current_len = sum(len(p) for p in current_parts)

        current_parts.append(para)
        current_len += len(para)

    if current_parts:
        chunks.append("\n\n".join(current_parts))
    return chunks


# ── PDF Parsing ────────────────────────────────────────────

def parse_file(file_path: str) -> str:
    path = Path(file_path)
    suffix = path.suffix.lower()
    if suffix == ".pdf":
        import pymupdf4llm
        return pymupdf4llm.to_markdown(str(path))
    elif suffix in (".md", ".txt", ".csv"):
        return path.read_text(encoding="utf-8")
    else:
        raise ValueError(f"Unsupported file type: {suffix}")


# ── Commands ───────────────────────────────────────────────

def cmd_ingest(args):
    file_path = Path(args.file).resolve()
    if not file_path.exists():
        print(json.dumps({"error": f"File not found: {file_path}"}))
        sys.exit(1)

    # Parse document
    print(f"Parsing {file_path.name}...", file=sys.stderr)
    text = parse_file(str(file_path))

    # Dedup by content hash
    content_hash = hashlib.sha256(text.encode()).hexdigest()[:16]
    conn = get_conn()
    existing = conn.execute("SELECT id, title FROM documents WHERE content_hash = ?", (content_hash,)).fetchone()
    if existing:
        print(json.dumps({"action": "skipped", "reason": "duplicate", "existing_id": existing["id"], "title": existing["title"]}))
        return

    # Chunk
    chunks = chunk_text(text)
    if not chunks:
        print(json.dumps({"error": "No content extracted from file"}))
        sys.exit(1)
    print(f"  {len(chunks)} chunks extracted", file=sys.stderr)

    # Embed
    print(f"  Embedding {len(chunks)} chunks...", file=sys.stderr)
    embeddings = embed_texts(chunks)

    # Store
    doc_id = f"kdoc_{uuid.uuid4().hex[:8]}"
    now = datetime.now(timezone.utc).isoformat()
    tags = json.dumps(args.tags.split(",") if args.tags else [])

    conn.execute(
        "INSERT INTO documents (id, title, company, doc_type, tags, content_hash, file_path, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (doc_id, file_path.stem, (args.company or "").upper() or None, args.type, tags, content_hash, str(file_path), now),
    )

    for i, (chunk, emb) in enumerate(zip(chunks, embeddings)):
        chunk_id = f"kc_{uuid.uuid4().hex[:8]}"
        emb_blob = json.dumps(emb).encode()
        conn.execute(
            "INSERT INTO chunks (id, doc_id, chunk_index, text, embedding, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (chunk_id, doc_id, i, chunk, emb_blob, now),
        )

    conn.commit()
    print(json.dumps({"action": "ingested", "doc_id": doc_id, "title": file_path.stem, "chunks": len(chunks), "company": (args.company or "").upper() or None}))


def cmd_search(args):
    conn = get_conn()
    query_emb = embed_texts([args.query])[0]

    rows = conn.execute(
        "SELECT c.id, c.text, c.embedding, c.doc_id, d.title, d.company, d.doc_type "
        "FROM chunks c JOIN documents d ON c.doc_id = d.id "
        "WHERE c.embedding IS NOT NULL"
    ).fetchall()

    scored = []
    for row in rows:
        emb = json.loads(row["embedding"])
        score = cosine_sim(query_emb, emb)
        scored.append({
            "chunk_id": row["id"],
            "doc_id": row["doc_id"],
            "title": row["title"],
            "company": row["company"],
            "doc_type": row["doc_type"],
            "score": round(score, 4),
            "text": row["text"][:500],
        })

    scored.sort(key=lambda x: x["score"], reverse=True)
    top = scored[: args.top]
    print(json.dumps({"query": args.query, "results": top, "total_chunks_searched": len(rows)}, ensure_ascii=False, indent=2))


def cmd_list(args):
    conn = get_conn()
    query = "SELECT id, title, company, doc_type, tags, created_at FROM documents WHERE 1=1"
    params = []
    if args.company:
        query += " AND company = ?"
        params.append(args.company.upper())
    if args.type:
        query += " AND doc_type = ?"
        params.append(args.type)
    query += " ORDER BY created_at DESC"

    rows = conn.execute(query, params).fetchall()
    docs = []
    for row in rows:
        chunk_count = conn.execute("SELECT COUNT(*) FROM chunks WHERE doc_id = ?", (row["id"],)).fetchone()[0]
        docs.append({
            "id": row["id"],
            "title": row["title"],
            "company": row["company"],
            "doc_type": row["doc_type"],
            "tags": json.loads(row["tags"]),
            "chunks": chunk_count,
            "created_at": row["created_at"],
        })
    print(json.dumps({"documents": docs, "total": len(docs)}, ensure_ascii=False, indent=2))


def cmd_delete(args):
    conn = get_conn()
    doc = conn.execute("SELECT id, title FROM documents WHERE id = ?", (args.doc_id,)).fetchone()
    if not doc:
        print(json.dumps({"error": f"Document not found: {args.doc_id}"}))
        sys.exit(1)
    conn.execute("DELETE FROM chunks WHERE doc_id = ?", (args.doc_id,))
    conn.execute("DELETE FROM documents WHERE id = ?", (args.doc_id,))
    conn.commit()
    print(json.dumps({"action": "deleted", "doc_id": args.doc_id, "title": doc["title"]}))


# ── CLI ────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Knowledge Base CLI")
    sub = parser.add_subparsers(dest="command", required=True)

    p_ingest = sub.add_parser("ingest", help="Ingest a document")
    p_ingest.add_argument("file", help="Path to PDF/MD/TXT file")
    p_ingest.add_argument("--company", help="Company ticker (e.g. NVDA)")
    p_ingest.add_argument("--type", default="report", help="Document type: filing|report|transcript|note")
    p_ingest.add_argument("--tags", help="Comma-separated tags")

    p_search = sub.add_parser("search", help="Semantic search")
    p_search.add_argument("query", help="Search query")
    p_search.add_argument("--top", type=int, default=5, help="Number of results")

    p_list = sub.add_parser("list", help="List documents")
    p_list.add_argument("--company", help="Filter by company")
    p_list.add_argument("--type", help="Filter by type")

    p_delete = sub.add_parser("delete", help="Delete a document")
    p_delete.add_argument("doc_id", help="Document ID")

    args = parser.parse_args()
    {"ingest": cmd_ingest, "search": cmd_search, "list": cmd_list, "delete": cmd_delete}[args.command](args)


if __name__ == "__main__":
    main()
