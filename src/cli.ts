#!/usr/bin/env node
/**
 * OpenCode Automation CLI
 *
 * A CLI tool for running multiple OpenCode prompts sequentially,
 * with automatic error detection and early termination on failure.
 */

import { createOpencodeClient } from "@opencode-ai/sdk";
import { Command } from "commander";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, basename } from "node:path";
import { orderBy } from "natural-orderby";

// Error types for distinguishing SDK crashes from tool errors
const ERROR_TYPE_NONE = "none";
const ERROR_TYPE_TOOL = "tool"; // A tool returned an error (e.g., test failure)
const ERROR_TYPE_SDK = "sdk"; // SDK/process crash - always fatal

type ErrorType = typeof ERROR_TYPE_NONE | typeof ERROR_TYPE_TOOL | typeof ERROR_TYPE_SDK;

interface RunPromptResult {
  success: boolean;
  errorType: ErrorType;
  resultText: string;
}

interface PromptEntry {
  name: string;
  content: string;
}

interface RunOptions {
  verbose: boolean;
}

// Type for the OpenCode client
type OpencodeClient = ReturnType<typeof createOpencodeClient>;

/**
 * Extract detailed error information from an error, including nested causes.
 * Node.js fetch errors often have a `cause` with the real error details.
 */
function formatErrorDetails(err: unknown, verbose: boolean): string {
  const parts: string[] = [];

  function extractError(e: unknown, depth: number): void {
    if (depth > 3) return;

    if (e instanceof Error) {
      parts.push(depth === 0 ? e.message : `Caused by: ${e.message}`);

      // Node.js system error properties (ECONNREFUSED, etc.)
      const sysErr = e as { code?: string; syscall?: string; hostname?: string; port?: number };
      if (sysErr.code) parts.push(`  Code: ${sysErr.code}`);
      if (sysErr.syscall) parts.push(`  Syscall: ${sysErr.syscall}`);
      if (sysErr.hostname) parts.push(`  Host: ${sysErr.hostname}:${sysErr.port ?? ""}`);

      // Recurse into cause
      if ("cause" in e && e.cause) {
        extractError(e.cause, depth + 1);
      }

      if (verbose && depth === 0) {
        console.log(`  [DEBUG] Exception type: ${e.constructor.name}`);
        console.log(`  [DEBUG] Message: ${e.message}`);
        if ("cause" in e && e.cause) {
          console.log(`  [DEBUG] Cause:`, e.cause);
        }
      }
    } else if (e !== null && typeof e === "object") {
      parts.push(JSON.stringify(e));
    } else {
      parts.push(String(e));
    }
  }

  extractError(err, 0);
  return parts.join("\n  ");
}

/**
 * Run a single prompt and detect success/failure.
 * Each prompt runs in a new session.
 */
async function runPrompt(
  client: OpencodeClient,
  prompt: string,
  options: RunOptions
): Promise<RunPromptResult> {
  const { verbose } = options;
  let sessionId: string | undefined;

  try {
    // Create a new session for this prompt
    const sessionResponse = await client.session.create({
      body: { title: `Prompt: ${prompt.slice(0, 50)}...` },
    });

    // Handle SDK response structure
    if (sessionResponse.error || !sessionResponse.data) {
      const errorMsg = sessionResponse.error
        ? JSON.stringify(sessionResponse.error)
        : "Failed to create session";
      return {
        success: false,
        errorType: ERROR_TYPE_SDK,
        resultText: `Session creation failed: ${errorMsg}`,
      };
    }

    sessionId = sessionResponse.data.id;

    if (verbose) {
      console.log(`  [DEBUG] Created session: ${sessionId}`);
    }

    // Send the prompt
    const promptResponse = await client.session.prompt({
      path: { id: sessionId },
      body: {
        parts: [{ type: "text", text: prompt }],
      },
    });

    if (verbose) {
      console.log(
        `  [DEBUG] Prompt result:`,
        JSON.stringify(promptResponse, null, 2).slice(0, 500)
      );
    }

    // Check for errors in the response
    if (promptResponse.error) {
      const errorMessage = JSON.stringify(promptResponse.error);
      return {
        success: false,
        errorType: ERROR_TYPE_TOOL,
        resultText: errorMessage,
      };
    }

    // Extract result text from the response data
    let resultText = "";
    const data = promptResponse.data;
    if (data && typeof data === "object") {
      // Try common response fields
      if ("text" in data && data.text) {
        resultText = String(data.text);
      } else if ("content" in data && data.content) {
        resultText = String(data.content);
      } else if ("message" in data && data.message) {
        resultText = String(data.message);
      } else if ("result" in data && data.result) {
        resultText = String(data.result);
      } else {
        resultText = JSON.stringify(data);
      }
    } else {
      resultText = JSON.stringify(promptResponse);
    }

    return {
      success: true,
      errorType: ERROR_TYPE_NONE,
      resultText,
    };
  } catch (err) {
    const errorMessage = formatErrorDetails(err, verbose);

    return {
      success: false,
      errorType: ERROR_TYPE_SDK,
      resultText: `SDK Error: ${errorMessage}`,
    };
  } finally {
    // Close the session after the prompt completes
    if (sessionId) {
      try {
        await client.session.delete({ path: { id: sessionId } });
        if (verbose) {
          console.log(`  [DEBUG] Closed session: ${sessionId}`);
        }
      } catch {
        // Ignore session cleanup errors
      }
    }
  }
}

