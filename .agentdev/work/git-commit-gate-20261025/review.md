# Review · git-commit-gate-20261025

Reviewer: independent review session (read-only). Review performed 2026-10-25 00:30–01:50 (+08:00).
Code state reviewed: `devagent/src/runtime/git-delivery.ts` mtime 01:31:51, `devagent/test/git-commit-gate.test.ts` mtime 01:32:33 — the sources were revised **twice during the review window** (earlier revisions at 00:54 and ~01:28); all findings below are anchored to the final version. Implementation.md (mtime 00:55:33) is stale relative to the final code (see F-5).

Evidence base: direct reads of all changed files, git behavior probes in scratch repositories, and test runs (`npx vitest run test/git-commit-gate.test.ts` → 18 passed; full `npx vitest run` → 33 files / 363 tests passed, run after the last revision).

## 1. `observeCommit` classification matrix

| Case | Verdict | Evidence |
|---|---|---|
| No repository | Correct → `no-git`, no gap | `git-delivery.ts:103-116`: `rev-parse --is-inside-work-tree` fails and no `.git` marker found in any parent → `no-git`. Probed: `/tmp` non-repo → exit 128 → `no-git`. |
| Repo with no commits | Correct → `git`, `head: null`, all delivery files untracked/dirty | `git-delivery.ts:118` runs `rev-parse HEAD` and accepts failure; empty-repo case covered by test `reports a repository without commits as everything untracked` (test:88-96). Probed separately: `rev-parse HEAD` in an empty repo exits 128 without side effects. |
| Project inside a larger repository | Correct | Status prints repo-root-relative paths (probed: `apps/web/src/a.ts`); `--show-prefix` (`git-delivery.ts:122-125`) strips `apps/web/`, so project-relative `src/a.ts` is reported (test:98-111). Both dirty and ignore detection strip the prefix (`:145`, `:167`). |
| Deleted file | Correct — cannot slip through | Probed: `git rm`-less deletion prints `AD <path>` in `-z` status; pathspec by old name also matches. Renames print `R  dest\0src`; `dirtyPaths` consumes the second record (`git-delivery.ts:73-86`) and adds the destination, which is the record the pathspec names (probed: source-only pathspec prints `D a.ts` — still dirty). |
| Staged-only change | Correct — reported | Probed: staged modification prints `M  <path>` in porcelain v1 `-z`; test:179-186 covers it. |
| Untracked file | Correct — reported | `--untracked-files=all` (`:130`); test:73-82 and empty-repo test. |
| Gitignored delivery file | Correct — reported as `ignored` gap | This was a real hole in the 00:35 version (status never prints ignored paths → silent clean) and is now fixed via `check-ignore -z --stdin` (`git-delivery.ts:148-170`), gated on `existsSync` (`:168`) so never-committable gaps are not raised for already-deleted paths (test:133-141). |
| Unreadable repository (broken `.git`, dubious ownership) | Correct → `unverifiable`, blocks | Earlier version returned `no-git` on any rev-parse failure — silent pass. Final version walks parents for a `.git` marker (`git-delivery.ts:88-99`, `:106`) and blocks with `could not be checked` (tests:113-127, 189-197). Probed: broken-`HEAD` `.git` → rev-parse fails but `dubious-ownership`-style configs still answer `is-inside-work-tree`. |
| Embedded (vendor) repository | Residual edge, F-2 below | Probed: status with `--untracked-files=all` from the outer repo prints nothing for `vendor/lib/a.txt` while the inner repo is untracked (`?? vendor/lib` only when the *directory* is the pathspec). See F-2. |
| Filenames with `[`/`*` | No defect | Probed: magic pathspec chars do not suppress matching for existing files (`M a[1].ts` printed); an untracked `c[9].ts` **is** matched because the glob `c[9].ts` matches the literal name. `dirtyPaths` output is only compared against the review's paths, never used as pathspec input. |
| Argv overflow | Handled | Batching at `PATH_BATCH = 200` (`:34-35`, `:126`, `:151`); test:199-210 covers a change past the batch boundary. |
| Timeout | Bounded | `timeout: 5_000` on every spawn (`runGit`, `:57`); worst case `end` costs a few seconds, then fails closed into `unverifiable`. |

