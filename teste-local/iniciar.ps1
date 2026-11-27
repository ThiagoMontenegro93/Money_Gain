param([switch]$ConfigurarEmail)
# LendControl Pro - inicia o servidor local (Docker) e mostra o endereço para o app do celular.
# 'Continue': no Windows PowerShell 5.1, stderr de programas (docker) com 'Stop' vira erro fatal
$ErrorActionPreference = 'Continue'
Set-Location -Path $PSScriptRoot
$EnvFile = Join-Path $PSScriptRoot '.env.local'

function Write-Passo($t) { Write-Host ''; Write-Host "==> $t" -ForegroundColor Cyan }
function Write-Ok($t) { Write-Host "    $t" -ForegroundColor Green }
function Write-Aviso($t) { Write-Host "    $t" -ForegroundColor Yellow }
function Sair($t) { Write-Host ''; Write-Host "ERRO: $t" -ForegroundColor Red; exit 1 }

function New-Segredo { -join ((1..32) | ForEach-Object { '{0:x2}' -f (Get-Random -Minimum 0 -Maximum 256) }) }

function Read-Env {
  $h = [ordered]@{}
  if (Test-Path $EnvFile) {
    foreach ($l in Get-Content $EnvFile -Encoding UTF8) {
      if ($l -match "^\s*([A-Z_]+)='(.*)'\s*$") { $h[$Matches[1]] = $Matches[2] }
      elseif ($l -match '^\s*([A-Z_]+)=(.*)$') { $h[$Matches[1]] = $Matches[2] }
    }
  }
  return $h
}

function Save-Env($h) {
  $linhas = @('# Gerado pelo INICIAR.bat - NAO compartilhe este arquivo (tem as chaves do sistema).')
  # aspas simples: o docker compose não interpreta $ nem # dentro delas
  foreach ($k in $h.Keys) { $linhas += "$k='$($h[$k])'" }
  # UTF-8 sem BOM (o docker compose não aceita BOM)
  [System.IO.File]::WriteAllLines($EnvFile, $linhas, (New-Object System.Text.UTF8Encoding($false)))
}

function Read-Senha($prompt) {
  $s = Read-Host -Prompt $prompt -AsSecureString
  return [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))
}

function Set-Email($h) {
  Write-Passo 'Backup em planilha por e-mail (Gmail)'
  Write-Host '    O sistema envia a planilha de backup pelo SEU Gmail. Precisa de uma "senha de app" do Google:'
  Write-Host '    1) Ative a verificação em duas etapas na sua conta Google'
  Write-Host '    2) Abra https://myaccount.google.com/apppasswords , crie uma senha (nome: LendControl)'
  Write-Host '    3) Copie a senha de 16 letras e cole aqui (os espaços podem ficar)'
  Write-Host '    (deixe o e-mail em branco para pular)'
  $gmail = (Read-Host -Prompt '    Seu Gmail (ex.: voce@gmail.com)').Trim()
  if (-not $gmail) { Write-Aviso 'E-mail não configurado (dá para configurar depois com CONFIGURAR-EMAIL.bat).'; return $h }
  if ($gmail -notmatch '^[^@\s]+@[^@\s]+\.[^@\s]+$') { Write-Aviso 'E-mail inválido; pulando.'; return $h }
  $app = (Read-Senha '    Senha de app (16 letras)') -replace '\s', ''
  if ($app.Length -lt 16) { Write-Aviso 'Senha de app deve ter 16 letras; pulando.'; return $h }
  $user = [Uri]::EscapeDataString($gmail)
  $pass = [Uri]::EscapeDataString($app)
  $h['SMTP_URL'] = "smtps://${user}:${pass}@smtp.gmail.com:465"
  $h['SMTP_FROM'] = "LendControl <$gmail>"
  Write-Ok 'E-mail do backup configurado.'
  return $h
}

function Get-IpLocal {
  try {
    $ips = Get-NetIPConfiguration -ErrorAction Stop |
      Where-Object { $_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq 'Up' } |
      ForEach-Object { $_.IPv4Address.IPAddress }
    if ($ips) { return @($ips) }
  } catch { }
  return @([System.Net.Dns]::GetHostAddresses([System.Net.Dns]::GetHostName()) |
    Where-Object { $_.AddressFamily -eq 'InterNetwork' -and $_.ToString() -notlike '127.*' -and $_.ToString() -notlike '169.254.*' } |
    ForEach-Object { $_.ToString() })
}

Write-Host '============================================' -ForegroundColor Cyan
Write-Host '   LendControl Pro - servidor local (teste)' -ForegroundColor Cyan
Write-Host '============================================' -ForegroundColor Cyan

# 1) Docker
Write-Passo 'Verificando o Docker Desktop'
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Sair 'Docker Desktop não encontrado. Instale em https://www.docker.com/products/docker-desktop/ , abra o Docker Desktop e rode este arquivo de novo.'
}
$ok = $false
for ($i = 0; $i -lt 30; $i++) {
  docker info *> $null
  if ($LASTEXITCODE -eq 0) { $ok = $true; break }
  if ($i -eq 0) {
    Write-Aviso 'O Docker Desktop não está aberto. Tentando abrir...'
    $dd = Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'
    if (Test-Path $dd) { Start-Process $dd }
  }
  Start-Sleep -Seconds 5
}
if (-not $ok) { Sair 'O Docker Desktop não respondeu. Abra o Docker Desktop, espere aparecer "Engine running" e rode de novo.' }
Write-Ok 'Docker funcionando.'

