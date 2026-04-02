$ErrorActionPreference = "Stop"

function New-RandomHex([int]$Bytes = 32) {
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  $buffer = New-Object byte[] $Bytes
  $rng.GetBytes($buffer)
  -join ($buffer | ForEach-Object { $_.ToString("x2") })
}

function New-RandomBase64Url([int]$Bytes = 48) {
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  $buffer = New-Object byte[] $Bytes
  $rng.GetBytes($buffer)
  [Convert]::ToBase64String($buffer).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

Write-Host "Suggested rotation values (generate/use in provider dashboards):" -ForegroundColor Cyan
Write-Host "JWT_SECRET=$([string](New-RandomBase64Url 64))"
Write-Host "PYTHON_INTERNAL_API_TOKEN=$([string](New-RandomHex 32))"
Write-Host "DELPHI_AUTH_BEARER=$([string](New-RandomBase64Url 48))"
Write-Host "OPENAI_API_KEY=<rotate in OpenAI dashboard>"
Write-Host "GEMINI_API_KEY=<rotate in Google AI dashboard>"
Write-Host "SUPABASE_SERVICE_ROLE_KEY=<rotate in Supabase dashboard>"
Write-Host "SUPABASE_ANON_KEY=<rotate in Supabase dashboard if required>"

