# Liga o envio de e-mails do Prumo: códigos de acesso (login) e comprovantes.
#
# Uso, na pasta do projeto:
#   powershell -ExecutionPolicy Bypass -File scripts\configurar-email.ps1
#   (acrescente -DryRun para só ver o que seria feito)
#
# Precisa de uma conta Gmail com verificação em duas etapas e uma senha de app
# (myaccount.google.com/apppasswords). As senhas são digitadas aqui, vão direto
# para a Supabase e não ficam salvas em nenhum arquivo.
param([switch]$DryRun)
$ErrorActionPreference = 'Stop'

$root = Split-Path $PSScriptRoot -Parent
$ref = 'qvusibdisuvwsfflyazq'
$sb = 'C:\Users\hlyma\tools\supabase-cli\bin\supabase.exe'
if (-not (Test-Path $sb)) {
  $cmd = Get-Command supabase -ErrorAction SilentlyContinue
  if ($cmd) { $sb = $cmd.Source } else { throw 'Supabase CLI não encontrado (supabase.exe).' }
}
$fnEnv = Join-Path $root 'supabase\functions\.env'
$config = Join-Path $root 'supabase\config.toml'
$utf8 = New-Object System.Text.UTF8Encoding($false)

function Plain([Security.SecureString]$s) {
  $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
  try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }
}
function Ask([string]$question, [string]$default) {
  $hint = ''
  if ($default) { $hint = " [$default]" }
  $a = Read-Host "$question$hint"
  if ([string]::IsNullOrWhiteSpace($a)) { return $default }
  return $a.Trim()
}
function Step([string]$text) { Write-Host ''; Write-Host "> $text" -ForegroundColor Cyan }

Write-Host ''
Write-Host 'Prumo · configurar envio de e-mails' -ForegroundColor Cyan
Write-Host 'As senhas digitadas aqui vão direto para a Supabase e não ficam salvas em arquivo.'
if ($DryRun) { Write-Host '(modo de teste: nada será enviado nem alterado)' -ForegroundColor Yellow }

# ------------------------------------------------------------------ dados
$gmail = Ask 'Gmail que vai enviar' 'terminalwolf99@gmail.com'
$gpass = (Plain (Read-Host 'Senha de app do Gmail (16 letras; os espaços não importam)' -AsSecureString)) -replace '\s', ''
if ($gpass.Length -eq 0) { throw 'Senha de app vazia.' }
if ($gpass.Length -ne 16) { Write-Host "Atenção: senhas de app do Google têm 16 letras; esta tem $($gpass.Length)." -ForegroundColor Yellow }

$school = (Ask 'A escola também tem um servidor SMTP para ser o remetente principal? (s/N)' 'n') -match '^[sS]'
if ($school) {
  $shost = Ask 'Servidor SMTP da escola (ex.: smtp.autonomia.com.br)' ''
  $sport = Ask 'Porta (a Supabase só deixa usar a 465)' '465'
  $suser = Ask 'Usuário SMTP da escola' ''
  $spass = Plain (Read-Host 'Senha SMTP da escola' -AsSecureString)
  $sfrom = Ask 'Remetente que aparece para os estudantes' "Prumo · Escola Autonomia <$suser>"
}
$gfrom = "Prumo · Escola Autonomia <$gmail>"

# ------------------------------------------------------------------ 1. comprovantes (Edge Functions)
Step 'Remetente dos comprovantes (funções da Supabase)'
$lines = @()
if ($school) {
  $lines += "SMTP_HOST=$shost", "SMTP_PORT=$sport", "SMTP_USER=$suser", "SMTP_PASS=$spass", "SMTP_FROM=$sfrom"
  $lines += 'SMTP_FALLBACK_HOST=smtp.gmail.com', 'SMTP_FALLBACK_PORT=465', "SMTP_FALLBACK_USER=$gmail", "SMTP_FALLBACK_PASS=$gpass", "SMTP_FALLBACK_FROM=$gfrom"
  Write-Host "Principal: $shost ($suser) · reserva: Gmail ($gmail)"
} else {
  $lines += 'SMTP_HOST=smtp.gmail.com', 'SMTP_PORT=465', "SMTP_USER=$gmail", "SMTP_PASS=$gpass", "SMTP_FROM=$gfrom"
  Write-Host "Principal: Gmail ($gmail)"
}
if (-not $DryRun) {
  $tmp = Join-Path $env:TEMP ("prumo-" + [guid]::NewGuid().ToString() + '.env')
  try {
    [IO.File]::WriteAllText($tmp, ($lines -join "`n") + "`n", $utf8)
    & $sb secrets set --env-file $tmp --project-ref $ref | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Falhou ao gravar os segredos na Supabase.' }
  } finally { Remove-Item $tmp -ErrorAction SilentlyContinue }
  Write-Host 'OK' -ForegroundColor Green
}