**No case is silently reported as clean** except the embedded-repo edge (F-2, narrow).

## 2. The path set

The gate uses the last passed review's `deliveryState.paths` (`completion-git.ts:16-19`), which `report-tools.ts:216-243 observeDelivery` produced by `snapshotDelivery(cwd, knowledge)` — a full walk of the project directory (`deliverable.ts:63-83`) skipping only `.git`, `node_modules`, `.dev` (`deliverable.ts:14`) and the project's knowledge-entry paths. So:

- **Paths under `.dev/` or knowledge entries**: never in the set — cannot block.
- **Gitignored / generated files**: in the set (the walk ignores gitignore), but the final code reports them as an `ignored` gap with the `git add -f` escape hatch instead of a permanent plain-dirty block. A project that legitimately keeps a *reviewed* generated artifact ignored must either force-add it, remove it from the tree, or keep it out of the delivery — the gap text says exactly that. This matches plan.md's stated trade-off (only reviewed delivery paths are gated; `.dev/work/**` is never gated because it is in SKIP_DIRS).
- **Untracked-in-HEAD noise**: untracked files anywhere in the project enter the review's path set and therefore the gate. This is honest (the review did cover them) and fixable by `git add`/commit.
- **Legitimate-forever-block risk**: only F-2 and F-3 below; no structural one found. `.agentdev` (this work's own artifacts) is *not* in SKIP_DIRS — if a project keeps its agent work under `.agentdev` rather than `.dev`, its plan/report files are part of every delivery snapshot; they are committable, so the gate demands committing them. Verifiable but worth knowing; the settler prompt already says delivery records go into the commit.
- **Uncommitted delivery slipping through**: requires the review→end window race (F-1) or a chief session without cwd (F-4).

## 3. `endOp`

- **Task stays open**: the pre-check at `task-tools.ts:572-581` returns `COMPLETION_INCOMPLETE` before `endTask` is called; `endTask` itself re-runs `taskCompletionGaps` inside the transaction (`store.ts:2274-2279`) and only then updates status. The test asserts `status` is not `completed` after the refusal (test:338-349).
- **All gaps in one refusal**: yes — `task-tools.ts:576` merges `taskCompletionGaps` (members, review/test, digest) with the git gaps. Note the git gap is computed even when other gaps exist, i.e. one extra git spawn per refused end; acceptable (bounded 5s) and honest.
- **Race between pre-check and transaction**: the *existing* blockers are re-checked inside the transaction (`store.ts:2277`), so a member result or delivery change between the two checks is caught. The **git observation is not inside the transaction** — it cannot be, since SQLite transactions cannot observe a concurrent `git commit`. A commit landing between `observeCommit` and `endTask`'s UPDATE makes the Task slightly *less* committed than observed (harmless); the inverse direction — file mutated after the check — is the D-07 digest problem and is caught by the digest re-check inside `endTask` for tracked content, but a change that leaves the digest untouched (mode bits) or a gitignored path is not. This residual window is inherent to observing an external process; the code is honest about it (the store comment at `store.ts:2276-2277` claims only the hashing is in-transaction, and it is).
- **Double work**: `endOp` computes `deliveryCommitGaps` (git spawns) even when `taskCompletionGaps` would already refuse — one wasted observation per refused end, bounded at 5s each; fine. `guidanceFor` is also called twice on the refusal path (once inside the gap construction via `nextActions`, and `completionFacts` itself re-runs `deliveryCommitGaps`) — so a refused `end` may spawn git up to 3–4 times. Still bounded (≤ 4 × 5s), but see F-4's severity note.
- **Every task tool call**: `completionFacts` (guidance) now spawns git on `create`/`update`/`dispatch`/`control`/`adopt`/`get`/delegation results for any write Task with a passed review and bound paths (guidance.ts:190, called from task-tools.ts:426, 517, 555, 610, 716 and delegation-tools.ts:99, 236). Bounded at 5s per spawn, synchronous `execFileSync` on the server event loop — a hung git (NFS, `core.fsmonitor` daemon) stalls RPC handling for up to 5s per call. Acceptable for a local-dev host, worth a note.

## 4. `guidance.completionFacts` behavior change audit

- Read Tasks: `deliveryCommitGaps` returns `[]` for `type !== 'write'` (`completion-git.ts:12`) before any git spawn — no change. Test:316-320.
- No passed review / old review without `deliveryState`: `paths.length === 0` → `[]`, no git spawn (`completion-git.ts:19-20`). Tests:321-325, 326-330.
- No-git project: `observeCommit` → `no-git` → `[]` (`git-delivery.ts:190`). Test:53-60.
- One subtlety: the gate uses the **chief session's** `cwd` (`completion-git.ts:21`) while `completionBlockers` hashes with `requireTaskCwd` — the same session row (`store.ts:2820-2823`), so identical; `cwd === undefined` silently passes (F-4).
- Dispatch/get for write Tasks now carry a git-dependent gap string they previously never had; the webapp renders `gaps` verbatim (`App.tsx:171-178`), so no format assumption is broken.

## 5. Contracts vs code

- `delivery.md` D-07: "提交是收口条件：被独立复核覆盖的交付文件在项目里仍未提交时，任务不能结束，工作台列出未提交文件与所需动作" — code matches (end refuses, names files + command). **But the 工作台 (workbench) does not list them**: `task.get` (`read-methods.ts:364-404`) returns `taskSummary` + members + results only — no `gaps` field; the webapp only shows gaps pasted into a *cleanup-refusal* notification (`App.tsx:171-178`). The model-facing `task(op=get)` does include them (task-tools.ts:715-717). D-07 over-claims the UI surface → F-5.
- `agents-and-tools.md:131`: matches the code precisely — git observation module names, no-repo/read-Task exemptions, unverifiable blocks, and explicitly "提交仍由模型执行 / the program only observes and refuses". No claim of program-side commit anywhere: grep over all four docs + prompts for 代提交/代为/commit on behalf — none.
- `storage-and-recovery.md` sequence: "先由宿主观察复核覆盖路径的提交状态…未提交即返回 COMPLETION_INCOMPLETE + 缺项；通过后事务保存 completed" — matches `endOp` order exactly (`git-delivery` observation → store transaction).
- `implementation-checks.md` REL-17 (added by this change, not listed in implementation.md): describes exactly the implemented matrix, including the "仓库存在但读不出" case.
- `prompts/settler.md` / `prompts/chief.md`: consistent with the refusal flow ("finish the commit before reporting settled"; "end refuses and names them").

## 6. Tests (18 in the final file)

The observation matrix is strong: no-repo, committed, changed, unrelated-paths, empty-repo, nested-repo, broken-parent-repo, ignored-deleted-path, ignored+dirty combined, gitignored-only, unreadable-`.git`, 205-path batching, staged-only. Store-level: committed/uncommitted/read/no-paths. E2E: end refusal lists files, `get` shows the same gap, commit removes it while other gaps remain. No tautologies found; every assertion pins behavior, not incidental output.

Missing cases that would let a plausible bug through:

- **M-1 (covers F-2)**: a delivery path inside an embedded repository (e.g. `vendor/lib/a.txt` where `vendor/lib` is its own repo) — current code reports clean while `git commit` in the project root cannot capture the file (or fails). A test would have caught F-2 before the empty-repo/matrix tests were written; it is the only silent-clean case left.
- **M-2 (covers F-3)**: `.gitignore` that ignores an *already-tracked* delivery file, plus a modification — the `ignored` gap fires for a file that `git add -f`… no; tracked files are not check-ignore reportable, so this test would pin the existsSync/dirty interaction (dirty still reported). Lower value than M-1.
- **M-3 (covers F-4)**: chief session whose `cwd` column is empty — pins that the gate must not silently pass.
- **M-4**: `end` with git gaps *and* pre-existing store gaps, asserting both appear in the single `gaps` array (currently only the git gap is exercised; the merge at task-tools.ts:576 is untested directly).

## Findings

### F-1 · git re-observation gap between refusal and store transaction — P2, accepted-by-design (report only)
`task-tools.ts:572-581` observes git outside `endTask`'s transaction. A commit landing between the two checks makes the recorded completion slightly stale (Task closes while HEAD no longer contains the reviewed paths' *latest* state). The store re-checks only its own blockers (`store.ts:2277`). Impact is bounded and matches the plan's decision ("程序只观察与拒绝"); the digest check catches tracked-content changes. No action required; noting because question 3 asks explicitly.

