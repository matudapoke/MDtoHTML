# =====================================================
# Convert-MDtoHTML.ps1
# Markdown ファイルを HTML に変換し、既定ブラウザで開く
#
# 使い方:
#   引数なし : ファイル選択ダイアログを表示
#   引数あり : 指定された .md ファイルを変換
# =====================================================

[CmdletBinding()]
param(
	[Parameter(Position = 0, Mandatory = $false)]
	[string]$MarkdownPath
)

$ErrorActionPreference = "Stop"

# -----------------------------------------------------
# ユーティリティ関数
# -----------------------------------------------------

# 致命的エラーを画面に表示して終了
function Show-FatalError {
	param([string]$Message)
	Add-Type -AssemblyName System.Windows.Forms | Out-Null
	[System.Windows.Forms.MessageBox]::Show($Message, "MDtoHTML エラー",
		[System.Windows.Forms.MessageBoxButtons]::OK,
		[System.Windows.Forms.MessageBoxIcon]::Error) | Out-Null
	exit 1
}

# ファイル選択ダイアログを表示
function Select-MarkdownFile {
	Add-Type -AssemblyName System.Windows.Forms | Out-Null
	$dialog = New-Object System.Windows.Forms.OpenFileDialog
	$dialog.Title = "Markdown ファイルを選択"
	$dialog.Filter = "Markdown (*.md;*.markdown)|*.md;*.markdown|すべてのファイル (*.*)|*.*"
	$dialog.Multiselect = $false

	if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
		return $dialog.FileName
	}
	return $null
}

# UTF-8 (BOM なし) でファイルを書き出す
function Write-Utf8NoBom {
	param(
		[string]$Path,
		[string]$Content
	)
	$utf8 = New-Object System.Text.UTF8Encoding($false)
	[System.IO.File]::WriteAllText($Path, $Content, $utf8)
}

# 出力先ディレクトリを取得（存在しなければ作成）
function Get-OutputDirectory {
	$dir = Join-Path $env:TEMP "MDtoHTML"
	if (-not (Test-Path -LiteralPath $dir)) {
		New-Item -ItemType Directory -Path $dir -Force | Out-Null
	}
	return $dir
}

# 古い一時 HTML ファイルを削除する
# ブラウザで閲覧中のファイルを巻き込まないよう、一定時間経過したものだけを対象にする
function Remove-OldOutputFiles {
	param(
		[string]$Directory,
		[int]$RetentionMinutes = 60
	)
	$threshold = (Get-Date).AddMinutes(-$RetentionMinutes)
	try {
		Get-ChildItem -LiteralPath $Directory -Filter "*.html" -File -ErrorAction Stop |
			Where-Object { $_.LastWriteTime -lt $threshold } |
			ForEach-Object {
				try {
					Remove-Item -LiteralPath $_.FullName -Force -ErrorAction Stop
				} catch {
					# 使用中などで削除できないものはスキップ
				}
			}
	} catch {
		# 列挙に失敗しても致命的ではないので無視
	}
}

# 既定ブラウザの実行ファイルパスを取得
# ※ HTML の関連付け（.html）ではなく、http プロトコルの既定ハンドラを使う
function Get-DefaultBrowserPath {
	try {
		# Windows 10/11: ユーザー選択のブラウザは UrlAssociations\http\UserChoice に記録される
		$userChoice = Get-ItemProperty `
			-Path "Registry::HKEY_CURRENT_USER\SOFTWARE\Microsoft\Windows\Shell\Associations\UrlAssociations\http\UserChoice" `
			-Name ProgId -ErrorAction Stop
		$progId = $userChoice.ProgId

		# ProgId から実行コマンドを取得
		$cmdKey = "Registry::HKEY_CLASSES_ROOT\$progId\shell\open\command"
		$cmd = (Get-ItemProperty -Path $cmdKey -ErrorAction Stop).'(default)'

		# 例: "C:\...\vivaldi.exe" --single-argument %1 から exe パスを抽出
		$exe = $null
		if ($cmd -match '^\s*"([^"]+\.exe)"') {
			$exe = $matches[1]
		} elseif ($cmd -match '^\s*([^\s]+\.exe)') {
			$exe = $matches[1]
		}

		if ($exe -and (Test-Path -LiteralPath $exe -PathType Leaf)) {
			return $exe
		}
	} catch {
		# 失敗時は null を返してフォールバックさせる
	}
	return $null
}

