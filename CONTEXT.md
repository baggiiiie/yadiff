# yadiff

A browser-based diff viewer. Acquires diffs from local VCS (git, jj) or remote sources (GitHub), and renders them using @pierre/diffs and @pierre/trees.

## Language

**Target**:
The thing the user asked to diff. May be a local VCS revision/range/workspace state, or a remote source (e.g., a GitHub PR URL). A Target contains one or more **Diffs** (e.g., a PR has a combined diff plus per-commit diffs).
_Avoid_: ref, revset (when referring to the general concept of "what was requested")

**Diff**:
The set of file changes resulting from a **Target**. What the user sees in the browser.
_Avoid_: patch (when referring to the concept; "patch" is acceptable for the raw unified-diff text format)
