# =====================================================================
# MOMO Corn - Android release APK 构建脚本（安全整改版）
#
# 与旧版的区别：
#   - 不执行任何 git 操作（不 pull、不改全局代理、不关闭 SSL 校验）
#   - 构建前显示当前 commit，由操作者确认代码状态
#   - 步骤拆分、每步失败即退出并保留完整日志（build-output.log）
#
# 用法：
#   .\build-apk.ps1                 # 直接构建（依赖已安装）
#   .\build-apk.ps1 -InstallDeps    # 先执行 npm ci 再构建
#   .\build-apk.ps1 -ProxyPort 7892 # 构建进程走本地代理（只影响本次，不改全局）
# =====================================================================

param(
    [switch]$InstallDeps,
    [int]$ProxyPort = 0
)

$ErrorActionPreference = "Stop"
$ProjectRoot = $PSScriptRoot
$AndroidDir = Join-Path $ProjectRoot "android"
$LogFile = Join-Path $ProjectRoot "build-output.log"

function Write-Step($msg) {
    Write-Host ""
    Write-Host "==========================================" -ForegroundColor Cyan
    Write-Host "  $msg" -ForegroundColor Cyan
    Write-Host "==========================================" -ForegroundColor Cyan
}

function Write-OK($msg)   { Write-Host "[OK]   $msg" -ForegroundColor Green }
function Write-Info($msg) { Write-Host "[INFO] $msg" -ForegroundColor Yellow }
function Write-Err($msg)  { Write-Host "[FAIL] $msg" -ForegroundColor Red }

function Fail($msg) {
    Write-Err $msg
    Write-Err "完整日志: $LogFile"
    exit 1
}

function Test-PortOpen($port) {
    try {
        $tcp = New-Object System.Net.Sockets.TcpClient
        $iar = $tcp.BeginConnect("127.0.0.1", $port, $null, $null)
        $success = $iar.AsyncWaitHandle.WaitOne(800, $false)
        if ($success) { $tcp.EndConnect($iar); $tcp.Close(); return $true }
        $tcp.Close(); return $false
    } catch { return $false }
}

# ---------- 步骤 0：确认代码状态 ----------
Write-Step "步骤 0/4：确认代码状态（不做任何 git 操作）"

if (Get-Command git -ErrorAction SilentlyContinue) {
    $commit = git log --oneline -1 2>$null
    $branch = git rev-parse --abbrev-ref HEAD 2>$null
    $dirty = git status --porcelain 2>$null
    Write-Host "  分支: $branch"
    Write-Host "  提交: $commit"
    if ($dirty) {
        Write-Info "工作区有未提交改动，将按当前磁盘内容打包（不会自动拉取或覆盖）："
        $dirty | Select-Object -First 8 | ForEach-Object { Write-Host "    $_" -ForegroundColor Gray }
    }
} else {
    Write-Info "未检测到 git，跳过版本展示"
}

# ---------- 步骤 1：依赖（可选） ----------
Write-Step "步骤 1/4：依赖安装"

if ($InstallDeps) {
    if (-not (Test-Path (Join-Path $ProjectRoot "package-lock.json"))) {
        Fail "缺少 package-lock.json，无法执行 npm ci"
    }
    Push-Location $ProjectRoot
    try {
        npm ci 2>&1 | Tee-Object -FilePath $LogFile -Append | Out-Null
        if ($LASTEXITCODE -ne 0) { Fail "npm ci 失败" }
        Write-OK "依赖安装完成"
    } finally { Pop-Location }
} else {
    if (-not (Test-Path (Join-Path $ProjectRoot "node_modules"))) {
        Fail "node_modules 不存在，请加 -InstallDeps 或先手动 npm ci"
    }
    Write-OK "跳过依赖安装（node_modules 已存在）"
}

# ---------- 步骤 2：探测 JDK ----------
Write-Step "步骤 2/4：探测 JDK（需要 17+，推荐 21）"

function Find-JdkHome {
    if ($env:JAVA_HOME -and (Test-Path (Join-Path $env:JAVA_HOME "bin\javac.exe"))) {
        return $env:JAVA_HOME
    }
    $javacCmd = Get-Command javac.exe -ErrorAction SilentlyContinue
    if ($javacCmd) {
        $candidate = Split-Path (Split-Path $javacCmd.Source)
        if (Test-Path (Join-Path $candidate "bin\javac.exe")) { return $candidate }
    }
    $userName = $env:USERNAME
    $candidates = @(
        "D:\AndroidStudio\jbr",
        "C:\Program Files\Android\Android Studio\jbr",
        "D:\Program Files\Android\Android Studio\jbr",
        "C:\Program Files\Java\*",
        "C:\Program Files\Eclipse Adoptium\*",
        "C:\Program Files\Microsoft\jdk-*",
        "C:\Users\$userName\.jdks\*"
    )
    foreach ($pattern in $candidates) {
        $paths = Get-Item $pattern -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName
        foreach ($p in $paths) {
            if ($p -and (Test-Path (Join-Path $p "bin\javac.exe"))) { return $p }
        }
    }
    return $null
}

