param(
  [Parameter(Mandatory = $true)][string]$FromTag,
  [Parameter(Mandatory = $true)][string]$CandidateTag,
  [Parameter(Mandatory = $true)][string]$CandidateSha
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
# Never install an acceptance package on a developer's workstation.
if (-not $IsWindows -or $env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted') {
  throw 'This installer journey may run only on a disposable GitHub-hosted Windows runner.'
}
$tagPattern = '^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$'
if ($FromTag -notmatch $tagPattern -or $CandidateTag -notmatch $tagPattern -or
    $CandidateSha -notmatch '^[a-f0-9]{40}$' -or [version]$FromTag.Substring(1) -ge [version]$CandidateTag.Substring(1)) {
  throw 'Require increasing stable tags and an exact lower-case candidate commit SHA.'
}
$repository = 'yuchen0x1/Novel-Writer-master'
$root = Split-Path -Parent $PSScriptRoot
$evidenceRoot = Join-Path $env:RUNNER_TEMP 'ai-novel-candidate-upgrade-evidence'
New-Item -ItemType Directory -Path $evidenceRoot -Force | Out-Null
$journeyRoot = Join-Path $env:RUNNER_TEMP ('ai-novel-candidate-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $journeyRoot | Out-Null
$installRoot = Join-Path $journeyRoot 'installed-app'
$downloads = Join-Path $journeyRoot 'downloads'
New-Item -ItemType Directory -Path $downloads | Out-Null
$record = [ordered]@{
  schemaVersion = 1; kind = 'candidate-installer-upgrade-manual-rollback'; accepted = $false
  repository = $repository; fromTag = $FromTag; candidateTag = $CandidateTag; candidateSha = $CandidateSha
  harnessSha = ''; githubRunId = $env:GITHUB_RUN_ID; githubRunAttempt = $env:GITHUB_RUN_ATTEMPT
  scope = @('real NSIS installer replacement', 'installed package and executable version', 'ordinary workbench and settings startup', 'synthetic global author files and selected config fields in one persistent canonical generation')
  exclusions = @('in-app update discovery/download/apply', 'all SQLite project contents and schema downgrade compatibility', 'real user data', 'automatic binary rollback', 'code-signing trust qualification')
  assets = @(); stages = @()
}
function Save-JourneyRecord {
  [System.IO.File]::WriteAllText((Join-Path $evidenceRoot 'journey.json'), (($record | ConvertTo-Json -Depth 15) + "`n"), [System.Text.UTF8Encoding]::new($false))
}
function Read-GithubJson([string]$Endpoint) {
  $response = & gh api "repos/$repository/$Endpoint"
  if ($LASTEXITCODE -ne 0) { throw "GitHub API failed for $Endpoint" }
  return ($response | ConvertFrom-Json)
}
function Get-VerifiedInstaller([string]$Tag, [switch]$PublishedSource) {
  # The /releases/tags endpoint can return 404 for a draft. Enumerate every page
  # and select by exact tag; never silently substitute the public latest release.
  $releasePages = & gh api --paginate --slurp "repos/$repository/releases?per_page=100"
  if ($LASTEXITCODE -ne 0) { throw 'Cannot enumerate visible release metadata.' }
  $matchingReleases = @($releasePages | ConvertFrom-Json | ForEach-Object { $_ } | Where-Object { $_.tag_name -ceq $Tag })
  if ($matchingReleases.Count -ne 1) { throw "Expected exactly one visible release: $Tag" }
  $release = $matchingReleases[0]
  if ($release.tag_name -cne $Tag -or $release.prerelease -or ($PublishedSource -and $release.draft)) {
    throw "Release channel does not meet the requested role: $Tag"
  }
  $tagCommit = Read-GithubJson "commits/$Tag"
  $localCommit = & git -C $root rev-parse "refs/tags/$Tag`^{commit}"
  if ($LASTEXITCODE -ne 0 -or $tagCommit.sha -cne $localCommit) { throw "Local and GitHub tag commits differ: $Tag" }
  if ($Tag -ceq $CandidateTag -and $tagCommit.sha -cne $CandidateSha) { throw 'Candidate tag does not resolve to the expected commit.' }
  $name = "Novel-Writer-master-setup-$($Tag.Substring(1)).exe"
  $matchingAssets = @($release.assets | Where-Object { $_.name -ceq $name })
  if ($matchingAssets.Count -ne 1) { throw "Expected exactly one installer: $name" }
  $asset = $matchingAssets[0]
  $expectedUrl = "https://github.com/$repository/releases/download/$Tag/$name"
  $draftUrlPattern = '^https://github\.com/' + [regex]::Escape($repository) + '/releases/download/untagged-[a-f0-9]+/' + [regex]::Escape($name) + '$'
  $urlAccepted = $asset.browser_download_url -ceq $expectedUrl
  if ($release.draft -and -not $PublishedSource -and $asset.browser_download_url -cmatch $draftUrlPattern) { $urlAccepted = $true }
  if ($asset.digest -notmatch '^sha256:[a-f0-9]{64}$' -or $asset.size -le 0 -or $asset.state -cne 'uploaded' -or -not $urlAccepted) {
    throw "Invalid asset digest, size, state or URL: $name"
  }
  & gh release download $Tag --repo $repository --pattern $name --dir $downloads
  if ($LASTEXITCODE -ne 0) { throw "Installer download failed: $Tag" }
  $file = Join-Path $downloads $name
  $sha256 = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()
  if ((Get-Item -LiteralPath $file).Length -ne $asset.size -or "sha256:$sha256" -cne $asset.digest) {
    throw "Downloaded installer differs from GitHub asset metadata: $name"
  }
  $after = Read-GithubJson "releases/assets/$($asset.id)"
  if ($after.name -cne $name -or $after.digest -cne $asset.digest -or $after.size -ne $asset.size) { throw 'Asset metadata changed during download.' }
  $record.assets += [ordered]@{ tag = $Tag; commit = $tagCommit.sha; releaseId = $release.id; draft = $release.draft; assetId = $asset.id; name = $name; size = $asset.size; sha256 = $sha256 }
  Save-JourneyRecord
  return $file
}
function Install-Stage([string]$Name, [string]$Installer, [string]$Version) {
  # /D must be the final NSIS parameter, with no added quotes around its value.
  $started = [DateTime]::UtcNow
  $process = Start-Process -FilePath $Installer -ArgumentList "/S /D=$installRoot" -Wait -PassThru
  try { $exitCode = $process.ExitCode } finally { $process.Dispose() }
  if ($exitCode -ne 0) { throw "Installer failed in stage $Name with exit code $exitCode" }
  $exe = Join-Path $installRoot 'Novel-Writer-master.exe'
  if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) { throw "Installed executable is missing in stage $Name" }
  $stageReceipt = Join-Path $evidenceRoot "$Name.json"
  # Reuse the existing ordinary-startup assertions while keeping the SAME data roots
  # across all three launches (the generic smoke harness creates a new root each time).
  $nodeSource = @'
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { _electron as electron } from 'playwright';
const [repo, exe, journey, evidence, stage, expectedVersion] = process.argv.slice(2);
const { verifyOrdinaryStartup } = await import(pathToFileURL(path.join(repo, 'scripts/installed-startup-acceptance.mjs')).href);
const legacy = path.join(journey, 'legacy-source'), canonical = path.join(journey, 'canonical'), userData = path.join(journey, 'chromium-profile');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const fixtureFiles = { 'prompts/upgrade-author.txt': 'Synthetic author prompt: preserve the copper key.\n', 'skills/upgrade-author.md': '# Synthetic author skill\nKeep the harbour timeline.\n' };
const fixtureConfig = { theme: 'light', locale: 'en-US', proxy: { enabled: false, type: 'http', host: '', port: 17890 } };
const json = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value, { flag: 'wx' }); };
if (stage === 'source') {
  for (const [name, body] of Object.entries(fixtureFiles)) write(path.join(legacy, name), body);
  write(path.join(legacy, 'config.json'), JSON.stringify(fixtureConfig));
  write(path.join(legacy, 'models.json'), '[]');
  write(path.join(legacy, 'recent-projects.json'), '[]');
}
const result = { schemaVersion: 1, kind: 'installed-candidate-stage', stage, expectedVersion, accepted: false };
let app;
try {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^AI_NOVEL_|^ELECTRON_RUN_AS_NODE$|^VITE_DEV_SERVER_URL$|^(?:GH|GITHUB)_TOKEN$/.test(key)) delete env[key];
  Object.assign(env, { AI_NOVEL_APP_DATA_HOME: canonical, AI_NOVEL_LEGACY_SOURCE_HOME: legacy, AI_NOVEL_VELA_HOME: legacy });
  app = await electron.launch({ executablePath: exe, args: [`--user-data-dir=${userData}`], env, timeout: 30000 });
  const page = await app.firstWindow({ timeout: 30000 });
  const actual = await app.evaluate(({ app }) => ({ version: app.getVersion(), packaged: app.isPackaged, userData: app.getPath('userData') }));
  assert.equal(actual.version, expectedVersion); assert.equal(actual.packaged, true); assert.equal(path.resolve(actual.userData), path.resolve(userData));
  const productVersion = process.env.JOURNEY_PRODUCT_VERSION;
  assert([expectedVersion, `${expectedVersion}.0`].includes(productVersion), `Unexpected executable product version ${productVersion}`);
  result.application = { ...actual, productVersion };
  Object.assign(result, await verifyOrdinaryStartup(page));
  await app.close(); app = null;
  const receipt = json(path.join(canonical, '.migration/receipt.json'));
  assert.equal(receipt.completed, true); assert.match(receipt.generation, /^[a-f0-9-]{36}$/);
  const data = path.join(canonical, 'generations', receipt.generation);
  if (stage !== 'source') assert.equal(receipt.generation, json(path.join(journey, 'baseline.json')).generation, 'Canonical generation changed across installer replacement');
  const config = json(path.join(data, 'config.json'));
  assert.equal(config.theme, fixtureConfig.theme); assert.equal(config.locale, fixtureConfig.locale);
  const expectedPort = stage === 'source' ? 17890 : 17891;
  assert.deepEqual(config.proxy, { ...fixtureConfig.proxy, port: expectedPort });
  const observed = {};
  for (const [name, body] of Object.entries(fixtureFiles)) {
    assert.equal(fs.readFileSync(path.join(legacy, name), 'utf8'), body, 'Legacy fixture was changed');
    assert.equal(fs.readFileSync(path.join(data, name), 'utf8'), body, 'Canonical author file was changed');
    observed[name] = hash(Buffer.from(body));
  }
  assert.deepEqual(json(path.join(legacy, 'config.json')), fixtureConfig, 'Read-only legacy config changed');
  if (stage === 'source') {
    // Make canonical differ from legacy, proving the next launch uses retained data.
    config.proxy.port = 17891; fs.writeFileSync(path.join(data, 'config.json'), JSON.stringify(config));
    write(path.join(data, 'prompts/canonical-after-source.txt'), 'Synthetic canonical-only source-era author file.\n');
    write(path.join(journey, 'baseline.json'), JSON.stringify({ generation: receipt.generation }));
  } else {
    assert.equal(fs.readFileSync(path.join(data, 'prompts/canonical-after-source.txt'), 'utf8'), 'Synthetic canonical-only source-era author file.\n');
  }
  if (stage === 'candidate') write(path.join(data, 'skills/candidate-era-author.md'), '# Synthetic candidate-era file\nPreserve during manual rollback.\n');
  if (stage === 'rollback') assert.equal(fs.readFileSync(path.join(data, 'skills/candidate-era-author.md'), 'utf8'), '# Synthetic candidate-era file\nPreserve during manual rollback.\n');
  result.preservation = { generation: receipt.generation, authorFileSha256: observed, checkedConfig: { theme: config.theme, locale: config.locale, proxy: config.proxy }, canonicalOnlySourceFile: stage !== 'source', candidateEraFile: stage === 'rollback' };
  result.accepted = true;
} catch (error) { result.error = error instanceof Error ? error.message : String(error); throw error; }
finally { try { if (app) await app.close(); } finally { fs.writeFileSync(evidence, `${JSON.stringify(result, null, 2)}\n`); } }
'@
  $previousVersion = $env:JOURNEY_PRODUCT_VERSION
  try {
    $env:JOURNEY_PRODUCT_VERSION = [string](Get-Item -LiteralPath $exe).VersionInfo.ProductVersion
    $nodeSource | & node --input-type=module - $root $exe $journeyRoot $stageReceipt $Name $Version
    if ($LASTEXITCODE -ne 0) { throw "Installed startup/data checks failed in stage $Name" }
  } finally { $env:JOURNEY_PRODUCT_VERSION = $previousVersion }
  $proof = Get-Content -LiteralPath $stageReceipt -Raw | ConvertFrom-Json
  if (-not $proof.accepted) { throw "Stage $Name did not produce accepted evidence" }
  $record.stages += [ordered]@{ stage = $Name; expectedVersion = $Version; installerExitCode = $exitCode; startedAt = $started.ToString('o'); completedAt = [DateTime]::UtcNow.ToString('o'); receipt = "$Name.json"; receiptSha256 = (Get-FileHash -LiteralPath $stageReceipt -Algorithm SHA256).Hash.ToLowerInvariant() }
  Save-JourneyRecord
}
try {
  $record.harnessSha = & git -C $root rev-parse HEAD
  if ($LASTEXITCODE -ne 0) { throw 'Cannot identify harness commit.' }
  Save-JourneyRecord
  $sourceInstaller = Get-VerifiedInstaller -Tag $FromTag -PublishedSource
  $candidateInstaller = Get-VerifiedInstaller -Tag $CandidateTag
  Install-Stage -Name source -Installer $sourceInstaller -Version $FromTag.Substring(1)
  Install-Stage -Name candidate -Installer $candidateInstaller -Version $CandidateTag.Substring(1)
  Install-Stage -Name rollback -Installer $sourceInstaller -Version $FromTag.Substring(1)
  $record.accepted = $true
  Save-JourneyRecord
  "Installer upgrade and manual rollback accepted for the stated synthetic global-data scope." | Out-File -FilePath $env:GITHUB_STEP_SUMMARY -Append -Encoding utf8
  "Not an in-app update or full SQLite project downgrade acceptance. Evidence: journey.json, source.json, candidate.json, rollback.json." | Out-File -FilePath $env:GITHUB_STEP_SUMMARY -Append -Encoding utf8
} catch {
  $record['error'] = $_.Exception.Message
  Save-JourneyRecord
  throw
}
