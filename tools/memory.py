#!/usr/bin/env python3
"""
FLEX Memory CLI — structured experience library for investment analysis.

Usage:
    python ~/tools/memory.py remember --subject NVDA --level pattern --content "..."
    echo 'content with $pecial chars' | python ~/tools/memory.py remember --subject NVDA --level pattern --stdin
    python ~/tools/memory.py recall "NVDA capex assumptions" --subject NVDA --top 5
    python ~/tools/memory.py predict --subject NVDA --metric "FY2027 growth" --value "32%" --confidence 0.7
    python ~/tools/memory.py calibrate --subject NVDA
    python ~/tools/memory.py reflect
"""

import argparse
import json
import math
import os
import sqlite3
import sys
import uuid
from datetime import datetime, timezone, timedelta
from pathlib import Path

# Fix Windows encoding
if sys.stdout.encoding != "utf-8":
    sys.stdout.reconfigure(encoding="utf-8")
if sys.stderr.encoding != "utf-8":
    sys.stderr.reconfigure(encoding="utf-8")

# ── Config ─────────────────────────────────────────────────

DB_PATH = Path.home() / ".iris-data" / "memory.db"
EMBEDDING_PROVIDER = os.getenv("EMBEDDING_PROVIDER", "ollama").lower()
EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "nomic-embed-text" if EMBEDDING_PROVIDER == "ollama" else "text-embedding-3-small")
OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
DUP_THRESHOLD = 0.90
MERGE_THRESHOLD = 0.70
CALIBRATION_ERROR_THRESHOLD = 0.25  # 25%
DEFAULT_REVIEW_DAYS = 90


# ── Database ───────────────────────────────────────────────

