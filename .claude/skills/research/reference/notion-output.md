# Workspace / Wiki Output Reference

> 由 `research/SKILL.md` 引用。**仅适用于 research 专项工作流**：研究完成时默认写入 workspace；只有在用户要求沉淀时再发布到 wiki。  
> 全局规则不变：日常 ingest/知识编制默认写 wiki，最终长期知识以 wiki 为准。

## 输出层级

1. **默认层（workspace）**
  - `investor-wiki/workspace/research/drafts/{topic}.md`：初稿
  - `investor-wiki/workspace/research/evaluations/eval_{topic}.md`：审查稿
  - `investor-wiki/workspace/research/synthesis/{topic}-final.md`：可读定稿
2. **发布层（wiki，可选）**
  - 仅当用户明确要求“写入 wiki / 固化结论”时执行
  - 发布后更新 `investor-wiki/wiki/_index.md` 与 `investor-wiki/wiki/_log.md`

## 默认步骤

1. 完成本地 `investor-wiki/workspace/research/synthesis/{topic}-final.md`
2. 通知用户到 Obsidian `investor-wiki/workspace/` 阅读
3. 用户确认后，再整合写入 `wiki/`（不是复制粘贴）

## 禁止

- 未确认就直接写入 wiki
- 在 wiki 保留大量 `r1/r2/revised` 平级版本
- 把内部评分表直接发布到 wiki（应留在 workspace）

## 断点恢复

研究可能跨多轮 Evaluator 迭代；中断后要能继续。首次进入 research 流程时确保目录存在：

```bash
mkdir -p investor-wiki/workspace/research/drafts investor-wiki/workspace/research/evaluations investor-wiki/workspace/research/synthesis
```

跨会话恢复：在 `investor-wiki/workspace/research/planning.md` 里记录当前研究进度（topic / 当前轮次 N / Generator 进行到哪一步 / 上一轮 Evaluator 判定是 PASS 还是 CONTINUE / 待修问题清单）。中断后**先 Read planning.md 恢复状态**再继续，不要从头重跑。
