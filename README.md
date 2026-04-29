# Investment Research OS

A personal AI research workspace for deep US technology stock analysis.

This project turns an investor's research process into a repeatable agent system: custom Claude Code skills, local research tools, a structured Markdown knowledge base, and an interactive signal graph for reviewing investment judgments.

It is built for one specific workflow: **turn noisy source material into auditable investment signals**.

> Alpha = my judgment - market consensus.

## Why This Exists

Most AI research workflows fail because the model is asked to reason from weak context. A generic prompt produces a generic answer. For investing, that usually means a summary of consensus.

This project takes the opposite route:

- encode the investment process as reusable skills
- ingest high-value source material into a local knowledge base
- separate facts, views, gaps, and investment impact
- compile source notes into a small number of active signals
- track what would falsify each signal before it becomes a position

The result is not a chatbot. It is a research operating system that makes the reasoning trail inspectable.

## What It Demonstrates

This repo is intended as a portfolio/interview project. The interesting engineering work is in the system design:

- **Agent workflow design**: Claude Code skills route tasks into specialized research modes.
- **Knowledge schema design**: raw material is compiled into source pages and signal pages with explicit evidence links.
- **Local-first tooling**: Python CLIs handle source search, document ingestion, semantic search, and prediction memory.
- **Research discipline**: every investment view must distinguish facts, views, uncertainty, and kill criteria.
- **Visualization layer**: Augur renders the research graph so signals, sources, and contradictions can be reviewed spatially.

## Architecture

```text
.
├── CLAUDE.md                    # project-level assistant identity and rules
├── .claude/skills/              # reusable agent workflows
│   ├── research/
│   ├── report-digest/
│   ├── wiki-think/
│   ├── portfolio-allocation/
│   ├── hypothesis-thinking/
│   └── ...
├── tools/                       # local CLI tools
│   ├── sources.py               # RSS / HN / arXiv / Folo / XHS source search
│   ├── kb.py                    # local document ingestion and semantic search
│   └── memory.py                # prediction and reflection memory
└── investor-wiki/
    ├── SCHEMA.md                # source -> signal knowledge model
    ├── raw/                     # private source material, ignored by git
    ├── workspace/               # temporary research drafts, ignored by git
    └── wiki/
        ├── dashboard.html       # private local dashboard, ignored by git
        ├── augur/               # interactive signal graph UI source
        ├── sources/             # private compiled source pages, ignored by git
        └── signal/              # private investment signals, ignored by git
```

## Core Concepts

### Skills

Skills are executable research playbooks. They are not prompt snippets; each one defines when it should trigger, what evidence it needs, how it should reason, and where its output should land.

Key skills:

| Skill | Purpose |
|---|---|
| `research` | Full ticker research using fundamentals, expectations, valuation, and adversarial review |
| `report-digest` | Extract core numbers, assumptions, and stance from reports or transcripts |
| `wiki-think` | Compile raw notes into structured source pages and investment signals |
| `hypothesis-thinking` | Turn ambiguous questions into testable hypotheses and Bayesian updates |
| `portfolio-allocation` | Convert research views into position sizing logic |
| `flex-memory` | Review past predictions and identify recurring judgment errors |
| `product-review` | Evaluate technology products with a PM/operator lens |
| `augur` | Run a signal-compilation pipeline and render the result as a graph |

### Knowledge Model

The wiki is intentionally small and opinionated:

```text
raw/        original material, never rewritten
sources/    one page per valuable source, with facts/views/gaps
signal/     investable judgments with mechanism, consensus gap, position, and kill criteria
workspace/  temporary research drafts
```

The important design choice is that `signal/` is not a note folder. A signal must answer:

1. What exactly is happening?
2. Why is the market wrong?
3. How could this make or lose money?
4. What would prove the thesis wrong?

See [`investor-wiki/SCHEMA.md`](./investor-wiki/SCHEMA.md) for the full schema.

### Augur

Augur is the visual review layer for the research system. It turns compiled sources and signals into an interactive graph so the user can inspect:

- which sources support or contradict a signal
- where multiple signals share the same hidden assumption
- which themes are becoming crowded
- which signals have gone stale

Local preview, when private generated graph data is present:

```bash
cd investor-wiki/wiki
python3 -m http.server 8769 --bind 127.0.0.1
```

Then open:

- `http://127.0.0.1:8769/augur/index.html`

The public repo keeps the Augur UI source code but excludes generated private graph data such as `data.js` and semantic layout files.

## Local Setup

Install Python dependencies:

```bash
python3 -m pip install -r tools/requirements.txt
```

Copy or symlink the skills into Claude Code:

```bash
mkdir -p ~/.claude/skills
cp -R .claude/skills/* ~/.claude/skills/
```

Check the CLIs:

```bash
python3 tools/sources.py list
python3 tools/kb.py list
python3 tools/memory.py --help
```

Run a syntax check without writing cache files into the project:

```bash
PYTHONPYCACHEPREFIX=/tmp/codex-pycache \
python3 -m py_compile tools/sources.py tools/kb.py tools/memory.py
```

## Tooling

### `sources.py`

Searches curated information feeds:

```bash
python3 tools/sources.py hn "agentic coding"
python3 tools/sources.py arxiv "mixture of experts"
python3 tools/sources.py rss "AI capex"
```

Some sources require local configuration:

- `FOLO_SESSION_TOKEN` for Folo
- `XHS_MCP_URL` for Xiaohongshu MCP
- a local RSS `sources.yaml` file for the curated RSS feed list

### `kb.py`

Ingests documents into a local SQLite knowledge base and supports semantic search.

```bash
python3 tools/kb.py ingest report.pdf --company NVDA --type filing
python3 tools/kb.py search "AI capex sustainability" --top 5
python3 tools/kb.py list
```

Embeddings default to local Ollama:

```bash
EMBEDDING_PROVIDER=ollama
EMBEDDING_MODEL=nomic-embed-text
OLLAMA_BASE_URL=http://localhost:11434
```

OpenAI-compatible embeddings are also supported through environment variables.

### `memory.py`

Tracks prediction and reflection loops:

```bash
python3 tools/memory.py predict --help
python3 tools/memory.py calibrate --help
python3 tools/memory.py reflect --help
```

## Privacy Boundary

The public project is the workflow and tooling, not the private investment database.

By default, git should ignore:

- raw PDFs and clipped source material
- compiled private source pages
- private signal pages
- temporary research drafts
- Obsidian local state
- local databases, caches, and credentials

This keeps the GitHub version useful as a technical case study while avoiding accidental publication of proprietary notes or licensed research material.

## Current Status

Working locally:

- 12 investment-focused Claude Code skills
- 3 Python CLI tools
- local Markdown knowledge schema
- Augur static graph UI source
- private research wiki with hundreds of compiled source pages and dozens of investment signals

Known limitations:

- RSS source configuration is machine-local
- Folo and Xiaohongshu require local credentials/services
- semantic search quality depends on the local embedding backend
- the private wiki is intentionally not part of the public repo

## What I Would Discuss In An Interview

1. **Why simple RAG was not enough**: retrieval answers questions, but it does not maintain evolving investment judgment.
2. **Why the schema is opinionated**: fewer object types make the system easier for agents to maintain.
3. **How skills reduce prompt drift**: research behavior is encoded as files that can be versioned and reviewed.
4. **How the system handles uncertainty**: facts, views, gaps, conviction, deadline, and kill criteria are separated.
5. **How Augur changes review quality**: a graph view makes shared assumptions and stale signals easier to spot.

## Disclaimer

This is a research workflow project, not financial advice. The system can recommend and analyze, but trading decisions remain human decisions.
