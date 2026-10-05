$ErrorActionPreference = 'Stop'
$taskPnpm = Get-Command pnpm.cmd -ErrorAction SilentlyContinue
if (-not $taskPnpm) { throw '请先安装 Node.js 24 和 pnpm 10.28.2：npm install -g pnpm@10.28.2' }
& $taskPnpm.Source @args
exit $LASTEXITCODE
