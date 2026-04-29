#!/usr/bin/env bash
# hourly-wiki-loop.sh — 每小时 investor-wiki 编制循环（人工触发或计划任务触发）
#
# 目标：
#   1) 优先处理 task_plan.md 的 Next Batch Queue
#   2) 每轮只处理 1-2 份原料，避免信息过载
#   3) 优先强化已有 signal，不做节点膨胀
#   4) 同步 _log / task_plan / findings / progress

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WIKI_ROOT="D:/workspace_ascii/investor-wiki"
TODAY="$(date +%Y-%m-%d)"
NOW="$(date '+%Y-%m-%d %H:%M:%S')"
LOG_FILE="$WIKI_ROOT/wiki/_hourly-loop-${TODAY}.log"
LOCK_DIR="$WIKI_ROOT/wiki/.hourly-loop.lock"

log() { echo "[$(date '+%H:%M:%S')] $*" | tee -a "$LOG_FILE"; }

NOON_EPOCH="$(date -d "$(date +%Y-%m-%d) 12:00:00" +%s)"
NOW_EPOCH="$(date +%s)"
if [ "$NOW_EPOCH" -ge "$NOON_EPOCH" ]; then
  log "Past 12:00 local time, skip loop."
  exit 0
fi

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  log "Another hourly loop instance is still running; skip this trigger."
  exit 0
fi
cleanup_lock() { rmdir "$LOCK_DIR" 2>/dev/null || true; }
trap cleanup_lock EXIT

log "========== Hourly wiki loop started @ $NOW =========="

if [ ! -d "$WIKI_ROOT" ]; then
  log "ERROR: wiki root not found: $WIKI_ROOT"
  exit 1
fi

cd "$WIKI_ROOT"

unset CLAUDECODE 2>/dev/null || true

COMPILE_PROMPT=$(cat <<'PROMPT_EOF'
你在执行 investor-wiki 的“每小时编制 loop”。

请严格按以下顺序做 1 次迭代（本轮上限 45 分钟）：

1) 先读取：
- `task_plan.md`
- `findings.md`
- `progress.md`
- `wiki/SCHEMA.md`
- `CLAUDE.md`

2) 优先处理 `task_plan.md` 的 Next Batch Queue 顶部原料：
- 本轮最多处理 1-2 个 raw 文件
- 原则：优先文本清晰、可直接提炼投资启发的材料

3) 编制策略：
- 优先更新已有 `wiki/sources/source-*.md`（必要时新建 source）
- 优先更新已有 `wiki/signal/*.md` 的 Evidence/可执行性
- 除非明确必要，不新增 signal 数量（控制图谱膨胀）
- 页面保持 thesis-first + opportunity-first

4) 可读性优化：
- source 页保留：Quick Read / 核心 Findings / Opportunity Extraction / Signal 关联
- signal 页保留：Thesis / Why Now / Mispricing / Position / Evidence / Kill Criteria

5) 收尾：
- 更新 `wiki/_log.md`（追加本轮摘要）
- 更新 `task_plan.md`（移动队列）
- 更新 `findings.md`、`progress.md`

约束：
- 不改目录结构
- 不做大规模重构
- 以“少而重 signal”为硬约束
- 不调用 `~/.claude/skills/*` 的脚本，不执行 session-catchup
PROMPT_EOF
)

log "Running Codex hourly iteration..."
if printf '%s\n' "$COMPILE_PROMPT" | timeout 2700s codex exec \
  --model gpt-5.4-mini \
  --dangerously-bypass-approvals-and-sandbox \
  --skip-git-repo-check \
  --cd "$WIKI_ROOT" \
  >> "$LOG_FILE" 2>&1; then
  log "Codex loop completed within 45 minutes."
else
  log "WARNING: Codex loop exited non-zero or timed out (45 minutes)."
fi

log "========== Hourly wiki loop finished =========="
