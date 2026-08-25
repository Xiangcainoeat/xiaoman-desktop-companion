# Xiaoman Production Retrospective

## Where the work detoured

The final result is sound, but the first pass was not direct. Preserved workspace filenames show replacement candidates for the base, several standard rows, both cardinal/look work, and especially directional locomotion.

The main causes were:

1. **Identity variance from many photographs.** Different camera distances and expressions encouraged the model to change Xiaoman's head shape and body proportions. Establishing one canonical base earlier would have reduced retries.
2. **Trying to solve motion and identity together.** Rows such as `running-right`, `running-left`, and `jumping` needed stronger pose geometry while preserving the same face. Explicit state silhouettes and stable-slot registration worked better than increasingly long aesthetic prompts.
3. **Directional ambiguity.** Intermediate look poses can be correct in sequence but ambiguous when shown as tiny randomized pairs. Cardinal anchors, labeled review, blind review, and continuity review were all needed; no single metric was sufficient.
4. **Left/right gait repair.** Direct generation and simple reuse were not enough for a stable opposite-direction row. An anchored row-level repair was more coherent than one-cell fixes.
5. **Publishing concerns arrived late.** The working directory retained source references, discarded outputs, and absolute paths. Building a clean release boundary from the start would have made final packaging faster.

## What was worth keeping

- The canonical identity reference substantially improved consistency.
- Generating state rows separately made targeted repair possible.
- Four cardinal anchors gave the sixteen look directions a defensible semantic frame.
- One final chroma-despill pass preserved alpha and avoided cumulative edge damage.
- Machine checks plus normal-size visual review caught different classes of problems.
- The two-file runtime package stayed small despite a much larger authoring workspace.

## Better workflow next time

1. Decide the public/private boundary before generation and keep private references in an ignored directory.
2. Approve the canonical base before generating any row.
3. Generate `idle` and `running-right` first as identity and motion gates.
4. Decide immediately whether the opposite gait is safe to mirror or requires anchored generation.
5. Validate each row as soon as it is produced; do not defer known geometry issues.
6. Approve cardinals before intermediate look directions.
7. Treat automated direction warnings as triage signals, then record a clear human resolution.
8. Assemble once, despill once, validate once more, and package from a clean staging directory.

## Reproducibility statement

This release reproduces the deterministic processing and the accepted package, not the exact model sampling history. Raw candidates are intentionally omitted for privacy and size. The public prompts and QA records are sufficient to understand the decisions and to produce a new compatible pet, but a new generation run will not be pixel-identical.
