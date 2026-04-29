# Workspace

LLM 工作区（scratchpad），不是最终发布层。

## 结构

```
workspace/
  portfolio/     # 组合层：大类配置、信号交叉、stress test、持仓诊断
  research/      # 个股层：深度研究 R1/R2/R3 + eval + models
  _runs/         # 批处理日志
  _archive/      # 历史废弃物（不删，不看）
```

## 规则

1. 新输出默认写 `workspace/`，按类型选子目录
2. 讨论和迭代完成后，再发布到 `wiki/`
3. `wiki/` 只放长期可复用知识，不放临时版本
