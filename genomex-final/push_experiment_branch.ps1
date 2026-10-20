# =============================================================
# GenomX Advisor - Commit remaining files + push experiment branch
# =============================================================
# IMPORTANT: Close Kiro / VS Code COMPLETELY before running this.
# Kiro holds the git index.lock while open, blocking all git writes.
#
# HOW TO RUN:
#   1. Close Kiro completely (File -> Exit, or close the window)
#   2. Open a new PowerShell window (Start -> search PowerShell)
#   3. Run:
#      powershell -ExecutionPolicy Bypass -File "c:\Users\spabbisetty\OneDrive - Infor\Desktop\genomex\GenomeX---Final-Year-Project\genomex-final\push_experiment_branch.ps1"
# =============================================================

$repo = 'c:\Users\spabbisetty\OneDrive - Infor\Desktop\genomex\GenomeX---Final-Year-Project'
Set-Location $repo

Write-Host ''
Write-Host '=== GenomX: final commit + experiment branch push ===' -ForegroundColor Cyan

# ---- STEP 0: Remove git lock if present ----
$lock = Join-Path $repo '.git\index.lock'
if (Test-Path $lock) {
    try {
        Remove-Item $lock -Force -ErrorAction Stop
        Write-Host 'Removed stale git lock.' -ForegroundColor Green
    } catch {
        Write-Host ''
        Write-Host 'ERROR: Cannot remove git lock.' -ForegroundColor Red
        Write-Host 'Kiro is still running and holding the file.' -ForegroundColor Red
        Write-Host 'Close Kiro completely, then run this script again.' -ForegroundColor Red
        exit 1
    }
}

# ---- STEP 1: Make sure we are on experiment branch ----
git checkout experiment 2>$null
if ($LASTEXITCODE -ne 0) {
    # experiment branch may not exist yet locally - create from feat branch
    git checkout feat/patient-api-integration
    git checkout -b experiment
}
Write-Host "On branch: $(git branch --show-current)" -ForegroundColor Green

# ---- STEP 2: Commit remaining unstaged files ----
Write-Host ''
Write-Host 'Staging remaining files (.agents, push script, .gitignore)...' -ForegroundColor Yellow

# Force-add .agents (it was previously gitignored, need -f)
git add -f '.agents/'
git add '.gitignore'
git add 'genomex-final/push_experiment_branch.ps1'
# Also catch any other untracked items in genomex-final
git add 'genomex-final/'

$status = git status --porcelain
if ($status) {
    git commit -m 'chore: commit .agents tasks, push script, final .gitignore update'
    Write-Host 'Committed remaining files.' -ForegroundColor Green
} else {
    Write-Host 'Nothing new to commit - already up to date.' -ForegroundColor Yellow
}

# ---- STEP 3: Remove root-level legacy/duplicate files ----
Write-Host ''
Write-Host 'Removing root-level legacy files...' -ForegroundColor Yellow
$rootLegacy = @(
    'README (2).md', 'README (3).md', 'README.md',
    'START_HERE (2).md', 'Start_here.md',
    'app (2).js', 'app.js',
    'autoencoder_model.py', 'bilstm_model.py', 'cel_parser.py',
    'clinical_rules (2).py', 'clinical_rules.py', 'clinpgx_loader.py',
    'cnn_model.py', 'data_synthetic.py',
    'drug_names.tsv', 'drug_rules.json',
    'eicu_loader.py', 'explainability.py',
    'files (2).zip', 'fusion_model.py', 'genomic_encoding.py',
    'genomx-advisor.html', 'gnn_model.py', 'knowledge_graph.py',
    'pipeline.py', 'random_forest_model.py',
    'requirements.txt', 'server.py', 'styles.css',
    'tggates_loader.py', 'xgboost_model.py'
)
foreach ($f in $rootLegacy) {
    git rm -f $f 2>$null
    if ($LASTEXITCODE -eq 0) { Write-Host "  removed: $f" }
}

# ---- STEP 4: Remove old version folders ----
Write-Host ''
Write-Host 'Removing old version folders...' -ForegroundColor Yellow
git rm -rf 'genomx-v2/' 2>$null
git rm -rf 'genomx-v2.1/' 2>$null
Write-Host '  removed: genomx-v2/ genomx-v2.1/'

# ---- STEP 5: Remove research legacy (keep only research/kg/) ----
Write-Host ''
Write-Host 'Removing research/ legacy code...' -ForegroundColor Yellow
$researchLegacy = @(
    'research/clinical_rules.py', 'research/data_synthetic.py',
    'research/drug_rules.json', 'research/explainability.py',
    'research/genomic_encoding.py', 'research/gnn_model.py',
    'research/knowledge_graph.py', 'research/legacy_app.js',
    'research/pipeline.py', 'research/README_legacy.md',
    'research/server.py', 'research/splits.py'
)
foreach ($f in $researchLegacy) {
    git rm -f $f 2>$null
    if ($LASTEXITCODE -eq 0) { Write-Host "  removed: $f" }
}
git rm -rf 'research/models/' 2>$null
git rm -rf 'research/loaders/' 2>$null
Write-Host '  removed: research/models/ research/loaders/'

# ---- STEP 6: Commit the clean state ----
Write-Host ''
Write-Host 'Committing clean experiment branch...' -ForegroundColor Yellow
$status2 = git status --porcelain
if ($status2) {
    git commit -m 'experiment: clean app-only branch - removed all legacy and duplicate files'
    Write-Host 'Committed.' -ForegroundColor Green
} else {
    Write-Host 'Nothing to remove - branch is already clean.' -ForegroundColor Yellow
}

# ---- STEP 7: Push experiment branch ----
Write-Host ''
Write-Host 'Pushing experiment branch to GitHub...' -ForegroundColor Yellow
git push -u origin experiment --force
if ($LASTEXITCODE -ne 0) {
    Write-Error 'Push failed. Check GitHub authentication and try again.'
    exit 1
}

# ---- STEP 8: Also push feat/patient-api-integration to make sure it is up to date ----
Write-Host ''
Write-Host 'Updating feat/patient-api-integration on GitHub...' -ForegroundColor Yellow
git checkout feat/patient-api-integration
git merge experiment --no-edit 2>$null
git push origin feat/patient-api-integration
git checkout experiment

# ---- Done ----
Write-Host ''
Write-Host '=== ALL DONE ===' -ForegroundColor Green
Write-Host ''
Write-Host 'What was pushed:' -ForegroundColor Cyan
Write-Host '  experiment branch (clean - only what you need):'
Write-Host '  https://github.com/Akashpabbisetty/GenomeX---Final-Year-Project/tree/experiment'
Write-Host ''
Write-Host '  feat/patient-api-integration (full history, all commits):'
Write-Host '  https://github.com/Akashpabbisetty/GenomeX---Final-Year-Project/tree/feat/patient-api-integration'
Write-Host ''
Write-Host 'To use on another machine:' -ForegroundColor Cyan
Write-Host '  git clone https://github.com/Akashpabbisetty/GenomeX---Final-Year-Project'
Write-Host '  cd GenomeX---Final-Year-Project'
Write-Host '  git checkout experiment'
Write-Host '  npm install'
Write-Host '  npm run serve'
