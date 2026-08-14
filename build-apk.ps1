# =====================================================================
# MOMO Corn - APK 一键打包脚本
# 功能：拉取最新代码 → 自动探测环境 → 打包 release APK → 显示路径
# 换电脑可用：自动探测 JDK / Android SDK / 代理，无需硬编码路径
# =====================================================================

$ErrorActionPreference = "Stop"
$ProjectRoot = $PSScriptRoot
$AndroidDir = Join-Path $ProjectRoot "android"

# ---------- 工具函数 ----------
function Write-Step($msg) {
    Write-Host ""
    Write-Host "==========================================" -ForegroundColor Cyan
    Write-Host "  $msg" -ForegroundColor Cyan
    Write-Host "==========================================" -ForegroundColor Cyan
}

function Write-OK($msg)    { Write-Host "[OK]   $msg" -ForegroundColor Green }
function Write-Info($msg)  { Write-Host "[INFO] $msg" -ForegroundColor Yellow }
function Write-Err($msg)   { Write-Host "[FAIL] $msg" -ForegroundColor Red }
function Write-Detail($msg){ Write-Host "       $msg" -ForegroundColor Gray }

function Test-PortOpen($port) {
    try {
        $tcp = New-Object System.Net.Sockets.TcpClient
        $iar = $tcp.BeginConnect("127.0.0.1", $port, $null, $null)
        $success = $iar.AsyncWaitHandle.WaitOne(800, $false)
        if ($success) { $tcp.EndConnect($iar); $tcp.Close(); return $true }
        $tcp.Close(); return $false
    } catch { return $false }
}

# ---------- 环境探测 ----------
function Find-JdkHome {
    # 1) JAVA_HOME
    if ($env:JAVA_HOME -and (Test-Path (Join-Path $env:JAVA_HOME "bin\javac.exe"))) {
        return $env:JAVA_HOME
    }
    # 2) PATH 中的 javac
    $javacCmd = Get-Command javac.exe -ErrorAction SilentlyContinue
    if ($javacCmd) {
        $candidate = Split-Path (Split-Path $javacCmd.Source)
        if (Test-Path (Join-Path $candidate "bin\javac.exe")) { return $candidate }
    }
    # 3) 常见安装路径
    $candidates = @()
    # 项目内（便携 JDK）
    $candidates += (Get-ChildItem $ProjectRoot -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '^(jdk|jre|java)' }).FullName
    # D 盘常见位置
    $candidates += @("D:\Java\*", "D:\jdk*", "D:\Program Files\Java\*", "D:\Program Files\Eclipse Adoptium\*")
    # C 盘常见位置
    $userName = $env:USERNAME
    $candidates += @(
        "C:\Program Files\Java\*",
        "C:\Program Files\Eclipse Adoptium\*",
        "C:\Program Files\Microsoft\jdk-*",
        "C:\Program Files\Zulu\*",
        "C:\Users\$userName\.jdks\*",
        "C:\Users\$userName\AppData\Local\Programs\Eclipse Adoptium\*"
    )
    # Android Studio 内置 JBR
    $candidates += @(
        "D:\AndroidStudio\jbr",
        "C:\Program Files\Android\Android Studio\jbr",
        "D:\Program Files\Android\Android Studio\jbr"
    )
    foreach ($pattern in $candidates) {
        if (-not $pattern) { continue }
        $paths = @()
        if ($pattern -like "*\*") {
            $paths = Get-Item $pattern -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName
        } else {
            if (Test-Path $pattern) { $paths = @($pattern) }
        }
        foreach ($p in $paths) {
            if (-not $p) { continue }
            if (Test-Path (Join-Path $p "bin\javac.exe")) { return $p }
        }
    }
    return $null
}

function Find-AndroidSdk {
    # 1) 环境变量
    if ($env:ANDROID_HOME -and (Test-Path $env:ANDROID_HOME)) { return $env:ANDROID_HOME }
    if ($env:ANDROID_SDK_ROOT -and (Test-Path $env:ANDROID_SDK_ROOT)) { return $env:ANDROID_SDK_ROOT }
    # 2) android/local.properties
    $localProps = Join-Path $AndroidDir "local.properties"
    if (Test-Path $localProps) {
        $line = Get-Content $localProps | Where-Object { $_ -match '^sdk\.dir=' } | Select-Object -First 1
        if ($line) {
            $sdk = $line -replace 'sdk\.dir=', '' -replace '\\\\', '\' -replace '/', '\'
            if (Test-Path $sdk) { return $sdk }
        }
    }
    # 3) 常见路径
    $userName = $env:USERNAME
    $candidates = @(
        "D:\Android\Sdk",
        "D:\AndroidStudio\Sdk",
        "D:\Sdk",
        "D:\Android SDK",
        "C:\Android\Sdk",
        "C:\Users\$userName\AppData\Local\Android\Sdk",
        "C:\Users\$userName\AppData\Local\Android\sdk"
    )
    foreach ($p in $candidates) {
        if (Test-Path $p) { return $p }
    }
    return $null
}

