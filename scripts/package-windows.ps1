# AI Novel Studio Windows 打包脚本
# 使用方式：
#   npm run package:windows
#   或直接：powershell -ExecutionPolicy Bypass -File scripts\package-windows.ps1

$ErrorActionPreference = "Stop"

Write-Host "====================================="
Write-Host "AI Novel Studio Windows 打包开始"
Write-Host "====================================="

# 1. 定位项目根目录
$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectRoot
Write-Host "当前项目目录：$ProjectRoot"

# 2. 检查关键文件
if (!(Test-Path "package.json")) {
    throw "未找到 package.json，请确认当前目录是 AI Novel Studio 项目根目录"
}
if (!(Test-Path "src-tauri")) {
    throw "未找到 src-tauri 目录，请确认这是 Tauri 项目"
}

# 3. 显示环境版本
Write-Host ""
Write-Host "--- 检查 Node / npm / Rust 环境 ---"
try { node -v } catch { throw "未检测到 Node.js，请先安装 Node.js >= 18" }
try { npm -v } catch { throw "未检测到 npm" }
try { rustc --version } catch { throw "未检测到 Rust，请先安装 Rust" }
try { cargo --version } catch { throw "未检测到 Cargo" }

# 4. 安装依赖
Write-Host ""
Write-Host "--- 安装前端依赖 ---"
npm install
if ($LASTEXITCODE -ne 0) { throw "npm install 失败" }

# 5. 可选 lint（失败不阻断打包）
Write-Host ""
Write-Host "--- 执行 lint 检查 ---"
try {
    npm run lint
    if ($LASTEXITCODE -eq 0) {
        Write-Host "lint 检查通过"
    } else {
        Write-Host "lint 未通过，但继续执行 build。请后续修复 lint warning/error。" -ForegroundColor Yellow
    }
} catch {
    Write-Host "lint 未通过，但继续执行 build。请后续修复 lint warning/error。" -ForegroundColor Yellow
}

# 6. 前端构建
Write-Host ""
Write-Host "--- 执行前端 build ---"
npm run build
if ($LASTEXITCODE -ne 0) { throw "npm run build 失败" }

# 7. 清理旧打包产物（只清理 bundle，不删整个 target）
Write-Host ""
Write-Host "--- 清理旧 release bundle ---"
$BundlePath = "src-tauri\target\release\bundle"
if (Test-Path $BundlePath) {
    Remove-Item $BundlePath -Recurse -Force
    Write-Host "已清理：$BundlePath"
}

# 8. Tauri 正式打包
Write-Host ""
Write-Host "--- 执行 Tauri Windows 打包 ---"
npm run tauri:build
if ($LASTEXITCODE -ne 0) { throw "npm run tauri:build 失败" }

# 9. 检查输出
Write-Host ""
Write-Host "--- 检查打包产物 ---"

$NsisPath = "src-tauri\target\release\bundle\nsis"
$MsiPath  = "src-tauri\target\release\bundle\msi"
$FoundPackage = $false

if (Test-Path $NsisPath) {
    Write-Host "NSIS 安装包："
    Get-ChildItem $NsisPath -Filter "*.exe" | ForEach-Object {
        $FoundPackage = $true
        Write-Host "  $($_.FullName)" -ForegroundColor Green
    }
}
if (Test-Path $MsiPath) {
    Write-Host "MSI 安装包："
    Get-ChildItem $MsiPath -Filter "*.msi" | ForEach-Object {
        $FoundPackage = $true
        Write-Host "  $($_.FullName)" -ForegroundColor Green
    }
}
if (-not $FoundPackage) {
    throw "未找到任何 .exe 或 .msi 安装包，请检查 Tauri 打包配置"
}

# 10. 复制到 release_output
Write-Host ""
Write-Host "--- 复制安装包到 release_output ---"

$OutputDir = "release_output"
if (!(Test-Path $OutputDir)) {
    New-Item -ItemType Directory -Path $OutputDir | Out-Null
}
if (Test-Path $NsisPath) {
    Copy-Item "$NsisPath\*.exe" $OutputDir -Force -ErrorAction SilentlyContinue
}
if (Test-Path $MsiPath) {
    Copy-Item "$MsiPath\*.msi" $OutputDir -Force -ErrorAction SilentlyContinue
}

Write-Host ""
Write-Host "release_output 内容："
Get-ChildItem $OutputDir | ForEach-Object {
    Write-Host "  $($_.FullName)" -ForegroundColor Green
}

Write-Host ""
Write-Host "=====================================" -ForegroundColor Green
Write-Host "打包完成！安装包输出目录：" -ForegroundColor Green
Write-Host "  $ProjectRoot\release_output" -ForegroundColor Green
Write-Host "=====================================" -ForegroundColor Green
