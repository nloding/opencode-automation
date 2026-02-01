# OpenCode Automation

A CLI tool for running multiple OpenCode prompts sequentially, with automatic error detection and early termination on failure.

## What it does

This TypeScript CLI uses the `@opencode-ai/sdk` to connect to a running OpenCode server and run multiple prompts one after another. Each prompt runs in a new session, and sessions are closed after completion. Useful for automating repetitive multi-step tasks.

## Installation

```bash
npm install
```

Requires an OpenCode server to be running.

## Usage

Build the project:
```bash
npm run build
```

Run prompts from command line:
```bash
node dist/cli.js --url http://localhost:4096 "First prompt" "Second prompt"
```

Run prompts from a directory (one prompt per file, naturally sorted):
```bash
node dist/cli.js --url http://localhost:4096 --dir ./prompts-example/
```

Run a single prompt from a file:
```bash
node dist/cli.js --url http://localhost:4096 --file prompt.txt
```

Connect with password:
```bash
node dist/cli.js --url http://localhost:4096 --password secret --dir ./prompts/
```

### Development

Run directly with tsx (no build required):
```bash
npm run dev -- --url http://localhost:4096 "First prompt" "Second prompt"
npm run dev -- --url http://localhost:4096 --dir ./prompts-example/
```

### Options

| Flag | Description |
|------|-------------|
| `-u, --url <url>` | OpenCode server URL (required) |
| `-p, --password <password>` | OpenCode server password (optional) |
| `-d, --dir <path>` | Directory containing prompt files |
| `-f, --file <path>` | Single file containing a prompt |
| `--stop-on-tool-error` | Stop when a tool returns an error (default: continue) |
| `--no-stop-on-sdk-error` | Continue even after SDK/process errors (not recommended) |
| `--delay <ms>` | Delay between prompts in milliseconds (default: 1000) |
| `-v, --verbose` | Enable verbose output |

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