# =====================================================================
# 主流程
# =====================================================================

Write-Host ""
Write-Host "================================================" -ForegroundColor Magenta
Write-Host "    MOMO Corn - APK 一键打包工具" -ForegroundColor Magenta
Write-Host "================================================" -ForegroundColor Magenta
Write-Host "  项目目录: $ProjectRoot"

# ---------- 步骤 1：检测 Git 并拉取最新代码 ----------
Write-Step "步骤 1/4：从 GitHub 拉取最新代码"

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Err "未检测到 git，请先安装 Git 并加入 PATH"
    exit 1
}

# 配置代理（仅当 7892 端口开放时）
$proxyPort = 7892
if (Test-PortOpen $proxyPort) {
    Write-Info "检测到本地代理端口 $proxyPort 开放，启用代理"
    $env:HTTP_PROXY  = "http://127.0.0.1:$proxyPort"
    $env:HTTPS_PROXY = "http://127.0.0.1:$proxyPort"
    git config http.proxy "http://127.0.0.1:$proxyPort" 2>$null
    git config https.proxy "http://127.0.0.1:$proxyPort" 2>$null
    git config http.sslBackend openssl 2>$null
    git config http.sslVerify false 2>$null
} else {
    Write-Info "未检测到代理（端口 $proxyPort 未开放），使用直连"
    git config --unset http.proxy 2>$null
    git config --unset https.proxy 2>$null
}

# 配置 git 身份（若未设置）
if (-not (git config user.name)) { git config user.name "e59292193" }
if (-not (git config user.email)) { git config user.email "e59292193@users.noreply.github.com" }

Write-Info "正在拉取远程最新代码..."
try {
    $pullOutput = git pull origin main 2>&1 | Out-String
    Write-Host $pullOutput -ForegroundColor Gray
    if ($LASTEXITCODE -eq 0) {
        Write-OK "代码已更新到最新版本"
    } else {
        Write-Err "git pull 失败（继续尝试打包...）"
    }
} catch {
    Write-Err "git pull 异常: $_（继续尝试打包...）"
}

$commit = git log --oneline -1
Write-Host "当前版本: $commit" -ForegroundColor Gray

# ---------- 步骤 2：探测 JDK ----------
Write-Step "步骤 2/4：探测 JDK 环境"

$jdkHome = Find-JdkHome
if (-not $jdkHome) {
    Write-Err "未找到 JDK（需要 JDK 17+，推荐 JDK 21）"
    Write-Host ""
    Write-Host "已尝试以下位置：" -ForegroundColor Yellow
    Write-Host "  - JAVA_HOME 环境变量"
    Write-Host "  - PATH 中的 javac"
    Write-Host "  - 项目根目录下的 jdk 文件夹"
    Write-Host "  - D:\Java\*, D:\AndroidStudio\jbr"
    Write-Host "  - C:\Program Files\Java\*"
    Write-Host '  - C:\Users\<用户名>\.jdks\*'
    Write-Host ""
    Write-Host "解决方法：" -ForegroundColor Yellow
    Write-Host "  1. 安装 JDK 21 (推荐 Temurin): https://adoptium.net/"
    Write-Host "  2. 或将 JDK 解压到项目根目录，命名为 jdk"
    Write-Host '  3. 或设置环境变量: setx JAVA_HOME "<JDK路径>"'
    exit 1
}

$env:JAVA_HOME = $jdkHome
$env:PATH = "$jdkHome\bin;" + $env:PATH
Write-OK "JDK: $jdkHome"
$javacVer = & "$jdkHome\bin\javac.exe" -version 2>&1 | Out-String
Write-Detail "javac 版本: $($javacVer.Trim())"

# ---------- 步骤 3：探测 Android SDK ----------
Write-Step "步骤 3/4：探测 Android SDK 环境"

