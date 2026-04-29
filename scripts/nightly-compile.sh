#!/usr/bin/env bash
# nightly-compile.sh — 凌晨自动编制脚本
# 设计为 Windows Task Scheduler 或 cron 在 04:00 触发
#
# 流程：
#   1. 跑 RSS-Notion 日报 pipeline → output/<date>/data.json
#   2. 把日报 data.json 复制到 wiki raw 层
#   3. 启动 Claude Code 编制新材料进 wiki
#
# 依赖：
#   - claude CLI (Claude Code subscription)
#   - python 3.11+ (RSS-Notion 环境)
#   - node (Folo pipeline, optional)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WIKI_ROOT="D:/研究空间/investor-wiki"
RSS_NOTION_ROOT="D:/项目开发/RSS-Notion"
TODAY=$(date +%Y-%m-%d)
LOG_FILE="$WIKI_ROOT/wiki/_compile-log-${TODAY}.txt"

log() { echo "[$(date '+%H:%M:%S')] $*" | tee -a "$LOG_FILE"; }

log "========== Nightly compile started =========="

# ── Phase 1: Run RSS-Notion pipeline ──
log "Phase 1: Running RSS-Notion daily pipeline..."
cd "$RSS_NOTION_ROOT"

# Run with --skip-email (no need for email at 4am)
if python main.py --skip-email >> "$LOG_FILE" 2>&1; then
    log "  RSS-Notion pipeline completed"
else
    log "  WARNING: RSS-Notion pipeline had errors, continuing..."
fi

# ── Phase 2: Copy daily output to wiki raw layer ──
log "Phase 2: Syncing RSS-Notion output to wiki raw..."
DAILY_OUTPUT="$RSS_NOTION_ROOT/output/$TODAY"
RAW_DAILY="$WIKI_ROOT/raw/ai-daily"
mkdir -p "$RAW_DAILY"

if [ -f "$DAILY_OUTPUT/data.json" ]; then
    cp "$DAILY_OUTPUT/data.json" "$RAW_DAILY/${TODAY}.json"
    log "  Copied data.json → raw/ai-daily/${TODAY}.json"
else
    log "  WARNING: No data.json found for $TODAY"
fi

# ── Phase 3: Detect new materials ──
log "Phase 3: Detecting new materials..."

# 3a: New webclipper files (check mtime < 24h)
NEW_CLIPPER=$(find "$WIKI_ROOT/raw/webclipper/" -name "*.md" -mtime -1 2>/dev/null | wc -l)
log "  New webclipper files (last 24h): $NEW_CLIPPER"

# 3b: New raw files across all dirs (check mtime < 24h)
NEW_RAW=$(find "$WIKI_ROOT/raw/" -name "*.md" -o -name "*.txt" -o -name "*.json" | \
    xargs -r stat --format='%Y %n' 2>/dev/null | \
    awk -v cutoff="$(date -d '24 hours ago' +%s)" '$1 > cutoff {print $2}' | wc -l)
log "  New raw files (last 24h): $NEW_RAW"

# 3c: New AI daily data
NEW_DAILY=0
if [ -f "$RAW_DAILY/${TODAY}.json" ]; then
    # Check if source-ai-daily-<date>.md already exists
    if [ ! -f "$WIKI_ROOT/wiki/sources/source-ai-daily-${TODAY}.md" ]; then
        NEW_DAILY=1
    fi
fi
log "  New AI daily to compile: $NEW_DAILY"

TOTAL_NEW=$((NEW_CLIPPER + NEW_RAW + NEW_DAILY))
if [ "$TOTAL_NEW" -eq 0 ]; then
    log "No new materials found. Skipping compilation."
    log "========== Nightly compile finished (nothing to do) =========="
    exit 0
fi

# ── Phase 4: Claude Code compilation ──
log "Phase 4: Starting Claude Code compilation ($TOTAL_NEW new items)..."
cd "$WIKI_ROOT"

# Clear CLAUDECODE env to avoid nesting issues
unset CLAUDECODE 2>/dev/null || true

# Build the compilation prompt
COMPILE_PROMPT=$(cat <<'PROMPT_EOF'
你是 wiki 编制员。今天是 TODAY_PLACEHOLDER。按 CLAUDE.md schema 执行以下任务：

## 任务 1: AI Daily 编制
读 raw/ai-daily/TODAY_PLACEHOLDER.json，提取有投资 signal 价值的 findings，编制为 wiki/sources/source-ai-daily-TODAY_PLACEHOLDER.md。
- 只保留对投资决策有用的信息（公司动态、产品发布、融资、行业趋势）
- 跳过纯技术/学术内容除非直接影响 ticker
- 上限 100 行

## 任务 2: Webclipper 新内容
扫描 raw/webclipper/ 下最近 24 小时新增的 .md 文件。对每个新文件：
- 判断是否有 wiki 价值（投资相关 > 纯技术教程）
- 有价值的编制为 wiki/sources/source-*.md
- 无价值的跳过并在 log 记录

## 任务 3: Raw 新材料
扫描 raw/ 所有子目录下最近 24 小时新增的 .md/.txt 文件（排除已处理的）。
按 CLAUDE.md schema 编制。

## 任务 4: Signal 升级检查
编制完成后，检查是否有新 source 应触发 signal 页更新：
- 新 source 是否与现有 signal 相关？更新 signal 页的 evidence/contradiction
- 2+ 独立来源支持同一新 thesis？创建新 signal 页

完成后在 wiki/_log.md 末尾追加今日编制摘要。
PROMPT_EOF
)

# Replace date placeholder
COMPILE_PROMPT="${COMPILE_PROMPT//TODAY_PLACEHOLDER/$TODAY}"

# Run Claude Code in non-interactive mode
# --bare skips hooks/LSP/plugins to avoid nesting issues in scheduled runs
# --add-dir loads CLAUDE.md from wiki root for schema reference
echo "$COMPILE_PROMPT" | claude -p \
    --output-format text \
    --model claude-sonnet-4-6 \
    --bare \
    --add-dir "$WIKI_ROOT" \
    --allowedTools Read Write Edit Glob Grep Bash \
    >> "$LOG_FILE" 2>&1

log "  Claude Code compilation finished"

# ── Phase 5: Summary ──
log "========== Nightly compile finished =========="
log "  New materials processed: $TOTAL_NEW"
log "  Log: $LOG_FILE"
