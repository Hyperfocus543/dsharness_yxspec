# night2 自主优化：无限轮 + 崩溃自愈看门狗 + 按日日志归档

> 目录：`night/`（Windows Git Bash 环境）。运行中的实例不受脚本改动影响，改动在下次启动时生效。

## 一、行为变化

| 项 | 旧行为 | 新行为 |
|---|---|---|
| 停止通道 | stop-flag **或** END_AT 到点（默认明日 13:00） | **默认无限轮，stop-flag 是唯一停止通道**（`END_AT` 留空 → `END_EPOCH=0` → `check_stop()` 的到点判断短路） |
| 限时跑（可选） | — | 仍支持显式 `END_AT=HH:MM` 传限时跑，保留灵活性 |
| 崩溃自愈 | 无（runner 崩了就停了） | `watchdog-night2.sh` 每 N 秒检查 lock，失效自动重启 |
| 日志归档 | `.out`/`.patch`/`SUMMARY` 都写单目录/单文件 | **按日归档**：`log-night2/YYYYMMDD/` 子目录 + `SUMMARY-night2-YYYYMMDD.md`，跨午夜自动切日 |
| console 日志 | `launch-night2.sh` 已是 `exec ... >>` 追加 | 保留单文件追加，一直跑也不覆盖 |

## 二、文件与职责

| 文件 | 职责 |
|---|---|
| `runner-night2.sh` | 主循环。`END_AT="${END_AT:-}"` 默认一直跑；`run_agent`/`commit_and_push` 的 `.out`/`.patch` 按日归档；`log()`/checkpoint/commit 记录写 `SUMMARY-night2-$(date +%Y%m%d).md` |
| `watchdog-night2.sh` | 看门狗 wrapper。每 `WATCHDOG_INTERVAL`（默认 300s）检查 `launch-night2.sh` 写的 `.night2.lock`（lock 里 PID = runner 自身 PID，`exec` 后不变），无 lock 或 PID 已死 → 调 `launch-night2.sh start` 重启。带简单防双跑：`.watchdog.lock` 里 PID 存活则本实例退出 |
| `launch-night2.sh` | 防重复启动器（**保持不动**）。`stop` 子命令写 stop-flag；`start` 清旧 lock + 清旧 stop-flag + `exec` runner（PID 不变，lock 有效） |
| `gates.sh` / `guard.sh` | 六项门禁 + guard 复查（**保持不动**） |
| `SUMMARY-night2.md` | 旧的汇总文件，已废弃（历史内容保留，不再写入） |

## 三、启动 / 注册

### 3.1 手动前台启动（临时验证用）

```bash
cd /d/Work/04_Temp/yxspec-studio-release
bash night/watchdog-night2.sh                # 默认每 300s 检查
WATCHDOG_INTERVAL=60 bash night/watchdog-night2.sh   # 60s 检查一次
```

### 3.2 注册 Windows 计划任务（让看门狗开机/定时一直跑）

> **不要自动注册**——下面是手动注册方式，自行执行。

```bat
:: 每 5 分钟跑一次看门狗（最小粒度 minute）；看门狗自带防双跑，只注册这一个即可
schtasks /create /tn yxspec-night2-watchdog ^
  /tr "bash D:\Work\04_Temp\yxspec-studio-release\night\watchdog-night2.sh" ^
  /sc minute /mo 5

:: 停止计划任务（只是不再自动拉起，不杀当前进程）
schtasks /end /tn yxspec-night2-watchdog

:: 删除计划任务
schtasks /delete /tn yxspec-night2-watchdog /f
```

注意：Windows `schtasks` 的 `/tr` 用 `bash ...` 命令时，确保 `bash`（Git Bash）在系统 PATH，或写成 `"C:\Program Files\Git\bin\bash.exe" D:\Work\...\watchdog-night2.sh`。若嫌计划任务里配 PATH 麻烦，也可用 `schtasks` 的 `/ru` 指定账户 + Git Bash 绝对路径。

## 四、如何停止

正确顺序（两件事都要做）：

```bash
# 1) 让 runner 优雅停止：写 stop-flag，runner 当前轮结束后退出主循环
bash night/launch-night2.sh stop

# 2) 停掉看门狗，否则它会在 runner 停后把它自动重启回来：
#    - 手动跑的看门狗：杀掉该 watchdog 进程（或让其退出）
#    - 计划任务的看门狗：schtasks /end /tn yxspec-night2-watchdog
```

> ⚠️ 关键点：`launch-night2.sh start` 会清掉旧 stop-flag 再启动 runner，所以**看门狗拉起的新 runner 不受上次 stop 影响**——只有 stop-flag 加停看门狗双管齐下才真正停。这也是"stop-flag 唯一停止通道"在无限轮下的闭环。

## 五、日志位置（按日）

```
night/
├── log-night2/
│   ├── 20260829/
│   │   ├── fix-r1.out, verify-r2.out, pm-r3.out, feat-r4.out ...
│   │   └── fix-r1-150305.patch        # commit 失败时的改动快照（按日）
│   └── 20260830/                      # 跨午夜自动切日
├── SUMMARY-night2-20260829.md         # 当日汇总（追加）
├── SUMMARY-night2-20260830.md
└── night2-console.log                 # 单一 console 流（launch 的 >> 追加，一直跑不覆盖）
```

## 六、验证记录

- `bash -n` 三脚本语法通过：`runner-night2.sh` / `watchdog-night2.sh` / `launch-night2.sh`。
- 无限轮旁路验证：`END_AT=""` 时 `date -d "" +%s` 失败 → `END_EPOCH=0` → `check_stop()` 只走 stop-flag 通道（读代码 + 逻辑验证，未真跑）。
- 看门狗验证：`WATCHDOG_INTERVAL=5` 起一次 → 检测到现有 runner（lock PID 存活）→ 跳过不重启；验证完已 kill 看门狗进程。未停现有 runner。
