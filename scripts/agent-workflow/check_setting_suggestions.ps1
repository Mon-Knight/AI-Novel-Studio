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

$typeFile = Join-Path $root "src\types\settingSuggestion.ts"
$serviceFile = Join-Path $root "src\services\settingSuggestions\settingSuggestionService.ts"
$pageFile = Join-Path $root "src\pages\SettingSuggestions\SettingSuggestionsPage.tsx"
$appFile = Join-Path $root "src\App.tsx"
$mockFile = Join-Path $root "src\services\ai\mockAiClient.ts"

Assert-FileExists $typeFile
Assert-FileExists $serviceFile
Assert-FileExists $pageFile

Assert-Contains $typeFile "pending" "pending status"
Assert-Contains $typeFile "adopted" "adopted status"
Assert-Contains $typeFile "edited_adopted" "edited adopted status"
Assert-Contains $typeFile "discarded" "discarded status"

Assert-Contains $appFile "setting-suggestions" "novel setting suggestions route"
Assert-Contains $appFile "worlds/:worldId/lore/suggestions" "world alias route"

Assert-Contains $serviceFile "record\.status !==" "duplicate adoption guard"
Assert-Contains $serviceFile "characterService\.create" "character adoption target"
Assert-Contains $serviceFile "settingRepository\.saveWorldSetting" "world setting adoption target"
Assert-Contains $serviceFile "settingRepository\.saveRuleSystem" "rule adoption target"
Assert-Contains $serviceFile "aiTaskService\.create" "AI task recording"

Assert-Contains $pageFile "handleAdopt" "adoption UI handler"
Assert-Contains $pageFile "openEditAdopt" "edited adoption UI handler"
Assert-Contains $pageFile "handleDiscard" "discard UI handler"
Assert-Contains $pageFile "rawOutput" "raw prompt output UI"

Assert-Contains $mockFile "setting_suggestion_generate" "mock AI task support"

Write-Host "Setting suggestion static checks passed."