# 2) Configuração (primeira vez)
$cfg = Read-Env
if ($ConfigurarEmail) {
  if (-not $cfg.Contains('JWT_SECRET')) { Sair 'Rode primeiro o INICIAR.bat.' }
  $cfg = Set-Email $cfg
  Save-Env $cfg
  Write-Passo 'Reiniciando o sistema com o novo e-mail'
  docker compose --env-file .env.local up -d
  Write-Ok 'Pronto. No sistema: Configurações > Backup > informe o e-mail de destino > "Testar envio agora".'
  exit 0
}

if (-not $cfg.Contains('JWT_SECRET')) {
  Write-Passo 'Primeira vez: criando o acesso do dono'
  $nome = ((Read-Host -Prompt '    Seu nome').Trim()) -replace "'", ''
  if (-not $nome) { $nome = 'Dono' }
  do { $email = (Read-Host -Prompt '    Seu e-mail de login').Trim().ToLower() } until ($email -match '^[^@\s]+@[^@\s]+\.[^@\s]+$')
  do {
    $senha = Read-Senha '    Crie uma senha (mínimo 8 caracteres)'
    if ($senha.Length -lt 8) { Write-Aviso 'Senha curta demais.' }
    elseif ($senha.Contains("'")) { Write-Aviso 'Não use aspas simples na senha.'; $senha = '' }
  } until ($senha.Length -ge 8)
  $cfg['OWNER_NAME'] = $nome
  $cfg['OWNER_EMAIL'] = $email
  $cfg['OWNER_PASSWORD'] = $senha
  $cfg['POSTGRES_PASSWORD'] = New-Segredo
  $cfg['JWT_SECRET'] = New-Segredo
  $cfg['ENCRYPTION_KEY'] = New-Segredo
  $cfg['FILE_SIGNING_SECRET'] = New-Segredo
  $cfg = Set-Email $cfg
  Save-Env $cfg
  Write-Ok "Configuração salva em teste-local\.env.local (guarde uma cópia: a ENCRYPTION_KEY protege os CPFs)."
}

# 3) Firewall (uma vez, pede permissão de administrador)
Write-Passo 'Liberando a porta 3000 no Firewall do Windows (para o celular acessar)'
$regra = Get-NetFirewallRule -DisplayName 'LendControl 3000' -ErrorAction SilentlyContinue
if ($regra) { Write-Ok 'Já liberada.' }
else {
  try {
    Start-Process powershell -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList '-NoProfile', '-Command',
      "New-NetFirewallRule -DisplayName 'LendControl 3000' -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow -Profile Private,Domain | Out-Null"
    if (Get-NetFirewallRule -DisplayName 'LendControl 3000' -ErrorAction SilentlyContinue) { Write-Ok 'Porta liberada.' }
    else { Write-Aviso 'Não consegui liberar. Se o celular não conectar, veja o LEIA-ME (Firewall).' }
  } catch { Write-Aviso 'Permissão negada. Se o celular não conectar, veja o LEIA-ME (Firewall).' }
}

# 4) Subir
Write-Passo 'Iniciando o LendControl (a primeira vez demora 5 a 15 minutos para montar)'
docker compose --env-file .env.local up -d --build
if ($LASTEXITCODE -ne 0) { Sair 'Falha ao iniciar. Veja as mensagens acima (internet? espaço em disco?).' }

Write-Passo 'Aguardando o sistema responder'
$pronto = $false
for ($i = 0; $i -lt 90; $i++) {
  try {
    $r = Invoke-RestMethod -Uri 'http://localhost:3000/api/health' -TimeoutSec 3
    if ($r.status) { $pronto = $true; break }
  } catch { }
  Start-Sleep -Seconds 2
}
if (-not $pronto) { Sair 'O sistema não respondeu em 3 minutos. Veja os detalhes com: docker compose --env-file .env.local logs app' }

$ips = Get-IpLocal
Write-Host ''
Write-Host '============================================' -ForegroundColor Green
Write-Host '   LENDCONTROL NO AR' -ForegroundColor Green
Write-Host '============================================' -ForegroundColor Green
Write-Host '  No computador:  http://localhost:3000'
Write-Host '  No app do celular (mesmo Wi-Fi), em "Endereço do servidor" digite:'
foreach ($ip in $ips) { Write-Host "      ${ip}:3000" -ForegroundColor Yellow }
Write-Host "  Login: $($cfg['OWNER_EMAIL']) e a senha que você criou."
if (-not $cfg['SMTP_URL']) { Write-Host '  Backup por e-mail: ainda não configurado (use CONFIGURAR-EMAIL.bat).' }
Write-Host '  Para desligar: PARAR.bat (os dados ficam guardados).'
Write-Host ''
Start-Process 'http://localhost:3000'