### F-2 · delivery paths inside an embedded repository are reported clean — P2, confidence 0.75
`git-delivery.ts:126-147` runs `git status -- <path>` with `cwd` = project. When a delivery path lives inside a nested repository (vendored dependency committed as its own repo — common for vendored code), the outer repo's status prints nothing for the file while it is untracked/modified in the inner repo (probed twice: `--untracked-files=all -- vendor/lib/a.txt` → empty; `git add vendor/lib/a.txt` from outer fails silently by adding nothing). Result: the gate reports the delivery committed while no commit in the project's repo can contain the file — the silent-clean case the plan's decision ("无法核实比假通过安全") says must not happen. Repro: outer repo `p` with `t.ts` committed; `p/vendor/lib` its own repo with untracked `a.txt`; `observeCommit('p', ['vendor/lib/a.txt'])` → `mode: 'git'`, `dirty: []`. A cheap fix (check each path against the nearest `.git` marker, or run status with `--no-optional-locks` and compare `git -C inner` too) would close it; or document the limitation in agents-and-tools.md. Suggestion (drop-in for the loop body at `git-delivery.ts:144-146` is possible but a full fix needs the nested-repo detection described in the report; not emitting a code block since the right fix is a design choice).

### F-3 · ignore rules cannot be distinguished from a delivery the project genuinely refuses to version — P2, confirmed intended trade-off
A project may gitignore a reviewed path for policy reasons (e.g. `secrets.local.json` hashed by the review). The gate then blocks until the file is force-added (wrong: policy) or removed (fine: out of delivery). The gap text offers `git add -f` first, which nudges toward the wrong resolution. Suggestion (ordering only):
```ts
      gaps.push(
        `the reviewed delivery contains ${observation.ignored.length} ignored file(s) that can never be committed (${summarize(observation.ignored)}); keep them out of the delivery or add them with \`git add -f -- <paths>\``,
      );
