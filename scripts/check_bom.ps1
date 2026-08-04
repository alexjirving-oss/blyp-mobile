$f = "C:\Users\Alex\Blyp26\android\app\build.gradle"
$b = [System.IO.File]::ReadAllBytes($f)
$hex = ""
for($i=0; $i -lt [Math]::Min(10, $b.Length); $i++){
    $hex += "{0:X2} " -f $b[$i]
}
Write-Output "FIRST_10_BYTES_HEX: $hex"
Write-Output "TOTAL_BYTES: $($b.Length)"

# Check for BOM and fix
if($b[0] -eq 0xFF -and $b[1] -eq 0xFE){
    Write-Output "DETECTED: UTF-16 LE BOM"
    $content = [System.Text.Encoding]::Unicode.GetString($b, 2, $b.Length - 2)
    $utf8 = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($f, $content, $utf8)
    Write-Output "FIXED: Converted to UTF-8 no BOM"
} elseif($b[0] -eq 0xEF -and $b[1] -eq 0xBB -and $b[2] -eq 0xBF){
    Write-Output "DETECTED: UTF-8 BOM"
    $newBytes = New-Object byte[] ($b.Length - 3)
    [Array]::Copy($b, 3, $newBytes, 0, $b.Length - 3)
    [System.IO.File]::WriteAllBytes($f, $newBytes)
    Write-Output "FIXED: Removed UTF-8 BOM"
} else {
    Write-Output "NO_BOM_DETECTED"
}