# ------------------------------------------------------------------ 2. códigos de acesso (Supabase Auth)
Step 'Remetente dos códigos de acesso (login)'
$text = [IO.File]::ReadAllText($config, $utf8)
$authHost = 'smtp.gmail.com'; $authPort = '465'; $authUser = $gmail; $authPass = $gpass
if ($school) { $authHost = $shost; $authPort = $sport; $authUser = $suser; $authPass = $spass }
$block = [regex]::Match($text, '(?s)#>> email[^\n]*\n(.*?)#<< email')
if ($block.Success) {
  $on = ($block.Groups[1].Value -split "`r?`n" | ForEach-Object { $_ -replace '^#@ ?', '' }) -join "`n"
  # the address is written in plain text (it's not secret) so a later plain
  # `supabase config push` can't overwrite it; only the password stays env-only
  $on = $on -replace 'host = "[^"]*"', "host = `"$authHost`"" -replace 'port = \d+', "port = $authPort"
  $on = $on -replace '(?m)^user = "[^"]*"', "user = `"$authUser`"" -replace '(?m)^admin_email = "[^"]*"', "admin_email = `"$authUser`""
  $text = $text.Substring(0, $block.Index) + "#>> email (ligado por configurar-email.ps1)`n" + $on + '#<< email' + $text.Substring($block.Index + $block.Length)
}
$text = $text -replace '(?m)^email_sent = \d+', 'email_sent = 200'
if ($DryRun) {
  Write-Host "Ligaria [auth.email.smtp] com $authHost`:$authPort ($authUser), o modelo do código e email_sent = 200."
} else {
  [IO.File]::WriteAllText($config, $text, $utf8)
  $env:AUTH_SMTP_USER = $authUser
  $env:AUTH_SMTP_PASS = $authPass
  # The CLI prints progress on stderr; Windows PowerShell would treat that as a
  # fatal error under 'Stop', so relax it just for this call.
  $prevPref = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    Push-Location $root
    $out = ("y`nn`n" | & $sb config push --project-ref $ref 2>&1 | ForEach-Object { "$_" }) -join "`n"
  } finally {
    Pop-Location
    $ErrorActionPreference = $prevPref
    Remove-Item Env:AUTH_SMTP_USER, Env:AUTH_SMTP_PASS -ErrorAction SilentlyContinue
  }
  if ($out -match '_tag.{0,3}Error|unexpected status|failed') {
    Write-Host $out
    throw 'A Supabase não aceitou a configuração de login (veja a mensagem acima).'
  }
  Write-Host 'OK' -ForegroundColor Green
}

# ------------------------------------------------------------------ 3. teste
Step "Mandando um e-mail de teste para $gmail"
if ($DryRun) { Write-Host '(pulado no modo de teste)'; exit 0 }
$secret = ((Get-Content $fnEnv | Where-Object { $_ -match '^MAILER_SECRET=' }) -replace '^MAILER_SECRET=', '').Trim()
$ok = $false
for ($i = 1; $i -le 4 -and -not $ok; $i++) {
  try {
    $r = Invoke-RestMethod -Method Post -Uri "https://$ref.supabase.co/functions/v1/mailer" `
      -Headers @{ 'x-mailer-secret' = $secret } -ContentType 'application/json' -Body (@{ test_to = $gmail } | ConvertTo-Json)
    if ($r.ok) { $ok = $true }
  } catch {
    $msg = $_.ErrorDetails.Message
    if ($msg -notmatch 'smtp_not_configured') { Write-Host "Erro do servidor de e-mail: $msg" -ForegroundColor Red; break }
    Start-Sleep -Seconds 8
  }
}
$gpass = $null; $spass = $null; $authPass = $null
if ($ok) {
  Write-Host 'Funcionou! Confira a caixa de entrada (e o spam).' -ForegroundColor Green
  Write-Host ''
  Write-Host 'Pronto: a partir de agora o login manda um código de 6 dígitos e cada vaga confirmada manda o comprovante.'
  Write-Host 'Teste de verdade: entre no site com um e-mail cadastrado e veja o código chegar.'
} else {
  Write-Host 'O e-mail de teste não saiu. Confira a senha de app e rode o script de novo.' -ForegroundColor Yellow
  exit 1
}
