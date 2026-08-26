---
name: coding-rules
description: 工程编码规则（coding-rules）：编码入口唯一：分层/类型/工具库/日志/通信/API 规范/禁止事项强制规范。编码前必读。
disable-model-invocation: false
user-invocable: true
whenToUse: 在 swe_coding_do（编码执行）阶段写 C/H 源码前，加载本技能遵守工程编码规则。
metadata:
  stage-token: swe_coding_do
  applies-to: [swe_coding_do]
---

> 权威规则源：框架侧 `.claude/skills/coding-rules/SKILL.md`（TBox 工程编码规则手册，唯一规则源，约 464 行全量）。
> 本 skill 是**装配指针 + 执行步骤**：编码前读权威源全文，遵守硬约束。

# 工程编码规则（coding-rules）

编码执行（swe_coding_do）阶段**唯一规则源**：所有 C/H 源码修改必须遵守。加载本 skill 后直接落码。

## 执行步骤

1. **读权威源**：用 `fs`/`read` 读框架侧 `.claude/skills/coding-rules/SKILL.md`（TBox 工程编码规则手册全量）
2. **遵守硬约束**：分层（app/features/common/al/api/osdrv 单向调用）、类型约定（yx_type.h）、工具库（yx_utils_*）、模块三件套、日志（YX_LOG*）、消息总线（yx_core_msg_*）+ DSC（yx_dsc_*）、公共 API 规范、禁止事项清单
3. **编码后自检**：对照「禁止事项」逐条（禁 C 标准库直调、禁 osdrv 直引、禁反向依赖、禁臆造 API、禁 C 原生类型）

## 平台适配提示

> ⚠️ 权威源为 **TBox 平台**（ML307C/ASR1605）。若当前项目为 **Aima BCM**（不同平台），分层/类型/工具库具体实现可能不同，但**约束模式（分层单向调用 / 类型封装 / 工具库统一 / 禁止事项）通用**。以当前项目实际工程约定为准，冲突时优先当前项目约定。
