---
name: prd-gq6
description: 生成 PRD 后按 CMP/VER/CON/TRC/CLR/PRI 六维自评，加权 ≥75 分通过（GQ-rules.yaml GQ-5）
disable-model-invocation: false
user-invocable: true
whenToUse: 在 sys_elicitation（PRD 分析）阶段生成 PRD 产物后，用本技能做六维自评，通过质量门。
metadata:
  stage-token: sys_elicitation
  applies-to: [sys_elicitation]
---

> 权威规则源：`templates/rules/prd/GQ-rules.yaml`（框架侧，IQ 内联断言 + GQ 质量门全量，规则集中维护）。
> 本 skill 是**装配指针 + 执行步骤**：执行时先读权威源全文，再按本页速查表自评。

# PRD 六维打分表（GQ-5）

生成 PRD 后，按 **CMP/VER/CON/TRC/CLR/PRI 六维** 对产物自评，加权 **≥75 分** 才通过质量门。

## 执行步骤

1. **读权威源**：用 `fs`/`read` 读 `templates/rules/prd/GQ-rules.yaml`（IQ-1~9 内联断言 + GQ-1~5 质量门，578 行全量）
2. **先跑 IQ 内联断言**（生成时逐项即时校验）：章节完整性 / 无占位符 / must 条目来源 / REQ-ID 格式 / …（IQ-1~9）
3. **再按 GQ 六维逐维打分**（GQ-1~5）
4. **输出自评结论**：总分 + 加权分 + 未达 75 的维度 + 修复动作

## 六维打分速查（详以 GQ-rules.yaml 为准）

| 维度 | 权重 | 要点 |
|---|---|---|
| CMP 完整性 | 0.20 | 全部 MANDATORY 章节覆盖、占位符 {{}} 清零、CON 四维全覆盖、锚点覆盖率 ≥95% |
| VER 可验证性 | 0.20 | 模糊词清零、性能指标全量化、非规范约束词清零、验收准则可转测试用例 |
| CON 一致性 | 0.20 | 条目间无矛盾、优先级标注一致、接口引用一致、格式统一 |
| TRC 追溯性 | 0.20 | 无源项数=0、Must 条目 100% 有原文来源、derived_from 指向有效章节、编号可追溯到下游 |
| CLR 明确性 | 0.15 | 描述清晰、术语表覆盖、缩写展开完整 |
| PRI 优先级 | 0.05 | 优先级分配合理、Must/Should/May 比例适当（40-60% / 25-40% / 10-20%）|
