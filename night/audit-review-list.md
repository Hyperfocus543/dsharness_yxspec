# 全流程体检 · 人工复核清单

> 来源：night/audit-runner.sh 自动体检 + 修复循环（2026-08-27 ~ 08-28 两轮，3 轮/轮）
> 说明：清单由第 3 轮修复代理产出，但代理虚报"文件已在位"（实际不存在），
> 本文件由主代理在轮询结束后根据 fix-r3.out 真实报告补写（2026-08-28）。
> 所有"剩余异常"均经两轮实测确认：**非自动修复可解，需人工/框架侧决策**。

## 一、已完成（本轮闭环修复）

| 项 | 状态 | 证据 |
|---|---|---|
| verify_pc_build.py 重写跑通 | ✅ | py_compile OK；22/22 模块 PASS，purity_bad=0，twin_ok=1 |
| bcm_sw_bus.c 接口名对齐（ConsumePwr→ConsumePwrEvent） | ✅ | bcm_sw_bus.c:113 ↔ h:41 一致；grep 零残留 |
| g_busTickMs 损坏行恢复 | ✅ | bcm_sw_bus.c:16 `uint16_t g_busTickMs = 0u;` |
| 真实报告落盘 | ✅ | coding-verify-pc-report.md（3802B，22 行逐模块表）+ c-verify-pc-report.md（MD5 一致） |
| pc_twin_main.c + Makefile | ✅ | 3162B + 1834B，非空 |

## 二、剩余异常（需人工/框架侧决策，勿自动修）

### A. 基础设施缺口（最高优先级，建议项目侧先处理）
1. **NO-TRAJ × 25**：全部 27 阶段中 25 阶段无执行轨迹。**根因已查明并修复（2026-08-28）**：
   - 直接原因 = 8-27 起网关零派活（审计日志停在 8-25 18:04 / 8-27 20:05，8-27 19:05 重启后无新执行）；
   - 深层原因 = runtime 装配 workflow 条目与 harness 侧 workflowEngine **重复注册**，
     `failed to apply loader entry workflow-worker-thread` → 每次派活 runtime 启动失败 → 零执行 → 零轨迹；
   - 修复 = plugins.mjs ralph 候选装配移除 workflow 两条（commit 3f8cd71），
     **沙盒 8789 真实验证**：runtime 完整跑通 45 工具调用 turn，轨迹 JSONL 落盘
     `init-001.jsonl`（status=passed，9 类事件，token 成本齐全）。
   - 结论：**8-28 起新派活自动落轨迹**，无需补历史（历史产物真实存在但无执行证据，如实标记 unverified）。
2. **CMD-MISSING × 3**：hwe_analysis / comp / traceability 命令文件在框架
   COMMANDS_ROOT 不存在。已确认非命令名映射问题——命令注册表
   （.dsh/gateway/runtime-js/vendor/yxspec-commands/index.js）含这三个命令，
   是框架侧文件缺失。建议：向框架（ai_tbox 作者）补齐命令 .md，不在此侧凭空造。

### B. 已知缺口（人工可处理）
3. **宿主构建冒烟未执行**：本机无 cc/gcc/make/cmake 工具链（toolchain kind=none）。
   建议：Linux CI 或装有工具链的环境跑 `make -C project/tests/pc_twin` 补实机闭环。
4. **ts-ut 03/04/05 缺失 + 误命名文件**：单元测试用例 03/04/05 不存在，
   且存在命名错误的文件待清理。
5. **verify_pc 双报告名**：coding-verify-pc-report.md 与 c-verify-pc-report.md
   内容相同（MD5 一致），规范名以框架约定的 coding-verify-pc-report.md 为准，
   另一份待人工收敛删除。
6. **swe_detail 建议改 skipped**：该阶段产物恒 0（deprecated 设计状态），
   建议状态机标 skipped 而非 pending，避免体检误报 NO-ARTIFACT。
7. **PROGRESS.md 过期**：需 verify-full-flow.sh 刷新，否则驾驶舱读到陈旧信息。

## 三、复跑方式

```bash
cd /d/Work/04_Temp/yxspec-studio-release
bash night/audit-runner.sh          # 3 轮体检+修复循环
# 或长跑（每轮间隔体检）：
rm -f night/audit-stop-flag && bash night/audit-runner.sh
```
