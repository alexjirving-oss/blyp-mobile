Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
throw 'RELEASE_PATH_BLOCKED: Post-hoc AAB finalization is forbidden. Use tools\\release\\BUILD_RELEASE_CANDIDATE.ps1 -ExpectedVersionCode <value> so proof and frozen artifact are created in one canonical run.'
