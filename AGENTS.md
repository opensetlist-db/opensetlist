# OpenSetlist — Codex instructions

## Required context

Before investigating, editing, or reviewing this repository:

1. Read the root [CLAUDE.md](./CLAUDE.md) in full. It is the shared source
   of project architecture, schema invariants, canonical URLs, public/admin
   i18n boundaries, UTC handling, comments, and branch/release rules.
   These rules apply to Codex too. Keep their authoritative text there:
   the owner's review hooks also read that file directly.
2. If `AGENTS.local.md` exists beside this file, read it in full and follow
   its owner-local workflow and Codex-specific adaptations. It is an
   explicit required read, not a filename Codex discovers automatically.
   Keep its contents and local reference material out of tracked files.
3. Read the task document and relevant source/configuration before
   implementing. For testing, consult [TESTING.md](./TESTING.md) and the
   scripts in `package.json`.

Use installed versions and current source/configuration when older
overview tables disagree with them. In particular, this checkout uses
Next.js 16, not the Next.js 14 listed in the historical stack table.
Use the local context file to resolve `memory/` references from CLAUDE.md;
those paths refer to Claude's external project memory, not this repository.
If local context is unavailable, continue with shared rules and report
any task-critical missing reference.

Claude Code commands, settings, memory loading, and `PreToolUse` hooks
are not automatically installed or executed by reading these files in
Codex. Follow the local adaptations for available Codex tools.

<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->