def get_conn() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("""
        CREATE TABLE IF NOT EXISTS memories (
            id TEXT PRIMARY KEY,
            subject TEXT,
            content TEXT NOT NULL,
            level TEXT DEFAULT 'factual',
            zone TEXT,
            confidence REAL,
            methodology TEXT DEFAULT '{}',
            tags TEXT DEFAULT '[]',
            embedding BLOB,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS predictions (
            id TEXT PRIMARY KEY,
            subject TEXT NOT NULL,
            metric TEXT NOT NULL,
            predicted_value TEXT NOT NULL,
            actual_value TEXT,
            error_pct REAL,
            confidence REAL,
            review_after TEXT NOT NULL,
            status TEXT DEFAULT 'open',
            created_at TEXT NOT NULL,
            resolved_at TEXT
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_mem_subject ON memories(subject)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_mem_level ON memories(level)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_mem_zone ON memories(zone)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_pred_subject ON predictions(subject)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_pred_status ON predictions(status)")
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
        truncated = text[:6000]
        try:
            resp = httpx.post(f"{OLLAMA_BASE_URL}/api/embeddings", json={"model": EMBEDDING_MODEL, "prompt": truncated}, timeout=60.0)
            resp.raise_for_status()
            vectors.append(resp.json()["embedding"])
        except Exception:
            vectors.append([0.0] * (len(vectors[0]) if vectors else 768))
    return vectors


def cosine_sim(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(x * x for x in b))
    if na == 0 or nb == 0:
        return 0.0
    return dot / (na * nb)


# ── Commands ───────────────────────────────────────────────

def cmd_remember(args):
    conn = get_conn()
    content = sys.stdin.read().strip() if args.stdin else args.content
    if not content:
        print(json.dumps({"error": "No content provided. Use --content or --stdin"}))
        sys.exit(1)
    subject = (args.subject or "").upper()

    if len(content.strip()) < 50:
        print(json.dumps({"error": "Content too short. Write at least 2-3 sentences with data, reasoning, and implications."}))
        sys.exit(1)

    # Embed new content
    search_text = f"{subject}: {content}" if subject else content
    new_emb = embed_texts([search_text])[0]

    # Three-way dedup
    rows = conn.execute(
        "SELECT id, content, embedding, level FROM memories WHERE embedding IS NOT NULL"
    ).fetchall()

    best_sim = 0.0
    best_match = None
    for row in rows:
        emb = json.loads(row["embedding"])
        sim = cosine_sim(new_emb, emb)
        if sim > best_sim:
            best_sim = sim
            best_match = row

    # Skip if duplicate
    if best_sim >= DUP_THRESHOLD and best_match:
        print(json.dumps({"action": "skipped", "reason": "duplicate", "similarity": round(best_sim, 3), "existing_id": best_match["id"]}))
        return

    now = datetime.now(timezone.utc).isoformat()
    emb_blob = json.dumps(new_emb)
    tags = json.dumps(args.tags.split(",") if args.tags else [])

    # Merge if similar
    if best_sim >= MERGE_THRESHOLD and best_match:
        if len(content) > len(best_match["content"]):
            conn.execute(
                "UPDATE memories SET content = ?, level = ?, confidence = ?, tags = ?, embedding = ?, updated_at = ? WHERE id = ?",
                (content, args.level, args.confidence, tags, emb_blob, now, best_match["id"]),
            )
            conn.commit()
            print(json.dumps({"action": "merged", "existing_id": best_match["id"], "similarity": round(best_sim, 3)}))
        else:
            print(json.dumps({"action": "skipped", "reason": "existing is richer", "similarity": round(best_sim, 3), "existing_id": best_match["id"]}))
        return

    # New memory
    mem_id = f"mem_{uuid.uuid4().hex[:8]}"
    conn.execute(
        "INSERT INTO memories (id, subject, content, level, confidence, tags, embedding, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (mem_id, subject or None, content, args.level, args.confidence, tags, emb_blob, now, now),
    )
    conn.commit()
    print(json.dumps({"action": "saved", "id": mem_id, "subject": subject, "level": args.level}))


def cmd_recall(args):
    conn = get_conn()
    query = args.query
    subject = (args.subject or "").upper() if args.subject else None

    results = []
    seen = set()

    # 1. Subject exact match
    if subject:
        rows = conn.execute(
            "SELECT id, subject, content, level, zone, confidence, methodology, tags, created_at FROM memories WHERE subject = ? ORDER BY created_at DESC",
            (subject,),
        ).fetchall()
        for row in rows:
            results.append(dict(row))
            seen.add(row["id"])

    # 2. Semantic search
    search_text = f"{subject}: {query}" if subject else query
    query_emb = embed_texts([search_text])[0]

    rows = conn.execute("SELECT id, subject, content, level, zone, confidence, methodology, tags, embedding, created_at FROM memories WHERE embedding IS NOT NULL").fetchall()

    scored = []
    for row in rows:
        if row["id"] in seen:
            continue
        emb = json.loads(row["embedding"])
        score = cosine_sim(query_emb, emb)
        scored.append((score, row))

    scored.sort(key=lambda x: x[0], reverse=True)

    for score, row in scored[: args.top]:
        if row["id"] not in seen:
            entry = dict(row)
            entry.pop("embedding", None)
            entry["relevance_score"] = round(score, 4)
            results.append(entry)
            seen.add(row["id"])

    # Also surface due predictions
    if subject:
        preds = conn.execute(
            "SELECT id, subject, metric, predicted_value, confidence, review_after, status FROM predictions WHERE subject = ? AND status = 'open'",
            (subject,),
        ).fetchall()
        due_preds = []
        for p in preds:
            due_preds.append(dict(p))
        if due_preds:
            for entry in results:
                pass  # predictions appended below

    print(json.dumps({
        "query": query,
        "subject": subject,
        "memories": results[: args.top],
        "total_found": len(results),
    }, ensure_ascii=False, indent=2, default=str))


def cmd_predict(args):
    conn = get_conn()
    now = datetime.now(timezone.utc)
    review_date = (now + timedelta(days=args.review_days)).isoformat()

    pred_id = f"pred_{uuid.uuid4().hex[:8]}"
    conn.execute(
        "INSERT INTO predictions (id, subject, metric, predicted_value, confidence, review_after, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'open', ?)",
        (pred_id, (args.subject or "").upper(), args.metric, args.value, args.confidence, review_date, now.isoformat()),
    )
    conn.commit()
    print(json.dumps({"action": "predicted", "id": pred_id, "subject": (args.subject or "").upper(), "metric": args.metric, "value": args.value, "review_after": review_date}))


def cmd_calibrate(args):
    conn = get_conn()
    subject = (args.subject or "").upper() if args.subject else None
    now = datetime.now(timezone.utc).isoformat()

    query = "SELECT * FROM predictions WHERE status = 'open'"
    params = []
    if subject:
        query += " AND subject = ?"
        params.append(subject)

    preds = conn.execute(query, params).fetchall()

    due = []
    upcoming = []
    for p in preds:
        p_dict = dict(p)
        if p["review_after"] <= now:
            due.append(p_dict)
        else:
            upcoming.append(p_dict)

    # If actual value provided, resolve the prediction
    if args.actual and args.pred_id:
        pred = conn.execute("SELECT * FROM predictions WHERE id = ?", (args.pred_id,)).fetchone()
        if pred:
            try:
                predicted_num = float(pred["predicted_value"].replace("%", "").replace("$", ""))
                actual_num = float(args.actual.replace("%", "").replace("$", ""))
                error_pct = (predicted_num - actual_num) / actual_num if actual_num != 0 else 0
            except ValueError:
                error_pct = None

            conn.execute(
                "UPDATE predictions SET actual_value = ?, error_pct = ?, status = 'resolved', resolved_at = ? WHERE id = ?",
                (args.actual, error_pct, now, args.pred_id),
            )
            conn.commit()

            result = {"action": "calibrated", "pred_id": args.pred_id, "predicted": pred["predicted_value"], "actual": args.actual, "error_pct": round(error_pct, 4) if error_pct is not None else None}

            # Auto-create warning if error > threshold
            if error_pct is not None and abs(error_pct) > CALIBRATION_ERROR_THRESHOLD:
                direction = "overestimated" if error_pct > 0 else "underestimated"
                warning_content = (
                    f"CALIBRATION WARNING: {direction} {pred['metric']} for {pred['subject']}. "
                    f"Predicted {pred['predicted_value']}, actual {args.actual} (error {error_pct:+.1%}). "
                    f"Review assumptions and apply conservative adjustment in future analyses."
                )
                warn_id = f"mem_{uuid.uuid4().hex[:8]}"
                warn_emb = json.dumps(embed_texts([warning_content])[0])
                conn.execute(
                    "INSERT INTO memories (id, subject, content, level, confidence, tags, embedding, created_at, updated_at) VALUES (?, ?, ?, 'pattern', 0.9, '[]', ?, ?, ?)",
                    (warn_id, pred["subject"], warning_content, warn_emb, now, now),
                )
                conn.commit()
                result["auto_warning"] = warn_id

            print(json.dumps(result))
            return

    print(json.dumps({
        "due_for_review": due,
        "upcoming": upcoming[:5],
        "total_open": len(preds),
    }, ensure_ascii=False, indent=2, default=str))


def cmd_reflect(args):
    conn = get_conn()

    # Memory stats
    total = conn.execute("SELECT COUNT(*) FROM memories").fetchone()[0]
    by_level = {}
    for row in conn.execute("SELECT level, COUNT(*) as cnt FROM memories GROUP BY level"):
        by_level[row["level"]] = row["cnt"]
    by_zone = {}
    for row in conn.execute("SELECT zone, COUNT(*) as cnt FROM memories WHERE zone IS NOT NULL GROUP BY zone"):
        by_zone[row["zone"]] = row["cnt"]
    by_subject = {}
    for row in conn.execute("SELECT subject, COUNT(*) as cnt FROM memories WHERE subject IS NOT NULL GROUP BY subject ORDER BY cnt DESC LIMIT 10"):
        by_subject[row["subject"]] = row["cnt"]

    # Prediction calibration stats
    resolved = conn.execute("SELECT * FROM predictions WHERE status = 'resolved' AND error_pct IS NOT NULL").fetchall()
    overestimates = sum(1 for r in resolved if r["error_pct"] > 0)
    underestimates = sum(1 for r in resolved if r["error_pct"] < 0)
    avg_error = sum(abs(r["error_pct"]) for r in resolved) / len(resolved) if resolved else 0
    large_errors = sum(1 for r in resolved if abs(r["error_pct"]) > CALIBRATION_ERROR_THRESHOLD)

    # Open predictions due
    now = datetime.now(timezone.utc).isoformat()
    due = conn.execute("SELECT COUNT(*) FROM predictions WHERE status = 'open' AND review_after <= ?", (now,)).fetchone()[0]

    print(json.dumps({
        "memory_stats": {
            "total": total,
            "by_level": by_level,
            "by_zone": by_zone,
            "top_subjects": by_subject,
        },
        "calibration_stats": {
            "total_resolved": len(resolved),
            "overestimates": overestimates,
            "underestimates": underestimates,
            "avg_absolute_error": round(avg_error, 4),
            "large_errors_over_25pct": large_errors,
            "systematic_bias": "overestimate" if overestimates > underestimates * 2 else ("underestimate" if underestimates > overestimates * 2 else "none_detected"),
        },
        "predictions_due_for_review": due,
    }, indent=2))


# ── CLI ────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="FLEX Memory CLI")
    sub = parser.add_subparsers(dest="command", required=True)

    p_rem = sub.add_parser("remember", help="Save an insight")
    p_rem.add_argument("--subject", help="Company ticker or topic")
    p_rem.add_argument("--content", required=False, default="", help="Memory content (2-3 sentences minimum)")
    p_rem.add_argument("--level", choices=["factual", "pattern", "strategic"], default="factual")
    p_rem.add_argument("--confidence", type=float, default=None)
    p_rem.add_argument("--tags", help="Comma-separated tags")
    p_rem.add_argument("--stdin", action="store_true", help="Read content from stdin (avoids bash escaping issues)")

    p_rec = sub.add_parser("recall", help="Retrieve memories")
    p_rec.add_argument("query", help="What to search for")
    p_rec.add_argument("--subject", help="Filter by subject")
    p_rec.add_argument("--top", type=int, default=5, help="Max results")

    p_pred = sub.add_parser("predict", help="Record a prediction")
    p_pred.add_argument("--subject", required=True, help="Company ticker")
    p_pred.add_argument("--metric", required=True, help="What you're predicting")
    p_pred.add_argument("--value", required=True, help="Predicted value")
    p_pred.add_argument("--confidence", type=float, default=0.5)
    p_pred.add_argument("--review-days", type=int, default=DEFAULT_REVIEW_DAYS, help="Days until review")

    p_cal = sub.add_parser("calibrate", help="Check predictions due for review")
    p_cal.add_argument("--subject", help="Filter by subject")
    p_cal.add_argument("--pred-id", help="Prediction ID to resolve")
    p_cal.add_argument("--actual", help="Actual value observed")

    sub.add_parser("reflect", help="Weekly reflection — stats and bias detection")

    args = parser.parse_args()
    {"remember": cmd_remember, "recall": cmd_recall, "predict": cmd_predict, "calibrate": cmd_calibrate, "reflect": cmd_reflect}[args.command](args)


if __name__ == "__main__":
    main()