# 生成済み HTML を既定ブラウザで開く
function Open-InDefaultBrowser {
	param([string]$Path)

	$browser = Get-DefaultBrowserPath
	if ($browser) {
		# ブラウザ実行ファイルに直接渡す（.html の関連付けに依存しない）
		Start-Process -FilePath $browser -ArgumentList "`"$Path`"" | Out-Null
		return
	}

	# フォールバック: file:// URL をシェルに渡す（URL ハンドラ＝ブラウザに送られやすい）
	try {
		$uri = ([System.Uri]$Path).AbsoluteUri
		Start-Process -FilePath $uri | Out-Null
		return
	} catch {
		# 最終フォールバック：拡張子の関連付けに任せる
		Start-Process -FilePath $Path | Out-Null
	}
}

# -----------------------------------------------------
# 入力ファイルの決定
# -----------------------------------------------------
# mdtohtml:// プロトコル経由で呼ばれた場合、URL からファイルパスを復元
# 例:
#   "mdtohtml:C%3A%5CUsers%5Cuser%5Csample.md"           → 再生成（reload）
#   "mdtohtml://save/C%3A%5CUsers%5Cuser%5Csample.md"    → クリップボードから保存
# プロトコル経由のときは更新ボタン/保存ボタン由来なので、既存タブが reload する想定で
# 新規ブラウザタブは開かない（古いタブが残らないようにするため）
$invokedViaProtocol = $false
$saveMode = $false
if ($MarkdownPath -match '^(?i)mdtohtml:(?://)?(.+)$') {
	$invokedViaProtocol = $true
	$rest = $matches[1]
	# 保存サブコマンド: "save/<encoded_path>"
	if ($rest -match '^(?i)save/(.+)$') {
		$saveMode = $true
		$encoded = $matches[1].TrimEnd('/')
	} else {
		$encoded = $rest.TrimEnd('/')
	}
	try {
		$MarkdownPath = [System.Uri]::UnescapeDataString($encoded)
	} catch {
		Show-FatalError "URL のデコードに失敗しました:`r`n$MarkdownPath"
	}
}

if ([string]::IsNullOrWhiteSpace($MarkdownPath)) {
	$MarkdownPath = Select-MarkdownFile
	if ([string]::IsNullOrWhiteSpace($MarkdownPath)) {
		# キャンセル時は静かに終了
		exit 0
	}
}

if (-not (Test-Path -LiteralPath $MarkdownPath -PathType Leaf)) {
	Show-FatalError "指定されたファイルが見つかりません:`r`n$MarkdownPath"
}

# -----------------------------------------------------
# 保存モード：クリップボードから内容を読み取り、.md ファイルへ書き戻す
# その後は通常通り HTML を再生成し、呼び出し元タブが reload して反映する
# -----------------------------------------------------
if ($saveMode) {
	try {
		# Get-Clipboard は内部で STA スレッドを起動するため、本体が MTA でも動作する
		$newContent = Get-Clipboard -Raw -ErrorAction Stop
	} catch {
		Show-FatalError "クリップボードからの読み取りに失敗しました:`r`n$($_.Exception.Message)"
	}

	if ($null -eq $newContent) {
		Show-FatalError "クリップボードにテキストがありません。保存を中止しました。"
	}

	# 行末コードを元ファイルに合わせる（CRLF を保持していたファイルを LF に置換しないように）
	try {
		$originalText = [System.IO.File]::ReadAllText($MarkdownPath, [System.Text.Encoding]::UTF8)
		$useCRLF = ($originalText -match "`r`n")
		# 一旦 LF に正規化してから、必要なら CRLF に戻す
		$normalized = $newContent -replace "`r`n", "`n"
		if ($useCRLF) {
			$newContent = $normalized -replace "`n", "`r`n"
		} else {
			$newContent = $normalized
		}
	} catch {
		# 改行統一に失敗しても保存自体は続行する
	}

	try {
		Write-Utf8NoBom -Path $MarkdownPath -Content $newContent
	} catch {
		Show-FatalError "Markdown ファイルへの書き込みに失敗しました:`r`n$($_.Exception.Message)"
	}
}

