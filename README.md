# Augur · 占

**A node-based interface for reading, organizing, and replaying AI-assisted thinking.**

Augur is an early prototype of a **Supervised Thinking** workspace: raw materials are compiled into typed nodes, connected through semantic layout, and replayed as a visible reasoning trail.

## Product Screenshots

<p align="center">
  <img src="assets/augur-logo.png" alt="Augur brand system" width="520">
</p>

<p align="center">
  <img src="assets/augur-desktop.png" alt="Augur desktop thinking network" width="920">
</p>

<p align="center">
  <img src="assets/augur-mobile-graph.png" alt="Augur mobile thinking network" width="360">
  &nbsp;&nbsp;
  <img src="assets/augur-mobile-replay.png" alt="Augur mobile replay scene" width="360">
</p>

<p align="center">
  <img src="assets/augur-sandbox.png" alt="Augur sandbox graph" width="920">
</p>

## What It Does

Augur turns a long-running research process into an inspectable graph UI.

The current prototype focuses on this loop:

```text
raw material -> source node -> signal node -> community -> run diary -> replay timeline
```

- **Source nodes** capture what was observed in one source.
- **Signal nodes** capture cross-source discoveries.
- **Communities** group multiple signals into a higher-level topic.
- **Run logs** record what changed during a reasoning pass.
- **Semantic layout** uses embeddings / similarity structure so node position carries meaning.
- **Replay UI** shows how a line of thought develops instead of only showing the final answer.

The first test domain is research, but the structure is not investment-specific. The same node model can be applied to product strategy, technical research, literature review, legal analysis, or any workflow where evidence and judgment accumulate across sessions.

## Product Thesis

Most AI products return a final answer. Augur is designed around a different surface: make the intermediate reasoning objects visible enough for a human to inspect, keep, challenge, fork, or replay.

It is not trying to expose hidden model chain-of-thought. It stores an external, reviewable work log: what sources were read, what nodes were created, what relationships were proposed, and how a run changed the graph.

## Technical Architecture

```text
investor-wiki/
├── SCHEMA.md                         # Node / run / diary schema direction
├── scripts/
│   ├── generate_augur_data.py         # Builds static AUGUR_DATA snapshot
│   ├── compute_semantic_embeddings.py # Embedding-based layout experiment
│   └── compute_semantic_mds.py        # MDS layout from semantic distance
└── wiki/
    ├── augur/
    │   ├── index.html                 # UI shell
    │   ├── app.js                     # Graph, panels, replay interactions
    │   ├── styles.css                 # Desktop/mobile visual system
    │   ├── data.js                    # Static data snapshot
    │   └── semantic_layout.js         # Optional semantic coordinates
    ├── sources/                       # Generated/private source nodes
    ├── signal/                        # Generated/private signal nodes
    └── log/                           # Generated/private run logs
```

### 1. Data Contract

The front-end reads `window.AUGUR_DATA` from `wiki/augur/data.js`.

Current top-level fields:

| Field | Role |
|---|---|
| `SIGNALS` | Signal nodes rendered as primary graph objects. |
| `SOURCES` | Source nodes linked to signals. |
| `COMMUNITIES` | Higher-level groups used for color, filters, and side panels. |
| `SOURCE_KINDS` | Source categories and display metadata. |
| `RUNS` | Run history, diary entries, causal steps, and replay events. |
| `ENVISION_TEXT` | Optional long-term context. |
| `TODAY` | Date anchor for timeline filtering. |

`semantic_layout.js` is loaded separately so graph content and graph coordinates can evolve independently.

### 2. Node Model

Augur is node-first. `source` and `signal` are the current typed nodes, not the final ontology.

Minimum useful node fields:

```json
{
  "id": "stable-node-id",
  "type": "source | signal | question | contradiction | fork | diary_step",
  "title": "short display title",
  "content": "readable node body",
  "origin": "raw | ai | user | prior_node",
  "parents": ["raw-or-node-id"],
  "community": "higher-level grouping",
  "run_id": "reasoning run that created or changed it",
  "status": "active | pinned | archived | challenged"
}
```

The important part is not the label itself, but provenance: each node should retain where it came from and why it exists.

### 3. Rendering Layer

The UI is intentionally lightweight:

- `vis-network` renders the graph.
- `app.js` maps typed nodes into graph nodes and edges.
- Side panels expose communities, signals, sources, and run entries.
- Timeline controls reveal graph state by run step.
- Obsidian links can open the corresponding local markdown page when local vault paths are available.

The renderer is a projection of graph state. It should not be the source of truth.

### 4. Layout Layer

Augur supports two layout modes:

- force-directed graph layout for quick local rendering
- semantic coordinates from embedding / similarity calculations

The goal is not decorative graph motion. Node position should communicate semantic proximity: related sources and signals should cluster for a reason.

### 5. Run / Replay Layer

A run log should make the reasoning process inspectable:

```text
read source -> write observation -> connect dots -> create/update signal -> record diary -> replay graph delta
```

Current replay work focuses on:

- showing which nodes appear at each step
- linking diary entries to graph changes
- keeping source-to-signal traceability
- making contradictions and forks visible instead of burying them in prose

### 6. Future Runtime Direction

The current public prototype uses `data.js` as a static snapshot. The intended direction is a live state contract:

```text
wiki objects / run logs / semantic layout -> state JSON -> stable renderer
```

AI should output structured scene/state JSON, not raw front-end code. The renderer can then project the same state as graph, feed, mobile cards, replay timeline, memo, or fork comparison.

## Current Status

Included in this public repository:

- Augur UI shell
- desktop and mobile product screenshots
- schema and architecture docs
- static data snapshot path
- semantic layout experiments
- run/replay design direction

Intentionally excluded:

- private raw materials
- generated private source nodes
- generated private signal nodes
- generated run data from the real workspace
- credentials, tokens, cookies, and local MCP config

## Docs

- [Technical Architecture](docs/ARCHITECTURE.md)
- [Roadmap](docs/ROADMAP.md)

## Local Preview

The UI can be served as static files:

```bash
cd investor-wiki/wiki
python3 -m http.server 8769 --bind 127.0.0.1
```

Open:

```text
http://127.0.0.1:8769/augur/index.html
```

The public snapshot is safe to view. Private generated graph data is not included.

## English Summary

Augur is a node-based interface for supervising AI-assisted research and thinking. It converts raw material into typed nodes, lays them out semantically, records external reasoning diaries, and replays how a graph changes across runs.

The long-term direction is a generalized thinking substrate: AI produces structured state; a stable renderer projects that state as graph, feed, timeline, replay scene, memo, or fork comparison.