$sdkHome = Find-AndroidSdk
if (-not $sdkHome) {
    Write-Err "未找到 Android SDK"
    Write-Host ""
    Write-Host "已尝试以下位置：" -ForegroundColor Yellow
    Write-Host "  - ANDROID_HOME / ANDROID_SDK_ROOT 环境变量"
    Write-Host "  - android/local.properties"
    Write-Host "  - D:\Android\Sdk, D:\AndroidStudio\Sdk"
    Write-Host '  - C:\Users\<用户名>\AppData\Local\Android\Sdk'
    Write-Host ""
    Write-Host "解决方法：" -ForegroundColor Yellow
    Write-Host "  1. 安装 Android Studio (含 SDK): https://developer.android.com/studio"
    Write-Host '  2. 或设置环境变量: setx ANDROID_HOME "<SDK路径>"'
    exit 1
}

$env:ANDROID_HOME = $sdkHome
$env:ANDROID_SDK_ROOT = $sdkHome
$env:PATH = "$sdkHome\platform-tools;$sdkHome\cmdline-tools\latest\bin;" + $env:PATH
Write-OK "Android SDK: $sdkHome"

# 写入 local.properties（确保 Gradle 能找到 SDK）
$localProps = Join-Path $AndroidDir "local.properties"
$sdkPathEscaped = $sdkHome -replace '\\', '\\'
"sdk.dir=$sdkPathEscaped" | Out-File -FilePath $localProps -Encoding ASCII -Force
Write-Detail "已写入 $localProps"

# ---------- 步骤 4：打包 release APK ----------
Write-Step "步骤 4/4：打包 release APK（内嵌 JS bundle）"

$gradlew = Join-Path $AndroidDir "gradlew.bat"
if (-not (Test-Path $gradlew)) {
    Write-Err "未找到 gradlew.bat: $gradlew"
    exit 1
}

Write-Info "开始构建（首次构建需 15-25 分钟，增量构建约 3-8 分钟）..."
Write-Info "构建过程中会自动打包 JS bundle 到 APK，无需 Metro 开发服务器"
Write-Host ""

$startTime = Get-Date

# Gradle 会向 stderr 输出警告（非错误），需要临时放宽错误策略
$prevEAP = $ErrorActionPreference
$ErrorActionPreference = "Continue"
$env:NODE_ENV = "production"

Push-Location $AndroidDir
try {
    & $gradlew assembleRelease --no-daemon 2>&1 | ForEach-Object {
        $line = $_.ToString()
        if ($line -match 'Task |BUILD |FAILED|error:|Error|warning:.*deprecated') {
            Write-Host $line -ForegroundColor Gray
        }
    }
    $exitCode = $LASTEXITCODE
} finally {
    Pop-Location
    $ErrorActionPreference = $prevEAP
}

$elapsed = (Get-Date) - $startTime
$elapsedStr = "{0}m {1}s" -f [int]$elapsed.TotalMinutes, $elapsed.Seconds

# ---------- 结果展示 ----------
Write-Step "打包结果"

if ($exitCode -eq 0) {
    $apkPath = Join-Path $AndroidDir "app\build\outputs\apk\release\app-release.apk"
    if (Test-Path $apkPath) {
        $apkFile = Get-Item $apkPath
        $sizeMB = [math]::Round($apkFile.Length / 1MB, 2)

        Write-OK "打包成功！耗时 $elapsedStr"
        Write-Host ""
        Write-Host "================================================" -ForegroundColor Green
        Write-Host "  APK 文件信息" -ForegroundColor Green
        Write-Host "================================================" -ForegroundColor Green
        Write-Host "  路径: $($apkFile.FullName)" -ForegroundColor White
        Write-Host "  大小: $sizeMB MB" -ForegroundColor White
        Write-Host "  时间: $($apkFile.LastWriteTime)" -ForegroundColor White
        Write-Host "================================================" -ForegroundColor Green
        Write-Host ""
        Write-Info "将上述 APK 文件传到手机安装即可使用"
        Write-Info "此版本已内嵌 JS bundle，无需连接 Metro 开发服务器"

        # 尝试在资源管理器中定位文件
        try {
            explorer.exe /select,$apkPath
        } catch {}
    } else {
        Write-Err "构建成功但未找到 APK 文件: $apkPath"
    }
} else {
    Write-Err "打包失败！退出码: $exitCode，耗时 $elapsedStr"
    Write-Host ""
    Write-Host "常见问题排查：" -ForegroundColor Yellow
    Write-Host "  1. 依赖下载失败 -> 确认网络/代理可用"
    Write-Host "  2. SDK 版本不对 -> 检查 Android SDK Manager 安装 API 36"
    Write-Host "  3. JDK 版本不对 -> 需要 JDK 17+，推荐 JDK 21"
    Write-Host "  4. NDK 缺失     -> 通过 SDK Manager 安装 NDK 27.1.12297006"
    Write-Host ""
    Write-Host "完整构建日志请重新运行并查看控制台输出" -ForegroundColor Gray
    exit $exitCode
}
