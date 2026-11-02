$ErrorActionPreference = 'Stop'
$targetPath = Join-Path $PSScriptRoot '.env.local'
if (Test-Path -LiteralPath $targetPath) {
    $answer = Read-Host 'Kayitli yerel ayarlar degistirilecek. Devam etmek icin EVET yazin'
    if ($answer -cne 'EVET') { exit }
}
$secureKey = Read-Host 'Claude API anahtarinizi yapistirip Enter tusuna basin (ekranda gorunmez)' -AsSecureString
$keyPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
try {
    $plainKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($keyPointer)
    $plainKey = $plainKey.Trim().Trim([char[]]@(34, 39)).Trim()
    if ($plainKey.Length -lt 16 -or $plainKey.Length -gt 2048 -or $plainKey -match '[\s\x00-\x1F\x7F"'']') {
        Write-Host 'Giris kaydedilmedi: yalnizca API anahtarini yapistirin; adres, degisken adi veya arada bosluk olmamali.'
        exit 1
    }
    $envContent = 'ANTHROPIC_API_KEY=' + $plainKey + "`nANTHROPIC_MODEL=claude-sonnet-4-6`nPORT=4317`n"
    [IO.File]::WriteAllText($targetPath, $envContent, [Text.UTF8Encoding]::new($false))
    Write-Host 'Anahtar kaydedildi. Gecerliligi ilk mesajda Claude tarafindan kontrol edilecek.'
    Write-Host 'Dosyayi paylasmayin. Sunucuyu kapatip baslat.cmd ile yeniden acin.'
} catch {
    Write-Host 'Anahtar kaydedilemedi. Klasorun yazilabilir oldugunu kontrol edip tekrar deneyin.'
    exit 1
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($keyPointer)
    $plainKey = $null
    $envContent = $null
    $secureKey.Dispose()
}
