# Augur Technical Architecture

Augur is a Supervised Thinking system. Its architecture separates knowledge ingestion, reasoning structure, semantic layout, and visual supervision.

## 1. Knowledge Throughput Layer

The first layer converts raw material into structured source objects.

Raw inputs can include reports, transcripts, web clippings, RSS items, papers, or manually collected notes. Augur does not treat these inputs as anonymous chunks. Each useful item is compiled into a source page with explicit fields:

- facts
- views
- gaps
- credibility
- related signals
- supporting or contradicting evidence

The point is to make knowledge maintainable across sessions. A later run should not reread the same raw material from scratch if a structured source already exists.

## 2. Reasoning Schema Layer

The schema defines how raw observations become inspectable reasoning units.

Core object types:

| Object | Role |
|---|---|
| `raw` | Original material. Preserved, not rewritten. |
| `source` | Structured interpretation of one source. |
| `signal` | A judgment that can be supported, contradicted, updated, or killed. |
| `evidence edge` | A source-to-signal relationship. |
| `contradiction edge` | A tension between source, signal, or thesis. |
| `run log` | A replayable record of how a reasoning pass evolved. |

A signal is not a note. It must answer:

- What is happening?
- Why does it matter?
- What evidence supports it?
- What would change the judgment?
- What is the deadline or validation window?

## 3. Skills Layer

Claude Code skills act as the execution layer.

They route different requests into different reasoning modes:

- `augur`: run a complete source-to-signal pipeline
- `wiki-think`: compile raw material into wiki objects
- `research`: test a thesis with evidence and valuation
- `deep-research`: pressure-test a draft with adversarial questions
- `hypothesis-thinking`: convert uncertainty into explicit hypotheses
- `flex-memory`: record predictions and calibrate judgment

Skills are deliberately stored as files. That makes the reasoning workflow versionable, reviewable, and reusable.

## 4. Semantic Graph Layer

Common graph tools usually visualize explicit links. Augur adds semantic structure below the visual layer.

The current graph model combines:

- explicit source-to-signal links
- community assignment
- node type and confidence metadata
- embedding-based semantic proximity
- manually inspectable layout constraints

The design goal is that node distance should carry meaning. A nearby node should not only be visually adjacent; it should be semantically related or structurally connected.

## 5. Visual Supervision Layer

The UI is built to help a human supervise thought, not just browse notes.

Core surfaces:

- **Thinking Network**: global graph of sources, signals, communities, and evidence relations
- **Thought Feed**: chronological stream of changes across sessions
- **Signal Index**: current state of active judgments
- **Sandbox / Replay Mode**: a bounded reasoning run that can be stepped through

The central interaction is not search. It is inspection: following how an AI system organized knowledge into judgment.

## 6. Privacy Boundary

The public repository includes the framework, schema, tools, skills, and UI shell.

It intentionally excludes:

- private raw material
- generated source pages
- generated signal pages
- live graph data
- local credentials
- personal research notes

This keeps the system demonstrable without exposing the private knowledge base.

