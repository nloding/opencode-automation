# OpenCode Automation

A CLI tool for running multiple OpenCode prompts sequentially, with automatic error detection and early termination on failure.

## What it does

This TypeScript CLI uses the `@opencode-ai/sdk` to run multiple prompts one after another. Each prompt runs in a new session, and sessions are closed after completion. Useful for automating repetitive multi-step tasks.

## Installation

```bash
npm install
```

Also requires OpenCode to be installed and configured.

## Usage

Build the project:
```bash
npm run build
```

Run prompts from command line:
```bash
node dist/cli.js "First prompt" "Second prompt" "Third prompt"
```

Run prompts from a directory (one prompt per file, naturally sorted):
```bash
node dist/cli.js --dir ./prompts-example/
```

Run a single prompt from a file:
```bash
node dist/cli.js --file prompt.txt
```

### Development

Run directly with tsx (no build required):
```bash
npm run dev -- "First prompt" "Second prompt"
npm run dev -- --dir ./prompts-example/
```

### Options

| Flag | Description |
|------|-------------|
| `-d, --dir <path>` | Directory containing prompt files |
| `-f, --file <path>` | Single file containing a prompt |
| `--stop-on-tool-error` | Stop when a tool returns an error (default: continue) |
| `--no-stop-on-sdk-error` | Continue even after SDK/process errors (not recommended) |
| `--tools <list>` | Comma-separated list of allowed tools |
| `--no-tools` | Disable all tools (text-only mode) |
| `--working-dir <path>` | Working directory for OpenCode |
| `--max-turns <number>` | Max agentic turns per prompt |
| `-v, --verbose` | Enable verbose output |

### Default Tools

The following tools are enabled by default:
- `Read` - Read file contents
- `Write` - Write/create files
- `Edit` - Edit existing files
- `Bash` - Run shell commands
- `Glob` - Find files by pattern
- `Grep` - Search file contents

### Error Handling

- **SDK errors** (connection failures, process crashes): Stop by default
- **Tool errors** (test failures, command errors): Continue by default

Use `--stop-on-tool-error` to also stop on tool errors.

### Exit Codes

| Code | Meaning |
|------|---------|
| 0 | All prompts completed successfully |
| 1 | SDK/process error occurred |
| 2 | Tool error occurred (no SDK errors) |

## Prompt Files

Create a directory with numbered files to control execution order:
```
prompts/
  01-analyze.txt
  02-find-todos.txt
  03-check-errors.txt
```

Files are sorted naturally, so `task-9.txt` comes before `task-10.txt`.

Each file contains a single prompt (the entire file content is sent to OpenCode).