interface SequentialRunOptions extends RunOptions {
  stopOnSdkError: boolean;
  stopOnToolError: boolean;
}

interface RunSummary {
  completed: number;
  toolErrors: number;
  sdkErrors: number;
}

/**
 * Run multiple prompts sequentially using the provided client.
 */
async function runPromptsSequential(
  client: OpencodeClient,
  prompts: PromptEntry[],
  options: SequentialRunOptions
): Promise<RunSummary> {
  const { stopOnSdkError, stopOnToolError, verbose } = options;

  let completed = 0;
  let toolErrors = 0;
  let sdkErrors = 0;

  for (let i = 0; i < prompts.length; i++) {
    const { name, content } = prompts[i];
    const promptNum = i + 1;

    console.log(`\n[${promptNum}/${prompts.length}] Running: ${name}`);
    console.log(`  ${content.slice(0, 80)}${content.length > 80 ? "..." : ""}`);
    console.log("-".repeat(60));

    const result = await runPrompt(client, content, { verbose });

    // Print result (truncated if very long)
    if (result.resultText) {
      const displayText =
        result.resultText.length > 500
          ? result.resultText.slice(0, 500) + "..."
          : result.resultText;
      console.log(`\nResult:\n${displayText}`);
    }

    if (result.errorType === ERROR_TYPE_SDK) {
      sdkErrors++;
      console.log(`\n[SDK ERROR] ${name} failed due to SDK/process error.`);
      if (stopOnSdkError) {
        console.log("Stopping due to SDK error (always fatal).");
        break;
      }
    } else if (result.errorType === ERROR_TYPE_TOOL) {
      toolErrors++;
      console.log(
        `\n[TOOL ERROR] ${name} completed but a tool reported an error (e.g., test failure).`
      );
      if (stopOnToolError) {
        console.log("Stopping due to tool error (--stop-on-tool-error is enabled).");
        break;
      } else {
        // Tool errors are non-fatal by default, count as completed
        completed++;
      }
    } else {
      completed++;
      console.log(`\n[OK] ${name} completed successfully.`);
    }
  }

  return { completed, toolErrors, sdkErrors };
}

/**
 * Load a single prompt from a file.
 */
function loadPromptFromFile(filepath: string): string {
  return readFileSync(filepath, "utf-8").trim();
}

/**
 * Load prompts from all files in a directory, sorted naturally.
 */
function loadPromptsFromDirectory(dirpath: string): PromptEntry[] {
  const entries = readdirSync(dirpath);

  // Filter to files only and sort naturally (so task-9 comes before task-10)
  const files = entries.filter((entry) => {
    const fullPath = resolve(dirpath, entry);
    return statSync(fullPath).isFile();
  });

  const sortedFiles = orderBy(files);

  const prompts: PromptEntry[] = [];
  for (const file of sortedFiles) {
    const fullPath = resolve(dirpath, file);
    const content = loadPromptFromFile(fullPath);
    if (content) {
      prompts.push({ name: file, content });
    }
  }

  return prompts;
}

/**
 * Main CLI entry point.
 */