# -----------------------------------------------------
# テンプレート群の読み込み
# -----------------------------------------------------
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptRoot
$templateDir = Join-Path $projectRoot "templates"

$templatePath = Join-Path $templateDir "template.html"
$stylePath    = Join-Path $templateDir "style.css"
$scriptPath   = Join-Path $templateDir "script.js"

foreach ($p in @($templatePath, $stylePath, $scriptPath)) {
	if (-not (Test-Path -LiteralPath $p -PathType Leaf)) {
		Show-FatalError "テンプレートファイルが見つかりません:`r`n$p"
	}
}

try {
	$templateHtml = [System.IO.File]::ReadAllText($templatePath, [System.Text.Encoding]::UTF8)
	$styleCss     = [System.IO.File]::ReadAllText($stylePath,    [System.Text.Encoding]::UTF8)
	$appJs        = [System.IO.File]::ReadAllText($scriptPath,   [System.Text.Encoding]::UTF8)
	$markdownText = [System.IO.File]::ReadAllText($MarkdownPath, [System.Text.Encoding]::UTF8)
} catch {
	Show-FatalError "ファイル読み込みに失敗しました:`r`n$($_.Exception.Message)"
}

# -----------------------------------------------------
# プレースホルダ置換
# -----------------------------------------------------
$mdFileItem = Get-Item -LiteralPath $MarkdownPath
$title = $mdFileItem.Name

# Markdown 内に </script> が含まれる場合、script タグが破壊されるためエスケープ
$mdEscaped = $markdownText -replace '</script>', '<\/script>'

# style/script 内の同様な競合は通常起きないが、念のためエスケープ
$styleEscaped = $styleCss   -replace '</style>',  '<\/style>'
$scriptEscaped = $appJs     -replace '</script>', '<\/script>'

# 更新ボタン用：md ファイルの絶対パスを HTML 属性として安全な形に整形
# meta タグの content に入れるため HTML エスケープする。JS 側で encodeURIComponent して
# mdtohtml:// プロトコルへ渡されるので、ここでは生のパスを HTML エンコードするだけで良い。
$sourcePathEncoded = [System.Net.WebUtility]::HtmlEncode($mdFileItem.FullName)

# .NET の Replace を使用（PowerShell の -replace は正規表現のため誤爆を避ける）
$html = $templateHtml.Replace('{{TITLE}}',       [System.Net.WebUtility]::HtmlEncode($title))
$html = $html.Replace('{{SOURCE_PATH}}', $sourcePathEncoded)
$html = $html.Replace('{{STYLE}}',       $styleEscaped)
$html = $html.Replace('{{SCRIPT}}',      $scriptEscaped)
$html = $html.Replace('{{MARKDOWN}}',    $mdEscaped)

# -----------------------------------------------------
# 出力先（一時フォルダ）に書き出し
# -----------------------------------------------------
$outDir = Get-OutputDirectory

# 古い出力ファイル（既定: 60 分以上前）を掃除
Remove-OldOutputFiles -Directory $outDir -RetentionMinutes 60

# ファイル名衝突を避けるためハッシュ付加
$hash = [System.BitConverter]::ToString(
	[System.Security.Cryptography.MD5]::Create().ComputeHash(
		[System.Text.Encoding]::UTF8.GetBytes($mdFileItem.FullName)
	)
).Replace("-", "").Substring(0, 8).ToLower()

$safeName = $mdFileItem.BaseName -replace '[\\/:*?"<>|]', '_'
$outFileName = "{0}_{1}.html" -f $safeName, $hash
$outPath = Join-Path $outDir $outFileName

try {
	Write-Utf8NoBom -Path $outPath -Content $html
} catch {
	Show-FatalError "HTML 書き出しに失敗しました:`r`n$($_.Exception.Message)"
}

# -----------------------------------------------------
# 既定ブラウザで開く
# プロトコル経由（更新ボタン）からの呼び出しでは新タブを開かない
# 出力 HTML ファイルは同じパスで上書きされており、呼び出し元タブが reload する
# -----------------------------------------------------
if (-not $invokedViaProtocol) {
	try {
		Open-InDefaultBrowser -Path $outPath
	} catch {
		Show-FatalError "ブラウザ起動に失敗しました:`r`n$($_.Exception.Message)"
	}
}
