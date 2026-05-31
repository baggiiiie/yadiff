# yadiff

A browser-based diff viewer. Acquires diffs from local VCS (git, jj) or remote sources (GitHub), and renders them using @pierre/diffs and @pierre/trees.

## Language

**Target**:
The thing the user asked to diff. May be a local VCS revision/range/workspace state, or a remote source. A Target contains one or more **Diffs**.
_Avoid_: ref, revset (when referring to the general concept of "what was requested")

**GitHub Pull Request Target**:
A public GitHub pull request URL used as a remote **Target**. It refers to the pull request as a reviewable change, not to a local repository checkout. It contains one combined **Diff** for the pull request.
_Avoid_: GitHub URL, PR link (when a more precise term is needed)

**Source**:
Where and how yadiff acquires a **Diff** for a **Target**, such as git, jj, or GitHub.
_Avoid_: VCS (when remote sources are included)

**Diff**:
The set of file changes resulting from a **Target**. What the user sees in the browser.
_Avoid_: patch (when referring to the concept; "patch" is acceptable for the raw unified-diff text format)

**Diff Projection**:
A browser-ready representation of a **Diff** for rendering and navigation. A Diff Projection contains projected file identity, tree status, stats, collapse state, and Review annotation placement without exposing raw parser metadata to most callers.
_Avoid_: view model, parsed model

**Projected File**:
A file-level entry inside a **Diff Projection**. It exposes display-safe facts such as path, previous path, change type, additions, deletions, and collapse state while hiding raw parser metadata.
_Avoid_: file diff metadata, parsed file

**Projected File Identity**:
An opaque identity for a file inside one active **Diff Projection**. Callers may store it for UI-local state such as collapse and draft Review placement, but only the Diff Projection may construct it or map it back to renderer internals.
_Avoid_: CodeView item id, parser index

**Review**:
A user-authored note attached to a **Review Target** in a **Diff**. A file Review is represented as line 0, and a single-line Review is represented as a range whose start and end are the same. Saved Reviews are portable by path plus side/line range, while UI-local Review state may retain Projected File Identity to avoid ambiguous attachment.
_Avoid_: comment (too broad), annotation (renderer mechanism)

**Review Target**:
The anchor coordinates for a **Review**: a file identity, a path, a side (`additions` or `deletions`), and a start/end line range. A file-level review uses line 0 for both endpoints. The side is shared across the range (reviews never span both sides).
_Avoid_: ReviewPoint (removed — side is per-target, not per-endpoint)

**Keyboard Router**:
The browser-side module that decides whether a key event belongs to editable input, tree search, or yadiff app shortcuts. It routes commands and focus; it must not synthesize text input.
_Avoid_: shortcut handler, keydown listener (when referring to the central routing seam)
