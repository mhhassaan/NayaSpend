# Agent skill/plugin manifest

This file is a self-contained install list. Any AI coding agent reading this
repo should run the commands below to match the environment this project
expects. Re-run them if a command reports "already installed" — that's fine,
it's idempotent.

## npx-based skills (installed under `.agents/skills/`, symlinked to Claude Code)

```bash
npx skills@latest add emilkowalski/skills
npx skills add mattpocock/skills --skill handoff
```

## Claude Code plugins (installed at user scope via the `claude` CLI)

```bash
claude plugin marketplace add google/elephant-goldfish-model
claude plugin install egm@egm

claude plugin marketplace add ayghri/i-have-adhd
claude plugin install i-have-adhd@i-have-adhd

claude plugin marketplace add obra/superpowers-marketplace
claude plugin install superpowers@superpowers-marketplace
```

Note: `superpowers@claude-plugins-official` (the README's "Option 1") did not
resolve on this install — that marketplace name isn't registered here. Use
the `obra/superpowers-marketplace` route above instead.

## Verify

```bash
claude plugin list
```

## After installing

Start a new Claude Code session so new slash commands/skills
(`/egm:*`, `/i-have-adhd`, `/handoff`, the emilkowalski animation/design
skills, superpowers' bootstrap) register and show up in autocomplete.
