param()

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)

function Assert-FileExists {
  param([string]$Path)
  if (-not (Test-Path -LiteralPath $Path)) {
    throw "Missing file: $Path"
  }
}

function Assert-Contains {
  param(
    [string]$Path,
    [string]$Pattern,
    [string]$Label
  )
  $content = Get-Content -Raw -Encoding UTF8 -LiteralPath $Path
  if ($content -notmatch $Pattern) {
    throw "Missing check [$Label] in $Path"
  }
}

function Assert-NotContains {
  param(
    [string]$Path,
    [string]$Pattern,
    [string]$Label
  )
  $content = Get-Content -Raw -Encoding UTF8 -LiteralPath $Path
  if ($content -match $Pattern) {
    throw "Forbidden pattern [$Label] found in $Path"
  }
}

$commandsFile = Join-Path $root "src-tauri\src\commands.rs"
$dbFile = Join-Path $root "src-tauri\src\db.rs"
$mainFile = Join-Path $root "src-tauri\src\main.rs"
$dbServiceFile = Join-Path $root "src\services\database\db.ts"
$serviceFile = Join-Path $root "src\services\ai\aiTaskService.ts"
$centerServiceFile = Join-Path $root "src\services\ai-tasks\aiTaskCenterService.ts"
$pageFile = Join-Path $root "src\pages\AiTasks\AiTasksPage.tsx"
$pageTestFile = Join-Path $root "src\test\ai-task-center\taskCenter.test.tsx"
$errorFile = Join-Path $root "src\utils\errorMessage.ts"
$runtimeScript = Join-Path $root "scripts\agent-workflow\runtime_check_ai_task_delete.ps1"

Assert-FileExists $commandsFile
Assert-FileExists $dbFile
Assert-FileExists $mainFile
Assert-FileExists $dbServiceFile
Assert-FileExists $serviceFile
Assert-FileExists $centerServiceFile
Assert-FileExists $pageFile
Assert-FileExists $pageTestFile
Assert-FileExists $errorFile
Assert-FileExists $runtimeScript

Assert-Contains $commandsFile "pub fn delete_ai_task_record" "single delete command"
Assert-Contains $commandsFile "pub fn delete_ai_task_records_by_ids" "bulk delete command"
Assert-Contains $commandsFile "pub fn clear_ai_task_records" "clear all command"
Assert-Contains $commandsFile "pub fn get_ai_task_records_debug_state" "debug state command"
Assert-Contains $commandsFile 'DELETE FROM ai_task_records WHERE id = \?1' "parameterized id delete"
Assert-Contains $commandsFile "DELETE FROM ai_task_records" "clear table delete"
Assert-Contains $commandsFile 'SELECT COUNT\(\*\) FROM ai_task_records WHERE id = \?1' "post-delete id check"
Assert-Contains $commandsFile "before_match_count == 0" "zero-match delete guard"
Assert-Contains $commandsFile "before_count - after_count" "clear deleted count"
Assert-Contains $commandsFile "AI_TASK_DELETE_RUST" "runtime delete logging"
Assert-Contains $commandsFile "ai_task_records_table_exists" "table existence check"
Assert-Contains $commandsFile "table_exists" "table existence logging"
Assert-Contains $commandsFile "ai_task_delete_runtime_insert_list_delete_clear" "runtime delete rust test"

Assert-Contains $dbFile "pub fn get_database_path" "database path helper"

Assert-Contains $mainFile "commands::delete_ai_task_record" "single delete registration"
Assert-Contains $mainFile "commands::delete_ai_task_records_by_ids" "bulk delete registration"
Assert-Contains $mainFile "commands::clear_ai_task_records" "clear all registration"
Assert-Contains $mainFile "commands::get_ai_task_records_debug_state" "debug state registration"

Assert-Contains $dbServiceFile '\[DB_CALL_FAILED\]' "db call failure logging"
Assert-Contains $dbServiceFile "rawError" "db call raw error logging"
Assert-Contains $dbServiceFile "new Error\(errorMessage\)" "tauri string error normalization"

Assert-Contains $errorFile "describeUnknownError" "unknown error formatter"

Assert-Contains $serviceFile "delete_ai_task_record" "service single delete invoke"
Assert-Contains $serviceFile "delete_ai_task_records_by_ids" "service bulk delete invoke"
Assert-Contains $serviceFile "clear_ai_task_records" "service clear invoke"
Assert-Contains $serviceFile "deletedCount" "delete count result"
Assert-Contains $serviceFile "clearLocalTaskCache" "local task cache cleanup"
Assert-Contains $serviceFile "result\.deletedCount === 0" "zero delete failure"
Assert-Contains $serviceFile '\[AI_TASK_SERVICE\] deleteMany invoke' "service runtime logging"
Assert-Contains $serviceFile 'remainingIds\.length > 0' "post-delete guard"
Assert-Contains $serviceFile 'check\.length > 0' "post-clear guard"
Assert-NotContains $serviceFile '\.catch\(\(\) => getLocalTasks' "tauri getAll fallback catch"
Assert-NotContains $serviceFile '\.catch\(\(\) => \{' "tauri dbCall fallback catch"

Assert-Contains $centerServiceFile "archive_ai_task_view" "unified task archive command"
Assert-Contains $centerServiceFile "delete_ai_task_record" "legacy task delete command"
Assert-Contains $centerServiceFile "delete_legacy_generation_job_record" "legacy generation delete command"
Assert-Contains $centerServiceFile 'await aiTaskCenterService\.refresh\(\)' "task center refresh after delete"
Assert-Contains $pageFile 'await aiTaskCenterService\.deleteRecord\(item\)' "page delegates record delete"
Assert-Contains $pageFile "confirmDanger" "page delete confirmation"
Assert-Contains $pageFile "awaiting_confirmation.*completed.*failed.*cancelled.*expired" "terminal-only delete gate"
Assert-Contains $pageTestFile "deletes a terminal record after confirmation" "page terminal delete test"
Assert-Contains $pageTestFile "never offers deletion for active tasks" "page active delete guard test"

Assert-Contains $runtimeScript "cargo test ai_task_delete_runtime_insert_list_delete_clear" "runtime test command"

Write-Host "AI task delete static checks passed."
