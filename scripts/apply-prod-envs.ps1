$ErrorActionPreference = "Stop"

function Require-Env([string]$Name) {
  if (-not (Test-Path "Env:$Name")) {
    throw "Missing environment variable: $Name"
  }
}

Write-Host "Applying Supabase + Vercel production environment variables..." -ForegroundColor Cyan

Require-Env "APP_ORIGIN"
Require-Env "ALLOWED_ORIGINS"
Require-Env "ALLOWED_PROXY_HOSTS"
Require-Env "RATE_LIMIT_WINDOW_SEC"
Require-Env "RATE_LIMIT_MAX_REQ"
Require-Env "UPSTASH_REDIS_REST_URL"
Require-Env "UPSTASH_REDIS_REST_TOKEN"

$optionalVars = @("CSP_REPORT_URI")
$requiredVars = @(
  "APP_ORIGIN",
  "ALLOWED_ORIGINS",
  "ALLOWED_PROXY_HOSTS",
  "RATE_LIMIT_WINDOW_SEC",
  "RATE_LIMIT_MAX_REQ",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN"
)

# Supabase secrets (project linked via supabase/config.toml or SUPABASE_PROJECT_REF).
Write-Host "Setting Supabase function secrets..." -ForegroundColor Yellow
$supabaseArgs = @("supabase", "secrets", "set")
foreach ($k in $requiredVars) {
  $supabaseArgs += "$k=$($env:$k)"
}
foreach ($k in $optionalVars) {
  if (Test-Path "Env:$k" -and $env:$k) {
    $supabaseArgs += "$k=$($env:$k)"
  }
}
npx @supabaseArgs

# Vercel project env (requires linked project or VERCEL_* envs).
Write-Host "Setting Vercel project env vars..." -ForegroundColor Yellow
foreach ($k in $requiredVars + $optionalVars) {
  if (Test-Path "Env:$k" -and $env:$k) {
    $value = $env:$k
    $value | npx vercel env add $k production --yes
  }
}

Write-Host "Done." -ForegroundColor Green

