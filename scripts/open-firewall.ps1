#Requires -RunAsAdministrator
[CmdletBinding()]
param(
    [int]$Port = 8666,
    [string]$RemoteAddress = "LocalSubnet"
)

$ErrorActionPreference = "Stop"
$name = "Microzup API ($Port)"

if (Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue) {
    Write-Host "Regra de firewall já existe: $name"
    exit 0
}

New-NetFirewallRule `
    -DisplayName $name `
    -Direction Inbound `
    -Protocol TCP `
    -LocalPort $Port `
    -RemoteAddress $RemoteAddress `
    -Action Allow `
    -Profile Any | Out-Null

Write-Host "Regra criada: $name (TCP $Port, origem $RemoteAddress)"
