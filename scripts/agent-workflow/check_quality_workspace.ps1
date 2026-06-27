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
    throw "Unexpected check [$Label] in $Path"
  }
}

$workspacePage = Join-Path $root "src\pages\WritingWorkspace\WritingWorkspacePage.tsx"
$mainFile = Join-Path $root "src\main.tsx"
$editorArea = Join-Path $root "src\components\workspace\EditorArea.tsx"
$rightToolbar = Join-Path $root "src\components\right-dock\RightToolbar.tsx"
$rightPanel = Join-Path $root "src\components\right-dock\RightPanel.tsx"
$checkPanel = Join-Path $root "src\components\right-dock\panels\CheckPanel.tsx"
$qualityService = Join-Path $root "src\services\quality\qualityCheckService.ts"
$qualityFixService = Join-Path $root "src\services\ai\qualityFixService.ts"
$qualityTypes = Join-Path $root "src\types\qualityCheck.ts"
$commandsFile = Join-Path $root "src-tauri\src\commands.rs"
$dbFile = Join-Path $root "src-tauri\src\db.rs"

Assert-FileExists $workspacePage
Assert-FileExists $mainFile
Assert-FileExists $editorArea
Assert-FileExists $rightToolbar
Assert-FileExists $rightPanel
Assert-FileExists $checkPanel
Assert-FileExists $qualityService
Assert-FileExists $qualityFixService
Assert-FileExists $qualityTypes
Assert-FileExists $commandsFile
Assert-FileExists $dbFile

Assert-Contains $mainFile "MIN_STARTUP_SPLASH_MS" "startup splash keeps visible briefly"
Assert-Contains $mainFile "scheduleHideStartupSplash" "startup splash hides after minimum duration"

Assert-Contains $editorArea "EditorContentSnapshot" "editor snapshot type"
Assert-Contains $editorArea "onEditorContentChange" "editor snapshot callback"
Assert-Contains $editorArea "applyTextRequest" "AI text apply request"
Assert-Contains $editorArea "hashTextContent" "editor content hash"
Assert-Contains $editorArea "EditorCommandRequest" "editor accepts right toolbar command requests"
Assert-Contains $editorArea "adopt-current" "editor can adopt current draft from right toolbar"
Assert-NotContains $editorArea "className=""editor-toolbar""" "editor inline toolbar removed"

Assert-Contains $workspacePage "editorSnapshot" "workspace editor snapshot state"
Assert-Contains $workspacePage "handleEditorContentChange" "workspace snapshot handler"
Assert-Contains $workspacePage "currentEditorContent=" "workspace passes current editor content"
Assert-Contains $workspacePage "currentContentHash=" "workspace passes current content hash"
Assert-Contains $workspacePage "onApplyAiText=" "workspace passes AI apply callback"
Assert-Contains $workspacePage "target\?\.closest\('button, a, input, textarea, select" "workspace toolbar clicks do not instantly close right panel"
Assert-Contains $workspacePage "getNovelForWorkspace" "workspace retries novel lookup before not-found state"
Assert-Contains $workspacePage "NOVEL_LOAD_RETRY_DELAYS_MS" "workspace has bounded novel lookup retry delays"
Assert-Contains $workspacePage "onRunCommand=" "workspace passes editor commands to right toolbar"

Assert-Contains $rightToolbar "command: 'save'" "right toolbar has save command"
Assert-Contains $rightToolbar "id: 'draft-history'" "right toolbar has draft history panel"
Assert-Contains $rightToolbar "command: 'format'" "right toolbar has format command"
Assert-Contains $rightToolbar "command: 'adopt-current'" "right toolbar has adopt command"

Assert-Contains $rightPanel "currentEditorContent" "right panel receives current editor content"
Assert-Contains $rightPanel "currentContentHash" "right panel receives content hash"
Assert-Contains $rightPanel "onApplyAiText" "right panel forwards AI apply callback"

Assert-Contains $checkPanel "currentEditorContent" "check panel consumes current editor content"
Assert-Contains $checkPanel "reportOutdated" "check panel detects outdated report"
Assert-Contains $checkPanel "qualityCheckService\.createReport\(\{" "check panel creates SQLite report"
Assert-Contains $checkPanel "contentHash" "check panel binds content hash"
Assert-Contains $checkPanel "qualityCheckService\.saveResult\(\{" "check panel saves result"
Assert-Contains $checkPanel "setFixError\(" "AI fix blocks stale reports"
Assert-Contains $checkPanel "comparison\.isBetter" "AI fix gates adoption by comparison"
Assert-Contains $checkPanel "onGenerated\(newDraft\)" "AI fix applies better draft to workspace"

Assert-Contains $qualityTypes "contentHash\?: string" "quality type content hash"
Assert-Contains $qualityTypes "contentLength\?: number" "quality type content length"
Assert-Contains $qualityTypes "checkedAt\?: string" "quality type checked timestamp"

Assert-Contains $qualityService "create_quality_check_report" "quality service uses Tauri report create"
Assert-Contains $qualityService "getDbMode" "quality service detects desktop database mode"
Assert-Contains $qualityService "getDbMode\(\) === 'tauri'" "quality service does not localStorage fallback in Tauri mode"
Assert-Contains $qualityService "isMissingReportError" "quality service detects missing report errors"
Assert-Contains $qualityService "report placeholder missing, recreating before retry" "quality service recreates missing report placeholder once"
Assert-Contains $qualityService "save_quality_check_result', \{ input: nextPayload \}" "quality service wraps Tauri save input args"
Assert-Contains $qualityService "contentHash: input\.contentHash" "quality service save payload content hash"
Assert-Contains $qualityService "contentLength: input\.contentLength" "quality service save payload content length"
Assert-Contains $qualityService "checkedAt: input\.checkedAt" "quality service save payload checked timestamp"

Assert-Contains $qualityFixService "normalizeFixResult" "quality fix normalizes AI response"
Assert-Contains $qualityFixService "revised_content" "quality fix accepts snake case revised content"
Assert-Contains $qualityFixService "fixed_issue_keys" "quality fix accepts snake case fixed issue keys"
Assert-Contains $qualityFixService "changed_ranges" "quality fix accepts snake case changed ranges"

Assert-Contains $commandsFile "pub content_hash: Option<String>" "Rust report DTO content hash"
Assert-Contains $commandsFile "pub content_length: Option<i64>" "Rust report DTO content length"
Assert-Contains $commandsFile "pub checked_at: Option<String>" "Rust report DTO checked timestamp"
Assert-Contains $commandsFile "content_hash, content_length, checked_at" "Rust quality report select fields"
Assert-Contains $commandsFile "INSERT INTO quality_check_reports .*content_hash, content_length, checked_at" "Rust report create writes snapshot fields"
Assert-Contains $commandsFile "content_hash = COALESCE" "Rust report save preserves content hash"

Assert-Contains $dbFile 'ensure_column\(conn, "quality_check_reports", "content_hash"' "DB migration content hash"
Assert-Contains $dbFile 'ensure_column\(conn, "quality_check_reports", "content_length"' "DB migration content length"
Assert-Contains $dbFile 'ensure_column\(conn, "quality_check_reports", "checked_at"' "DB migration checked timestamp"

Write-Host "Quality workspace static checks passed."
