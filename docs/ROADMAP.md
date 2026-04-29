# Augur Roadmap

This roadmap keeps the project grounded: each step should make the UI easier to run, inspect, or extend.

## Near Term

### 1. Public Demo Dataset

Ship a small non-private dataset with the repository.

Deliverables:

- 10-20 public raw items
- generated source nodes
- generated signal nodes
- one run log with diary entries
- one semantic layout file

Success criteria:

- a reviewer can clone the repo and see a non-empty graph
- every visible node can be traced back to a local markdown file
- no private research material is included

### 2. Documented Data Contract

Replace implicit `data.js` assumptions with a documented contract.

Target files:

```text
nodes.json
edges.json
communities.json
runs.json
layout.json
```

`data.js` can remain as a bundled fallback, but the renderer should be able to consume the cleaner contract.

### 3. Run Diary Panel

Make run diaries a first-class UI surface.

Required behavior:

- left rail shows the current run
- each diary step links to the source or node it changed
- selecting a step highlights the relevant graph objects
- replay uses causal order instead of only timestamp order

## Mid Term

### 4. State Builder

Create one state builder responsible for converting markdown wiki objects into renderer-ready JSON.

Responsibilities:

- parse source pages
- parse signal pages
- parse run logs
- validate required fields
- attach semantic layout when available
- emit one state payload

This should reduce the need for ad hoc data generation.

### 5. Semantic Layout Pipeline

Make semantic layout reproducible.

Requirements:

- stable node ids
- cached embeddings
- deterministic coordinates for unchanged nodes
- fallback layout when embeddings are missing
- visual diff when layout changes significantly

### 6. Fork Runtime

Add a real fork model.

A fork should store:

- parent run id
- inherited nodes
- changed assumptions
- new nodes
- comparison back to parent

The goal is to compare alternate reasoning paths without polluting the main graph.

### 7. Scene / State JSON

Define a compact schema for AI-produced UI state.

The AI should emit structured objects:

```json
{
  "focus": "",
  "nodes": [],
  "edges": [],
  "diary_steps": [],
  "timeline_events": [],
  "layout_hints": []
}
```

The front-end should render this state rather than asking the AI to generate raw UI code.

## Long Term

### 8. Multi-Projection Renderer

Render the same state as multiple views:

- graph
- feed
- timeline
- mobile replay
- memo
- comparison table

This tests whether Augur is truly state-first instead of graph-only.

### 9. Review and Correction Loop

Add controls for human review:

- keep / archive a node
- challenge a relation
- promote a source observation into a signal
- fork from a disputed assumption
- mark a contradiction as material or irrelevant

These actions should write back into the state model.

### 10. Cross-Domain Templates

Test the same architecture outside investment research.

Candidate templates:

- product strategy
- technical architecture review
- academic literature review
- legal case analysis
- policy research

Each template can define its own labels, but should reuse the same core state model: nodes, edges, provenance, runs, diary, layout, replay.
