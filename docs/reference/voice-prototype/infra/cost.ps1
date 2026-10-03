[CmdletBinding()]
param(
    [string]$Subscription = "0ac7d719-89bc-4100-be87-a79d33e953a7",
    [string]$ResourceGroup = "rg-jarvis-voice-poc",
    [string]$From = "2026-10-02",
    [string]$To = (Get-Date).ToUniversalTime().ToString("yyyy-MM-dd")
)
# Actual billed cost per meter for the voice prototype. Works after teardown too.
# Cost Management data lags 8-24 hours.
$ErrorActionPreference = "Stop"
$body = @{
    type = "ActualCost"; timeframe = "Custom"; timePeriod = @{ from = "$($From)T00:00:00Z"; to = "$($To)T23:59:59Z" }
    dataset = @{
        granularity = "None"; aggregation = @{ totalCost = @{ name = "Cost"; function = "Sum" } }
        grouping = @(@{ type = "Dimension"; name = "MeterSubCategory" }, @{ type = "Dimension"; name = "Meter" })
        filter = @{ dimensions = @{ name = "ResourceGroupName"; operator = "In"; values = @($ResourceGroup) } }
    }
} | ConvertTo-Json -Depth 10 -Compress
$path = Join-Path $env:TEMP ("jarvis-voice-cost-" + [Guid]::NewGuid().ToString("N") + ".json")
$body | Set-Content -LiteralPath $path -Encoding utf8
try {
    $result = az rest --method post --subscription $Subscription --body "@$path" `
        --url "https://management.azure.com/subscriptions/$Subscription/providers/Microsoft.CostManagement/query?api-version=2023-11-01" | ConvertFrom-Json
} finally { Remove-Item -LiteralPath $path -Force }
$rows = @($result.properties.rows)
if (-not $rows) { Write-Host "No cost data yet for $ResourceGroup ($From to $To)."; return }
$rows | Sort-Object { [double]$_[0] } -Descending | ForEach-Object { "{0,10:N2} {1}  {2} / {3}" -f [double]$_[0], $_[3], $_[1], $_[2] }
"{0,10:N2} total" -f (($rows | ForEach-Object { [double]$_[0] }) | Measure-Object -Sum).Sum
