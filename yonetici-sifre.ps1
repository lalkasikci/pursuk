$ErrorActionPreference = 'Stop'
if (Test-Path -LiteralPath (Join-Path $PSScriptRoot '.admin-auth.json')) {
    $answer = Read-Host 'Yonetim sifresi degistirilecek. Devam icin EVET yazin'
    if ($answer -cne 'EVET') { exit }
}
$securePassword = Read-Host 'Yonetim sifresini girin (en az 12 karakter, ekranda gorunmez)' -AsSecureString
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
try {
    $OutputEncoding = [Text.UTF8Encoding]::new($false)
    $plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    $plainPassword | & node (Join-Path $PSScriptRoot 'admin-setup.mjs')
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    $plainPassword = $null
    $securePassword.Dispose()
}
