# Security Runbook (Production Hardening)

## 1) Immediate incident response for leaked secrets
1. Rotate `SUPABASE_SERVICE_ROLE_KEY` first.
2. Rotate Supabase JWT secret (forces token/session invalidation).
3. Rotate `anon/publishable` key if exposure scope requires.
4. Rotate all external integration secrets:
   - `DELPHI_API_URL` / `DELPHI_API_TOKEN` / `DELPHI_AUTH_BEARER`
   - `GEMINI_API_KEY`
   - `OPENAI_API_KEY`
   - `EXTERNAL_SUPABASE_SERVICE_KEY`
   - `PYTHON_INTERNAL_API_TOKEN`
5. Update Supabase Edge Function secrets and redeploy functions.
6. Validate by smoke tests and monitor 401/403/500 spikes.

## 2) Remove local tracked secrets
```bash
git rm --cached .env
git add .gitignore .env.example
git commit -m "security: stop tracking local env files"
```

## 3) Rewrite git history to purge leaked files
Recommended tool:
```bash
pip install git-filter-repo
```

Purge `.env` and common sensitive blobs:
```bash
git filter-repo --path .env --invert-paths
git for-each-ref --format="delete %(refname)" refs/original | git update-ref --stdin
git reflog expire --expire=now --all
git gc --prune=now --aggressive
```

After validation:
```bash
git push --force --all
git push --force --tags
```

Notify team to re-clone and invalidate old local clones.

## 4) Pre-commit secrets scanning
```bash
pip install detect-secrets
detect-secrets scan > .secrets.baseline
pwsh ./scripts/setup-hooks.ps1
```

Test hook:
```bash
echo "TEST_SECRET=abc123" > /tmp/secret-test.txt
git add /tmp/secret-test.txt
git commit -m "test"
```
Commit must be blocked by hook.

