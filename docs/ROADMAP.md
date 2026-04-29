# Augur Roadmap

Augur is currently a working prototype of a Supervised Thinking interface. The next step is to turn it from a domain-specific research workspace into a more general reasoning substrate.

## Near Term

### 1. Public Demo Dataset

Create a small synthetic or public-domain dataset that can ship with the repository.

Goal:

- let reviewers run the graph without private research data
- demonstrate source -> signal -> replay
- keep the example small enough to inspect manually

### 2. Mobile Screenshots and Replay Prototype

Add polished mobile screenshots once source image files are available.

Target screens:

- mobile thinking network
- scene replay mode
- signal summary card
- bottom timeline control

These should be real product screenshots or carefully labeled design prototypes, not broken README placeholders.

### 3. Cleaner Graph Data Contract

Split generated graph data into a documented contract:

```text
nodes.json
edges.json
communities.json
runs.json
layout.json
```

The UI should consume this contract instead of relying on project-specific generated JavaScript.

## Mid Term

### 4. Replayable Reasoning Runs

A run should be replayable as a sequence:

1. read source
2. extract observation
3. link to existing signal
4. create contradiction or update
5. adjust conviction
6. write run log
7. render graph delta

The user should be able to scrub the timeline and see how the graph changed.

### 5. Contradiction-First Workflow

Augur should make contradictions first-class objects.

Instead of hiding disagreement inside prose, the system should expose:

- source contradicts signal
- signal conflicts with another signal
- two signals share the same hidden assumption
- evidence has aged past its validation window

This is the core difference between a knowledge graph and a supervised thinking graph.

### 6. Cross-Domain Templates

Investment research is the first test domain. The same architecture should support:

- product strategy
- legal case analysis
- medical literature review
- technical architecture research
- policy research
- academic literature synthesis

Each domain needs its own schema vocabulary, but the same underlying pattern applies: source -> signal -> contradiction -> judgment -> replay.

## Long Term

### 7. Persistent Cross-Session Reasoning

The long-term direction is a persistent reasoning layer above ordinary memory.

Ordinary memory remembers facts. Augur should preserve the structure of thought:

- why a judgment existed
- what evidence created it
- what contradicted it
- when it changed
- what would falsify it

This is the real meaning of Supervised Thinking.

### 8. Substrate and Projection Separation

Augur should eventually separate:

- **substrate**: canonical reasoning state
- **projection**: graph, feed, timeline, report, mobile UI

The same reasoning substrate should be viewable as:

- graph
- timeline
- signal table
- replay scene
- written memo

The UI becomes a projection of thinking, not the source of truth.

### 9. Human-AI Review Loop

The final product direction is a review loop where the human can:

- approve or reject promoted signals
- mark contradictions as material or irrelevant
- edit schema fields directly
- ask the model to explain why two nodes are connected
- force a replay from a different assumption

This turns AI output from a black-box answer into an inspectable, corrigible reasoning process.