```
Not blocking; the plan explicitly accepts reviewed-paths-only gating, and a force-add is always available.

### F-4 · chief session without `cwd` silently passes the gate — P2, confidence 0.85
`completion-git.ts:21-22`: `cwd === undefined → []`. `CreateSessionParams.cwd` is required (`store.ts:370-371`), so today every chief session has a cwd and the branch is unreachable from the store API — but the same "silently pass" pattern the change elsewhere refuses (`unverifiable` for unreadable git, per plan decision) is embedded here for a data state the schema cannot currently produce. If a future migration/adopt flow ever writes a session without cwd, every gate becomes a no-op. One-line fix:
```ts
  if (cwd === undefined) {
    return ['the delivery could not be checked against git: the chief session has no working directory'];
  }
```
### F-5 · documentation and evidence drift — P3
- `delivery.md` D-07 claims the 工作台 (workbench) lists uncommitted files and required actions; only the model-facing `task(op=get)` refusal carries them (`task-tools.ts:576-580`, `:715-717`); `task.get` (read-methods.ts:364) has no gaps field and the webapp has no task-gap surface. Either add the field to `taskSummary` or soften D-07.
- `implementation.md` says "12 例" for the test file; the final file has 18 (the file grew twice during review). Its "357 tests" evidence line is also stale (final: 363).
- `implementation.md` does not mention `implementation-checks.md` REL-17 or the final `repositoryMarker`/batching/`check-ignore` design, so a reader cannot reconstruct the shipped behavior from it alone.

## Verdict

**Non-blocking findings.** No way found for a Task with an uncommitted reviewed delivery to close (the one silent-clean case, F-2, requires a nested repository inside the delivery — narrow and fixable), and no permanent block of a legitimate delivery (gitignored reviewed paths produce an actionable gap with a force-add escape). The gate refuses rather than closes, all gaps travel in one refusal, read Tasks/no-git/old-review behavior is unchanged, and the four contract documents match the implemented behavior except for the D-07 workbench sentence (F-5). Tests: 18/18 pass; full suite 33 files / 363 tests pass on the reviewed revision.

Blocking means: closes a Task with an uncommitted delivery, or permanently blocks a legitimate one. Neither is demonstrated.

---

## Re-review (2026-10-25 02:10, against the post-fix snapshot)

State reviewed: `git-delivery.ts` / `completion-git.ts` / test file mtime 02:02–02:03, docs 02:03–02:04; no further edits observed through 02:10. Evidence: fresh reads of the changed surfaces, live `observeCommit` runs in scratch repos (including a real `git submodule add` flow), and test runs — gate file 19/19, full `devagent` suite 33 files / 364 tests green.

### F-2 (delivery paths inside an embedded repository reported clean) — partially closed; new defect found

Closed for the embedded (non-submodule) case: `nestedRepositories` (`git-delivery.ts:100-121`) walks each reviewed path's ancestors up to the project root, reports directories with their own `.git` marker, and `commitGaps` (`:211-215`) emits the dedicated gap "this project's commits cannot contain them — commit them in that repository or keep them out of the delivery". Live check: `/tmp/emb3/p` with `vendor/lib` its own repo and an untracked inner file → `{mode:'git', dirty:[], nested:['vendor/lib']}`; test:127-143 asserts `dirty: []`, `nested: ['vendor/lib']` and the gap text. The silent-clean hole is closed.

**New defect (submodules):** the same marker check treats proper submodules as nested repositories, but a submodule is the one legitimate form whose contents *are* committed — to the submodule's own repo, with the gitlink in this project. Two consequences, both reproduced:

1. **Permanent-looking block.** `git status -- <path inside submodule>` dies with `fatal: Pathspec 'vendor/lib/a.txt' is in submodule 'vendor/lib'` (exit 128), so `observeCommit` returns `mode: 'unverifiable'` with that raw fatal as `detail`. The only remedy the unverifiable gap offers is "restore git" — but git is not broken; the state is normal. In my end-to-end probe (submodule with committed inner change + gitlink bump in the outer repo, working tree clean) `observeCommit('/tmp/sub/outer', ['t.ts','vendor/lib/a.txt'])` returned `unverifiable` after every correct action had been taken: a fully-committed legitimate delivery cannot clear the gate.
2. **Misleading gap even where reachable.** For an embedded repo the new gap says "commit them in that repository", which for a submodule the settler would rightly do — yet the outer gitlink bump is then still flagged, and worse, status may not even run (consequence 1) depending on which paths were batched.

Because submodules are common in real projects, this can permanently block a legitimate delivery — the review's stated blocking bar. Severity of my earlier F-2 was "silent pass in an uncommon configuration"; the fix trades it for "unresolvable refusal in a common configuration". Suggested direction (not a code block, it is a design choice): exclude directories whose `.git` is a *file* pointing at a gitdir with a configured superproject (i.e. real submodules — `git submodule status` / `<dir>/.git` containing `gitdir: ../.git/modules/...`), from the `nested` list; and for status pathspecs, skip or special-case paths inside submodules (gitlink changed → dirty) instead of letting the 128 fatal degrade the whole observation to `unverifiable`. At minimum, document the limitation in `agents-and-tools.md` as out of scope for this step.

### F-3 (ignored-file gap nudges toward force-add) — closed

`commitGaps` (`git-delivery.ts:199-203`) now leads with "keep them out of the delivery" and conditions the force-add on "if the ignore rule is wrong". Both remedies in the sentence correspond to real states: my probe shows `check-ignore` stops listing a force-added file (it consults the index first), so committing with `-f` genuinely clears the gap; a deleted path is not reported at all (`existsSync` filter, `:168`, test:160-170). Balanced wording, verified remedy. Closed.

### F-4 (chief session without cwd silently passes) — closed

`completion-git.ts:21-25` now returns an explicit unverifiable-style gap: "the project directory of this Task is unknown, so its delivery could not be checked against git; end again once the directory is known". The comment correctly marks the branch as unreachable through today's store. The silent-pass pattern is gone. Closed.

### F-5 (documentation and evidence drift) — closed

- D-07 (`delivery.md:123`) now says the refusal "把未提交文件与所需动作返回给主管" (returns them to the chief, not that the browser lists them) — matches `task-tools.ts` exactly, and it now also names the two uncommittable classes (`.gitignore`-excluded, nested-repo).
- `implementation.md` now describes marker walk, `check-ignore -z --stdin`, nested repositories, 200-path batching, "19 例", "33 files / 364 tests", and the REL-17 row — all match what I measured (19 `it(` in the file, 364 tests passing, REL-17 present in `implementation-checks.md`). Closed.

### Re-review verdict

Three of four findings closed with evidence (F-3, F-4, F-5). F-2 is closed for the case it originally covered, but its fix introduces a new blocking risk: a project using git submodules whose reviewed delivery includes paths inside a submodule gets an `unverifiable` refusal that no correct sequence of commits can clear (reproduced end-to-end). Under the assignment's bar — "blocking means … can permanently block a legitimate one" — this makes the change **blocking** until submodules are excluded from `nested` detection and their pathspecs kept out of the status call (or the limitation is explicitly scoped out in the contracts).

---

## Final re-review (2026-10-25 02:30, against the partitioned-repository design)

State reviewed: gate file 21 tests (21/21 pass), full `devagent` suite 33 files / 366 tests green, `tsc --noEmit` clean — all re-run by this reviewer on the current snapshot. Live probes: real `git submodule add` lifecycle, embedded repo, ignored nested repo, through the actual `observeCommit`/`commitGaps`.

### The two direct questions

**Is the submodule path now a passing delivery when correctly committed? Yes, verified end-to-end.** After committing the inner change and bumping the pointer in the outer repo (clean tree), `observeCommit('/tmp/sub/outer', ['t.ts','vendor/lib/a.txt'])` returns `{mode:'git', dirty:[], recorded:[['vendor/lib', true]], gaps:[]}`. The full lifecycle is pinned by the real-submodule test (`test:145-193`): 0 gaps → inner dirty (2 gaps: pointer + inner file) → inner committed (1 gap: pointer) → pointer committed (0 gaps). The inner paths are never passed to outer `status`/`check-ignore` — the partitioning at `nestedGroups` (`git-delivery.ts:125-158`) plus the root-only pathspec batch makes the exit-128 I reproduced structurally unreachable, confirmed by live runs at every lifecycle stage.

**Can any reviewed delivery still pass while uncommitted? Not by any route I could construct.** Probed: dirty inner file → 2 correct gaps (pointer + inner); inner committed but pointer not → 1 gap; untracked embedded repo → 2 gaps (`recorded:false`, inner untracked); gitignored nested repo with dirty inner content → inner observation reports it (the group is checked in its own repository regardless of the outer's ignore rules); gitignored plain file → `ignored` gap; deleted / staged-only / untracked / renamed plain paths → dirty gap; unreadable nested `.git` → unverifiable gap prefixed `inside nested repository vendor/lib:`; a repo the outer ignores but whose inner content is committed passes — correctly, since the reviewed files are committed somewhere the gate verifies. One-level nesting verified live; deeper nesting uses the same recursive path (`observeCommit` calls itself per group, `commitGaps` recurses with a label prefix).

### Finding states

- **F-2 (nested repositories): CLOSED.** The redesign answers both halves of the original defect and its own regression: embedded repos are checked in their own repository and flagged unrecorded (`recorded:false` → "not recorded as committed in this project" gap with the two-step remedy), and proper submodules pass exactly when content + pointer are committed. The stray-`.git`-file hardening (`isRepositoryMarker` requires a directory or a `gitdir:` pointer, `git-delivery.ts:79-90`) is pinned by its own test (`test:195-205`). Both fixes are recorded in `implementation.md` (rows on the submodule 128, the marker validation, and the grouped-observation design at line 53).
- **F-3 (ignored-gap wording): CLOSED** (unchanged since the previous re-review; re-verified in the current file, `git-delivery.ts:289-293`).
- **F-4 (missing chief cwd): CLOSED** (unchanged, `completion-git.ts:21-25`).
- **F-5 (doc/evidence drift): CLOSED.** `agents-and-tools.md:131` now describes exactly the implemented model — three separate facts (uncommitted / ignored / nested-repo with the outer recording as its own fact), upward marker walk, unverifiable blocks, no-git only when no marker exists upward, and "提交由模型执行…程序只观察与拒绝，不代提交". D-07 (`delivery.md:123`) retains the corrected chief-facing wording and names both uncommittable classes. No document claims the program commits.

### Final verdict

**Passed.** All findings from the original review and both re-reviews are closed with reproduced evidence. The gate refuses every uncommitted state I could construct (including nested and submodule forms) and accepts a legitimate delivery in each correctly committed state, including the submodule lifecycle that was briefly blocked by the intermediate fix. Remaining nuance, non-blocking: an ignored-and-unrecorded vendored repository passes once its inner content is committed, even though the outer project's commits can never reproduce that state after a fresh clone — defensible under the contract's "checked in its own repository" rule and worth a line in `implementation.md`'s limitations if the team wants it on record.

---

## Post-fix N6/N9 re-review (2026-10-25 02:55)

State: gate file 23/23, full `devagent` suite 33 files / 368 tests green, `tsc --noEmit` clean — all re-run on this snapshot. Live probes re-run against my surviving fixtures plus a new two-level fixture. Honest note: the deepest-boundary bug (N9) was missed by my previous round — I had probed one-level nesting only; this round verifies two levels in both directions.

### N6 — nested repository excluded by the project's `.gitignore` passed silently: CLOSED

Root cause confirmed in the old behavior (my `/tmp/ign/p` fixture: outer `.gitignore` = `vendor/`, nested repo with committed inner content previously returned `recorded:true, gaps:[]`). The fix adds the repository roots to the `check-ignore` pass (`git-delivery.ts:244-247`, `inspect = [...files, ...batch.filter(roots.has)]`), classifies them as `state:'ignored'` ahead of `unrecorded` (`:268-272`), and `commitGaps` emits the dedicated gap without treating the root as recorded (`git-delivery.ts:313-316`). Live re-run: `{"nested":[["vendor/lib","ignored",...]], "gaps":["the nested repository vendor/lib is excluded by this project's .gitignore, so no commit here can carry what was reviewed; remove that rule or keep the nested delivery out of this project's delivery"]}`. The remedy is real: dropping the ignore rule moves the root to the recorded/unrecorded track. This also supersedes the non-blocking nuance from my final re-review (ignored-and-unrecorded vendored repo) — that pass hole no longer exists.

### N9/N9b — deepest-boundary grouping let a two-level delivery pass uncommitted: CLOSED

`nestedGroups` no longer `break`s at the first marker, keeping the OUTERMOST boundary below the project (`git-delivery.ts:139-146`, comment explains the chain-of-custody reason); inner paths are only ever checked after recursion into the outer group's repository. New fixture `/tmp/deep/p` (project → `vendor/a` repo → `vendor/a/vendor/b` repo, delivery path `vendor/a/vendor/b/b.txt` untracked everywhere): live run reports all three facts — `vendor/a` unrecorded (outer must record it), `vendor/b` unrecorded (inside `vendor/a`), `b.txt` dirty (inside `vendor/b`) — three actionable gaps, Task would refuse. After committing bottom-up (`b` → `a` → outer), the same call returns `{"nested":[["vendor/a","recorded"]], "gaps":[]}` — the legitimate chain passes, so no permanent block. The recursion is unbounded by construction (`observeCommit` calls itself per group; `commitGaps` recurses with a prefixed label), and `implementation.md` rows at lines 40-41 and the design note at line 55 document both fixes.

### Verdict

**Both closed; overall verdict stands: passed.** The two pass-while-uncommitted routes the tester found (N6, N9/N9b) now refuse with actionable, real remedies, and both legitimately-committed forms pass. Every route to a silent pass I could construct across all four review rounds is now blocked; the submodule lifecycle, embedded repos, ignored roots, and two-level chains all pass exactly when every repository in the chain has committed its part.
