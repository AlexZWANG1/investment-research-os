# Augur Technical Architecture

This document describes the current public architecture of Augur. It separates the implemented prototype from the intended runtime direction.

## 1. Repository Layout

```text
investor-wiki/
├── SCHEMA.md
├── scripts/
│   ├── generate_augur_data.py
│   ├── compute_semantic_embeddings.py
│   └── compute_semantic_mds.py
└── wiki/
    ├── augur/
    │   ├── index.html
    │   ├── app.js
    │   ├── styles.css
    │   ├── data.js
    │   ├── semantic_layout.js
    │   └── semantic_layout.json
    ├── sources/
    ├── signal/
    └── log/
```

The public repo includes the UI shell, docs, and safe demo assets. Private generated research objects are excluded.

## 2. Static Data Flow

The current prototype is static-first.

```text
markdown wiki objects
        |
        v
scripts/generate_augur_data.py
        |
        v
wiki/augur/data.js
        |
        v
index.html -> app.js -> vis-network UI
```

`data.js` defines `window.AUGUR_DATA`. This keeps the UI deployable without a backend, which is useful for GitHub review and local demos.

## 3. Front-End Data Contract

`window.AUGUR_DATA` currently contains:

| Field | Type | Description |
|---|---|---|
| `SIGNALS` | object | Primary signal nodes. |
| `SOURCES` | object | Source nodes linked into signals. |
| `COMMUNITIES` | object | Topic groups used for color, filtering, and sidebars. |
| `SOURCE_KINDS` | object | Source category metadata. |
| `RUNS` | array | Reasoning runs, diary entries, causal steps, and timeline data. |
| `ENVISION_TEXT` | string | Optional long-term context text. |
| `TODAY` | Date | Timeline anchor. |
| `daysAgo` | function | UI helper for relative dates. |

The front-end also reads optional semantic coordinates:

```text
wiki/augur/semantic_layout.js -> window.AUGUR_SEMANTIC_LAYOUT
```

Keeping layout separate from content allows graph coordinates to be regenerated without rewriting the whole data payload.

## 4. Current Object Model

### Source Node

A source node represents one interpreted input item.

Typical fields:

| Field | Role |
|---|---|
| `id` | Stable source id. |
| `title` | Display title. |
| `kind` | Source category. |
| `date` | Source or ingestion date. |
| `summary` | Compressed observation. |
| `signals` | Signals this source supports or informs. |
| `url` / `path` | Optional external or local pointer. |

### Signal Node

A signal node represents a cross-source finding.

Typical fields:

| Field | Role |
|---|---|
| `id` | Stable signal id. |
| `title` | Display title. |
| `community` | Higher-level group. |
| `score` / `conviction` | Optional ranking signal. |
| `summary` | Why this signal matters. |
| `sources` | Supporting source ids. |
| `updated_at` | Last meaningful update. |

### Community

A community is above signal level. It groups related signals into a larger problem space and drives visual grouping.

The intended hierarchy is:

```text
raw -> source -> signal -> community
```

## 5. Graph Rendering

`wiki/augur/app.js` is the main renderer.

Responsibilities:

- convert `SIGNALS` and `SOURCES` into vis-network nodes
- create source-to-signal edges
- apply community colors
- apply semantic coordinates when available
- build side panels and hover details
- wire search, filters, fit controls, and timeline controls
- open local Obsidian links when paths are available

The graph is a projection. It should be treated as a rendering of state, not the canonical state itself.

## 6. Semantic Layout

The semantic layout scripts are experimental but important to the product direction.

Current scripts:

| Script | Purpose |
|---|---|
| `compute_semantic_embeddings.py` | Computes semantic positions from node text / embeddings. |
| `compute_semantic_mds.py` | Produces MDS coordinates from semantic distance. |

Output:

```text
wiki/augur/semantic_layout.json
wiki/augur/semantic_layout.js
```

The renderer should prefer semantic coordinates when ids match and fall back to graph physics when coordinates are missing.

## 7. Run and Replay Model

Runs are the bridge between static graph state and replayable thinking.

A run should contain:

| Field | Role |
|---|---|
| `id` | Run id. |
| `date` | Run timestamp. |
| `focus` | User-provided research focus. |
| `reads` | Sources read in this run. |
| `thinking_diary` | Externalized step-by-step work log. |
| `causal_chain` | Ordered graph changes for replay. |
| `created_nodes` | Nodes created by the run. |
| `updated_nodes` | Nodes revised by the run. |

Replay should reveal graph changes in causal order, not just chronological order.

## 8. Planned Live-State Direction

The current repo uses a static snapshot. The intended next architecture is:

```text
markdown nodes / run logs / semantic layout
        |
        v
state builder or local API
        |
        v
state.json
        |
        v
stable renderer
```

The renderer should accept structured state JSON:

```json
{
  "nodes": [],
  "edges": [],
  "communities": [],
  "runs": [],
  "timeline": [],
  "layout": {}
}
```

This allows future AI runs to produce scene/state data without generating raw HTML or JavaScript.

## 9. Privacy and Public Repo Boundary

Published:

- UI shell
- static safe assets
- docs
- schema direction
- utility scripts

Excluded:

- private raw data
- real generated source pages
- real generated signal pages
- private run logs
- credentials and local config

This keeps the repository reviewable while preserving the private research workspace.