$jdkHome = Find-JdkHome
if (-not $jdkHome) { Fail "未找到 JDK，请安装 JDK 21 或设置 JAVA_HOME" }
$env:JAVA_HOME = $jdkHome
$env:PATH = "$jdkHome\bin;" + $env:PATH
$javacVer = & "$jdkHome\bin\javac.exe" -version 2>&1 | Out-String
Write-OK "JDK: $jdkHome ($($javacVer.Trim()))"

# ---------- 步骤 3：探测 Android SDK ----------
Write-Step "步骤 3/4：探测 Android SDK"

function Find-AndroidSdk {
    if ($env:ANDROID_HOME -and (Test-Path $env:ANDROID_HOME)) { return $env:ANDROID_HOME }
    if ($env:ANDROID_SDK_ROOT -and (Test-Path $env:ANDROID_SDK_ROOT)) { return $env:ANDROID_SDK_ROOT }
    $localProps = Join-Path $AndroidDir "local.properties"
    if (Test-Path $localProps) {
        $line = Get-Content $localProps | Where-Object { $_ -match '^sdk\.dir=' } | Select-Object -First 1
        if ($line) {
            $sdk = $line -replace 'sdk\.dir=', '' -replace '\\\\', '\' -replace '/', '\'
            if (Test-Path $sdk) { return $sdk }
        }
    }
    $userName = $env:USERNAME
    $candidates = @(
        "D:\AndroidStudio\Sdk",
        "D:\Android\Sdk",
        "D:\Sdk",
        "C:\Android\Sdk",
        "C:\Users\$userName\AppData\Local\Android\Sdk"
    )
    foreach ($p in $candidates) {
        if (Test-Path $p) { return $p }
    }
    return $null
}

$sdkHome = Find-AndroidSdk
if (-not $sdkHome) { Fail "未找到 Android SDK，请安装 Android Studio 或设置 ANDROID_HOME" }
$env:ANDROID_HOME = $sdkHome
$env:ANDROID_SDK_ROOT = $sdkHome
Write-OK "Android SDK: $sdkHome"

# ---------- 步骤 4：构建 ----------
Write-Step "步骤 4/4：构建 release APK（内嵌 JS bundle，无需 Metro）"

$gradlew = Join-Path $AndroidDir "gradlew.bat"
if (-not (Test-Path $gradlew)) { Fail "未找到 gradlew.bat: $gradlew（android/ 目录缺失时先运行 npx expo prebuild --platform android）" }

if ($ProxyPort -gt 0) {
    if (Test-PortOpen $ProxyPort) {
        Write-Info "构建进程使用本地代理 127.0.0.1:$ProxyPort（仅本次进程生效）"
        $env:HTTP_PROXY = "http://127.0.0.1:$ProxyPort"
        $env:HTTPS_PROXY = "http://127.0.0.1:$ProxyPort"
    } else {
        Write-Info "代理端口 $ProxyPort 未开放，直连构建"
    }
}

$env:NODE_ENV = "production"
$startTime = Get-Date

$prevEAP = $ErrorActionPreference
$ErrorActionPreference = "Continue"
Push-Location $AndroidDir
$exitCode = 1
try {
    & $gradlew assembleRelease --no-daemon 2>&1 | Tee-Object -FilePath $LogFile -Append |
        ForEach-Object {
            $line = $_.ToString()
            if ($line -match 'Task |BUILD |FAILED|error:|Error') { Write-Host $line -ForegroundColor Gray }
        }
    $exitCode = $LASTEXITCODE
} finally {
    Pop-Location
    $ErrorActionPreference = $prevEAP
}

$elapsed = (Get-Date) - $startTime
$elapsedStr = "{0}m {1}s" -f [int]$elapsed.TotalMinutes, $elapsed.Seconds

# ---------- 结果 ----------
Write-Step "构建结果"

if ($exitCode -eq 0) {
    $apkPath = Join-Path $AndroidDir "app\build\outputs\apk\release\app-release.apk"
    if (-not (Test-Path $apkPath)) { Fail "构建成功但未找到 APK: $apkPath" }
    $apkFile = Get-Item $apkPath
    $sizeMB = [math]::Round($apkFile.Length / 1MB, 2)
    Write-OK "构建成功！耗时 $elapsedStr"
    Write-Host "  路径: $($apkFile.FullName)"
    Write-Host "  大小: $sizeMB MB"
    Write-Host "  时间: $($apkFile.LastWriteTime)"
    exit 0
} else {
    Fail "构建失败，退出码 $exitCode，耗时 $elapsedStr"
}
