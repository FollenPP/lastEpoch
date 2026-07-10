param(
  [int]$Port = 8787,
  [string]$RuleName = "Last Epoch Deck Companion 8787",
  [switch]$SetWifiPrivate
)

$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Error "Run this script from PowerShell as Administrator."
  exit 1
}

if ($SetWifiPrivate) {
  Get-NetConnectionProfile |
    Where-Object { $_.InterfaceAlias -match "Wi-Fi|Wireless|Беспроводная" } |
    Set-NetConnectionProfile -NetworkCategory Private
}

$existing = Get-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue
if ($existing) {
  Set-NetFirewallRule -DisplayName $RuleName -Enabled True -Action Allow -Profile Private,Public
  Get-NetFirewallPortFilter -AssociatedNetFirewallRule $existing |
    Set-NetFirewallPortFilter -Protocol TCP -LocalPort $Port
} else {
  New-NetFirewallRule `
    -DisplayName $RuleName `
    -Direction Inbound `
    -Action Allow `
    -Protocol TCP `
    -LocalPort $Port `
    -Profile Private,Public | Out-Null
}

Write-Host "Opened TCP port $Port for Private/Public networks."
Write-Host "Test from phone or Steam Deck: http://192.168.18.136:$Port/api/health"
