---
name: sys-aq
description: 系统层需求澄清/追问机制（SYS-AQ-rules.yaml，SYS.2 分析阶段）
disable-model-invocation: false
user-invocable: true
whenToUse: 在 sys_analysis（系统需求分析，SYS.2）阶段生成 SR 条目时，用本技能做澄清/追问检查。
metadata:
  stage-token: sys_analysis
  applies-to: [sys_analysis]
---

> 权威规则源：`templates/rules/sys/SYS-AQ-rules.yaml`（框架侧，AQ 全量 484 行，规则集中维护）。
> 本 skill 是**装配指针 + 执行步骤**：执行时先读权威源全文，再按下方速查自检。

# 系统层需求澄清/追问机制（AQ）

在 SYS.2 系统需求分析阶段，对 SR 条目做**澄清/追问质量门**：基线约束引用完整性、关键基线溯源、框图数据溯源、子系统框架完整性等（AQ-01~xx，以权威源为准）。

## 执行步骤

1. **读权威源**：用 `fs`/`read` 读 `templates/rules/sys/SYS-AQ-rules.yaml`（484 行全量）
2. **逐条跑 AQ 检查**：基线约束引用完整 / 关键基线溯源 / 框图数据溯源 / 子系统框架完整性 / …
3. **未达标** → 按 AQ 的 `pass_condition` 判定 blocking，修正后重跑
4. **输出**：AQ 检查结论 + 未达标项 + 修正动作

## AQ 速查（详以权威源为准）

| ID | 名称 | severity | 要点 |
|---|---|---|---|
| AQ-01 | 基线约束引用完整性 | blocking | 每条约束有来源文档+章节号，禁 AI 归纳 |
| AQ-02 | 关键基线溯源 | blocking | 芯片型号/规格从 I2/I4 提取，清单一致 |
| AQ-03 | 框图数据溯源 | blocking | Mermaid 芯片/引脚/连线可溯到 I4/I5/I7 |
| AQ-04 | 子系统框架完整性 | blocking | 子系统划分有依据，无遗漏/多余 |
| … | （以权威源为准） | | |
