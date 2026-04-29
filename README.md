# Augur: Supervised Thinking

When AI makes information output cheap, the scarce interface is no longer "more answers." The scarce interface is a better way to supervise how the model organizes thought.

I call this **Supervised Thinking**.

Augur is an experimental interface for that idea: a replayable thinking machine built on top of an LLM Wiki-style knowledge system.

## Core Idea

LLM Wiki systems give language models a knowledge throughput mechanism. Raw material can be read, rewritten, linked, and accumulated across sessions.

But if AI output is going to become genuinely more useful to humans, we need more than retrieval and summaries. We need a way to observe the structure of the model's reasoning:

- what it noticed
- what it connected
- what it ignored
- which signals reinforced each other
- where contradictions appeared
- how a judgment changed across sessions

The answer should not be to sacrifice information density for readability. The answer is to use **schema and UI design** to make dense reasoning legible.

Augur turns model output into a structured reasoning layer: sources, signals, evidence links, contradiction edges, conviction changes, deadlines, and replayable updates.

## Why Augur

The name comes from ancient divination: reading scattered signs as a map.

In Augur, the "signs" are not stars. They are fragments of source material, model observations, semantic clusters, and evolving judgments.

Most graph views stop at file links or visual decoration. Obsidian graphs and common graphify tools are useful for navigation, but they usually do not understand the semantic relationship between nodes.

Augur pushes semantic structure into the graph itself. It combines:

- LLM Wiki-style knowledge compilation
- source filtering and signal promotion
- schema-defined node and edge types
- embedding-based semantic layout
- a UI for replaying how thought evolves over time

The goal is a cross-session reasoning trail: not a prettier note graph, but a way to supervise how an AI system organizes knowledge into judgment.

## What Is In This Repo

```text
.
├── .claude/skills/              # agent workflows
├── tools/                       # local CLI utilities
├── investor-wiki/SCHEMA.md      # reasoning schema
└── investor-wiki/wiki/augur/    # Augur graph UI source
```

The current implementation uses investment research as the first test domain, because it is a high-pressure environment for evidence, contradiction, uncertainty, and decision quality. But the project is not limited to finance. The core problem is broader: **how humans supervise AI thinking across large, evolving bodies of knowledge.**

## Architecture

Augur has three layers:

1. **Knowledge Throughput**  
   Raw inputs are compiled into structured source pages rather than left as undifferentiated chunks.

2. **Reasoning Schema**  
   The system separates facts, views, gaps, signals, evidence links, contradictions, conviction, and kill criteria.

3. **Visual Supervision**  
   The UI renders the reasoning graph so a human can inspect the model's organization of thought instead of only reading its final answer.

## Local Preview

The public repo includes the Augur UI source. Private generated graph data is excluded.

When local graph data is present:

```bash
cd investor-wiki/wiki
python3 -m http.server 8769 --bind 127.0.0.1
```

Then open:

```text
http://127.0.0.1:8769/augur/index.html
```

## Privacy Boundary

This repository publishes the framework, schema, tools, and UI shell. It does not publish the private knowledge base, source material, generated graph data, or personal research notes.

That boundary is intentional: Supervised Thinking is the system design; the private database is just one instantiation of it.
