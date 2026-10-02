#!/usr/bin/env node
import { Command } from 'commander';
import { configureMcpCommand, runMcp } from '../lib/mcp.mjs';
import { explicitOptions } from '../lib/config.mjs';
const program = configureMcpCommand(new Command().name('iparoom-mcp').version('0.1.0'));
program.action((_options, command) => runMcp(explicitOptions(command)));
try {
  await program.parseAsync(process.argv);
} catch (error) {
  console.error(`iparoom MCP: ${error.message || 'Operation failed'}`);
  process.exitCode = 1;
}
