# Independent Review — P0-4

Two rounds, separate read-only agent context.

## Round 1: PASS

- **Structural read-only** (`inspect-tool.ts:26,34,45-60,99-148,180-193`): fixed op table, fixed prefix, validated `rev`/`path`, `execFileSync` without a shell, `--no-ext-diff --no-textconv`, `GIT_OPTIONAL_LOCKS=0`, fsmonitor off. Executed experiments in `/tmp`: git aliases cannot shadow builtins; `:/`/`:(top)` pathspecs cannot leave the repository; a symlinked path is not followed; `show --stat` has no textconv surface.
- **Tool sets** (`tool-sets.ts:45,94-96,127-136`): chief has no `bash`/`write`/`edit`; `inspect` is in `TOOL_UNIVERSE` so every other role denies it; paused/read holds keep it; other roles unchanged.
- **Completion gate** (`deliverable.ts:276-298`, `store.ts:2728-2762`): observed − reviewed, filtered by Task binding and baseline; candidates only queried for git ignore; inherited changes stay with `changedInheritedPaths`; `.dev`, knowledge entries, ignored files and settlement docs excluded; no-git works; one gap on both guidance and `endTask`.
- **Prompts/docs** (`chief.md:21,25,86`, `agents-and-tools.md:9,23,161,188`) match code.
- **Perf/placement**: no schema/migration/backlog change; path walk always, ignore query only on candidates.
- Non-blocking observations: `DOMAIN_TOOL_NAMES` comment, `default:` fallback, store failure wording.

## Round 2: PASS (after the observations were fixed)

- `DOMAIN_TOOL_NAMES` comment now says "shared" and explains the chief-only native slot; `rev-parse` is explicit and `default` uses `const unexpected: never` (verified missing case → TS2322); failure text mentions git state.
- Added `inspect-tool.test.ts:136-161`: a repo with `diff.external`, `diff=evil` textconv and `core.fsmonitor` pointing at a marker helper runs no helper. The reviewer demonstrated the live vector: plain `git status` runs the fsmonitor helper, the tool's prefix does not, so dropping `-c core.fsmonitor=false` makes the test fail. `diff.external`/textconv are defence-in-depth (only patch diffs invoke them).
- Re-ran `inspect-tool + tool-sets` 20/20 and `tsc --noEmit` exit 0.
