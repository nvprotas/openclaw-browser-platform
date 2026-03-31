export async function runCli(args: string[]): Promise<number> {
  if (args.includes('--help') || args.includes('-h') || args.length === 0) {
    printHelp();
    return 0;
  }

  if (args.includes('--version') || args.includes('-v')) {
    console.log('0.1.0');
    return 0;
  }

  console.error(`Unknown command: ${args.join(' ')}`);
  printHelp();
  return 1;
}

function printHelp(): void {
  console.log(`browser-platform\n\nUsage:\n  browser-platform [command]\n\nPlanned commands:\n  daemon ensure --json\n  daemon status --json\n  daemon stop --json\n  session open --url <url> --json\n  session context --session <id> --json\n  session close --session <id> --json`);
}