async function main(): Promise<void> {
  const program = new Command();

  program
    .name("opencode-automation")
    .description("Run OpenCode prompts sequentially with error detection.")
    .argument("[prompts...]", "Prompts to run (if not using --file or --dir)")
    .requiredOption("-u, --url <url>", "OpenCode server URL (e.g., http://localhost:4096)")
    .option("-p, --password <password>", "OpenCode server password")
    .option("-d, --dir <path>", "Directory containing prompt files")
    .option("-f, --file <path>", "Single file containing a prompt")
    .option(
      "--stop-on-tool-error",
      "Stop execution when a tool returns an error",
      false
    )
    .option(
      "--no-stop-on-sdk-error",
      "Continue execution even after SDK/process errors (not recommended)"
    )
    .option("-v, --verbose", "Enable verbose output", false)
    .addHelpText(
      "after",
      `
Examples:
  # Run prompts from command line
  npx tsx src/cli.ts --url http://localhost:4096 "First prompt" "Second prompt"

  # Run prompts from a directory (one prompt per file, alphabetical order)
  npx tsx src/cli.ts --url http://localhost:4096 --dir ./prompts/

  # Run a single prompt from a file
  npx tsx src/cli.ts --url http://localhost:4096 --file prompt.txt

  # Connect with password
  npx tsx src/cli.ts --url http://localhost:4096 --password secret --dir ./prompts/

  # Stop if a tool returns an error
  npx tsx src/cli.ts --url http://localhost:4096 --dir ./prompts/ --stop-on-tool-error

Error handling:
  - SDK errors (connection failures, process crashes): Always stop by default
  - Tool errors (test failures, command errors): Continue by default
  Use --stop-on-tool-error to also stop on tool errors.
`
    );

  program.parse();

  const opts = program.opts<{
    url: string;
    password?: string;
    dir?: string;
    file?: string;
    stopOnToolError: boolean;
    stopOnSdkError: boolean;
    verbose: boolean;
  }>();
  const args = program.args;

  // Collect prompts
  let prompts: PromptEntry[] = [];

  if (opts.dir) {
    const dirPath = resolve(opts.dir);
    try {
      const stat = statSync(dirPath);
      if (!stat.isDirectory()) {
        console.error(`Error: Not a directory: ${opts.dir}`);
        process.exit(1);
      }
    } catch {
      console.error(`Error: Directory not found: ${opts.dir}`);
      process.exit(1);
    }
    prompts = loadPromptsFromDirectory(dirPath);
  } else if (opts.file) {
    const filePath = resolve(opts.file);
    try {
      statSync(filePath);
    } catch {
      console.error(`Error: File not found: ${opts.file}`);
      process.exit(1);
    }
    const content = loadPromptFromFile(filePath);
    if (content) {
      prompts = [{ name: basename(filePath), content }];
    }
  } else if (args.length > 0) {
    prompts = args.map((p, i) => ({ name: `prompt-${i + 1}`, content: p }));
  } else {
    program.help();
    process.exit(1);
  }

  if (prompts.length === 0) {
    console.error("Error: No prompts found.");
    process.exit(1);
  }

  // Parse options
  const stopOnSdkError = opts.stopOnSdkError !== false;
  const stopOnToolError = opts.stopOnToolError;

  console.log(`Connecting to OpenCode server: ${opts.url}`);
  console.log(`Running ${prompts.length} prompt(s) sequentially...`);
  console.log(`  Stop on SDK error: ${stopOnSdkError}`);
  console.log(`  Stop on tool error: ${stopOnToolError}`);

  // Create client to connect to existing OpenCode server
  const clientConfig: { baseUrl: string; password?: string } = {
    baseUrl: opts.url,
  };
  if (opts.password) {
    clientConfig.password = opts.password;
  }
  const client = createOpencodeClient(clientConfig);

  // Run prompts
  const { completed, toolErrors, sdkErrors } = await runPromptsSequential(
    client,
    prompts,
    {
      stopOnSdkError,
      stopOnToolError,
      verbose: opts.verbose,
    }
  );

  // Summary
  console.log("\n" + "=".repeat(60));
  console.log("SUMMARY");
  console.log("=".repeat(60));
  console.log(`  Total prompts: ${prompts.length}`);
  console.log(`  Completed: ${completed}`);
  console.log(`  Tool errors: ${toolErrors}`);
  console.log(`  SDK errors: ${sdkErrors}`);

  // Exit code: 1 for SDK errors, 2 for tool errors only, 0 for success
  if (sdkErrors > 0) {
    process.exit(1);
  } else if (toolErrors > 0) {
    process.exit(2);
  } else {
    process.exit(0);
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
