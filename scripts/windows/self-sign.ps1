param(
    [Parameter(Mandatory)][ValidateSet('sign', 'verify')][string]$Mode,
    [Parameter(Mandatory)][string]$Installer,
    [string]$ExpectedCertificateSha256
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if (-not $IsWindows) { throw 'Windows native signing/verification requires Windows' }
Add-Type -AssemblyName System.Security.Cryptography.Pkcs
Add-Type -Path (Join-Path $PSScriptRoot 'AuthenticodeIntegrity.cs')

function Read-EmbeddedSignature([string]$Path) {
    $bytes = [IO.File]::ReadAllBytes($Path)
    if ($bytes.Length -lt 256) { throw 'Invalid PE' }
    $pe = [BitConverter]::ToInt32($bytes, 0x3c)
    if ($pe -lt 0 -or $pe + 24 -gt $bytes.Length -or [BitConverter]::ToUInt32($bytes, $pe) -ne 0x4550) { throw 'Invalid PE header' }
    $optional = $pe + 24
    $magic = [BitConverter]::ToUInt16($bytes, $optional)
    if ($magic -eq 0x20b) { $directory = $optional + 112 } elseif ($magic -eq 0x10b) { $directory = $optional + 96 } else { throw 'Invalid PE optional header' }
    $security = $directory + 4 * 8
    $offset = [BitConverter]::ToUInt32($bytes, $security)
    $size = [BitConverter]::ToUInt32($bytes, $security + 4)
    if ($offset -eq 0 -or $size -lt 8 -or [long]$offset + $size -gt $bytes.Length) { throw 'Missing or invalid certificate table' }
    $length = [BitConverter]::ToUInt32($bytes, $offset)
    if ($length -lt 8 -or $length -gt $size -or [BitConverter]::ToUInt16($bytes, $offset + 4) -ne 0x200 -or [BitConverter]::ToUInt16($bytes, $offset + 6) -ne 2) { throw 'Invalid WIN_CERTIFICATE' }
    $cms = [System.Security.Cryptography.Pkcs.SignedCms]::new()
    $cms.Decode([byte[]]$bytes[($offset + 8)..($offset + $length - 1)])
    if ($cms.ContentInfo.ContentType.Value -ne '1.3.6.1.4.1.311.2.1.4' -or $cms.SignerInfos.Count -ne 1) { throw 'Unexpected Authenticode content/signer count' }
    # Cryptographic CMS verification does not assert publisher trust.
    $cms.CheckSignature($true)
    if (-not [FolioAuthenticodeIntegrity]::VerifyFileDigest($Path, $cms.ContentInfo.Content)) { throw 'Authenticode PE content digest mismatch' }
    return $cms
}
function Assert-SelfSignature([string]$Path, [string]$ExpectedFingerprint) {
    $cms = Read-EmbeddedSignature $Path
    $cert = $cms.SignerInfos[0].Certificate
    if ($null -eq $cert -or $cert.Subject -ne $cert.Issuer -or $cert.Subject -notlike 'CN=Folio temporary build *') { throw 'Expected temporary self-signed build certificate' }
    $fingerprint = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($cert.RawData)).ToLowerInvariant()
    if ($ExpectedFingerprint -and $fingerprint -cne $ExpectedFingerprint) { throw 'Installer certificate fingerprint mismatch' }
    $eku = @($cert.Extensions | Where-Object { $_.Oid.Value -eq '2.5.29.37' })
    if ($eku.Count -ne 1 -or -not ($eku[0].EnhancedKeyUsages | Where-Object Value -EQ '1.3.6.1.5.5.7.3.3')) { throw 'Missing code-signing EKU' }
    $status = Get-AuthenticodeSignature -LiteralPath $Path
    # NotTrusted is a limitation, never our proof of content integrity.
    if ($status.Status.ToString() -ne 'NotTrusted') { throw 'Expected untrusted publisher; no trust store may be changed' }
    return @{ signing = 'self-signed'; notarized = $false; certificateSha256 = $fingerprint;
        integrity = 'passed'; publisherTrust = 'not-trusted'; privateKeyPersisted = $false }
}

$certificate = $null
$rsa = $null
try {
    if ($Mode -eq 'sign') {
        # In-memory RSA and CertificateRequest only. No store import, key container,
        # PFX/PEM export, timestamp credentials, or persistent key is created.
        $rsa = [Security.Cryptography.RSA]::Create(3072)
        $request = [Security.Cryptography.X509Certificates.CertificateRequest]::new(
            "CN=Folio temporary build $([Guid]::NewGuid())", $rsa,
            [Security.Cryptography.HashAlgorithmName]::SHA256, [Security.Cryptography.RSASignaturePadding]::Pkcs1)
        $oids = [Security.Cryptography.OidCollection]::new()
        [void]$oids.Add([Security.Cryptography.Oid]::new('1.3.6.1.5.5.7.3.3'))
        $request.CertificateExtensions.Add([Security.Cryptography.X509Certificates.X509EnhancedKeyUsageExtension]::new($oids, $true))
        $request.CertificateExtensions.Add([Security.Cryptography.X509Certificates.X509KeyUsageExtension]::new([Security.Cryptography.X509Certificates.X509KeyUsageFlags]::DigitalSignature, $true))
        $request.CertificateExtensions.Add([Security.Cryptography.X509Certificates.X509BasicConstraintsExtension]::new($false, $false, 0, $true))
        $certificate = $request.CreateSelfSigned([DateTimeOffset]::UtcNow.AddMinutes(-5), [DateTimeOffset]::UtcNow.AddYears(1))
        $key = [Security.Cryptography.X509Certificates.RSACertificateExtensions]::GetRSAPrivateKey($certificate)
        try { if ($key -isnot [Security.Cryptography.RSACng] -or -not $key.Key.IsEphemeral) { throw 'Signing key must remain ephemeral' } }
        finally { if ($key) { $key.Dispose() } }
        $result = Set-AuthenticodeSignature -LiteralPath $Installer -Certificate $certificate -HashAlgorithm SHA256 -IncludeChain Signer
        # Native signing returning an object alone is not success; verify the output.
        $ExpectedCertificateSha256 = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($certificate.RawData)).ToLowerInvariant()
    }
    $report = Assert-SelfSignature $Installer $ExpectedCertificateSha256
    if ($Mode -eq 'sign') {
        # Tamper a temporary copy's section bytes to exercise the native digest boundary.
        $dir = Join-Path ([IO.Path]::GetTempPath()) ([Guid]::NewGuid().ToString())
        [void][IO.Directory]::CreateDirectory($dir)
        try {
            $tampered = Join-Path $dir 'tampered.exe'
            $bytes = [IO.File]::ReadAllBytes($Installer)
            $pe = [BitConverter]::ToInt32($bytes, 0x3c)
            $sectionTable = $pe + 24 + [BitConverter]::ToUInt16($bytes, $pe + 20)
            $raw = [BitConverter]::ToUInt32($bytes, $sectionTable + 20)
            $bytes[$raw + 16] = $bytes[$raw + 16] -bxor 1
            [IO.File]::WriteAllBytes($tampered, $bytes)
            $rejected = $false
            try { [void](Read-EmbeddedSignature $tampered) } catch { $rejected = $true }
            if (-not $rejected) { throw 'Tampered installer was accepted' }
            $report.tamperRejected = $true
        } finally { [IO.Directory]::Delete($dir, $true) }
    }
    $report | ConvertTo-Json -Compress
} finally {
    if ($certificate) { $certificate.Dispose() }
    if ($rsa) { $rsa.Dispose() }
}
