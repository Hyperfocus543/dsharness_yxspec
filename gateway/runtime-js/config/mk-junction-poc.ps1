$ErrorActionPreference = 'Stop'
$GW = 'D:\Work\01_Projects\Aima_X1_BCM\.dsh\gateway\runtime-js\node_modules\@deepseek-ai'
$PK = 'D:\AI\deepseek-harness-master\packages'
$pairs = @(
  ,@('dsh-workflow', "$PK\workflow\workflow")
  ,@('dsh-workflow-worker-thread', "$PK\workflow\workflow-worker-thread")
  ,@('dsh-tool-workflow', "$PK\workflow\tool-workflow")
  ,@('dsh-tool-ralph', "$PK\workflow\tool-ralph")
  ,@('dsh-schedule', "$PK\schedule\schedule")
  ,@('dsh-command-feedback', "$PK\feedback\command-feedback")
  ,@('dsh-message-feedback', "$PK\feedback\message-feedback")
  ,@('dsh-storage', "$PK\storage\storage")
  ,@('dsh-storage-domain', "$PK\storage\storage-domain")
  ,@('dsh-storage-json', "$PK\storage\storage-json")
  ,@('dsh-session-persistence', "$PK\session\session-persistence")
  ,@('dsh-typert-protocol', "$PK\typert\protocol")
  ,@('dsh-anonymous-user-id', "$PK\identity\anonymous-user-id")
)
foreach ($p in $pairs) {
  $name = $p[0]; $target = $p[1]
  $dst = Join-Path $GW $name
  if (Test-Path $dst) { Write-Output "SKIP(exists) $name"; continue }
  New-Item -ItemType Junction -Path $dst -Target $target | Out-Null
  Write-Output "CREATED $name -> $target"
}
