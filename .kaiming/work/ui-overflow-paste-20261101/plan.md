# UI overflow + image paste — 2026-11-01

## Goal

1. The Task roster's member state text (`正在 question：<long title>`) must not widen the Task block or the transcript. The full title stays available on hover; the row shows one ellipsized line inside the card.
2. Pasting image data into the composer attaches it exactly like the `＋` file picker (upload first, preview, send ids), respecting the six-image limit and the existing error messages.

## Change

- `webapp/src/theme/base.css`: give `.mrow .mo` `min-width:0`, a bounded width and an ellipsis; the row's middle column already owns the flexible width.
- `webapp/src/chat/TaskTodo.tsx`: put the state label in `title` so the truncated note is still readable.
- `webapp/src/chat/Composer.tsx`: handle `paste` on the textarea; collect image clipboard files and call the same upload path as the file picker. Do not intercept a plain-text paste.
- `docs/technicalnew/ui-design.md` / U10: record the paste entry and the containment rule.
- Build the served frontend after tests.

## Acceptance

- A long question title in a Task member row is clipped with an ellipsis; the `.todo` block stays inside the transcript; hover gives the full title.
- Pasting one or several images uploads and previews them; submitting sends their ids. Text-only paste still inserts text normally.
- Paste respects the six-image limit and shows the existing upload error.
- Webapp tests, typecheck and build pass; a real browser screenshot confirms the long row does not cross the card's right border.

## Out of scope

- No new upload endpoint, paste of arbitrary files, or image editing.
- No change to the task/model contract.
