# /eval — Feature Completeness Evaluation

Evaluate the completeness and quality of an AC task or feature implementation.

## Usage
```
/eval <target>
```
Where `<target>` is an AC number (e.g., `AC-5`) or feature name.

## Workflow

### Step 1: Define Criteria
Read the AC/feature requirements and list all acceptance criteria as checkable items.

### Step 2: Check Each Criterion
For each criterion:
1. Find the implementing code (Grep/Glob)
2. Find the corresponding test (Grep for test description)
3. Run the specific test if possible
4. Score: PASS / PARTIAL / FAIL

### Step 3: Report
```
## Eval Report: <target>

| Criterion | Code | Test | Status |
|-----------|------|------|--------|
| ...       | file:line | test name | PASS/PARTIAL/FAIL |

### Metrics
- pass@1: X/Y criteria pass on first check
- Coverage: X% of criteria have tests
- Overall: COMPLETE / INCOMPLETE

### Gaps
- [list any missing implementations or tests]
```

### Step 4: Actionable Items
List specific next steps to close any gaps found.

## Examples
```
/eval AC-3          → evaluate AC-3 (Craft basic tools)
/eval threat-detect → evaluate threat detection feature
/eval all           → evaluate all ACs
```

## Notes
- This is a read-only evaluation — it does not modify code
- Use findings to create tasks or feed into `/simplify plan`
- Combine with `verify-implementation` skill for full audit
