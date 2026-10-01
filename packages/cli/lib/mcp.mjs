import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { timingSafeEqual } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { createShareSession, portNumber } from './session.mjs';

export function configureMcpCommand(command) {
  return command
    .description('Start an independent IPA Room MCP server')
    .option('--transport <type>', 'MCP transport: stdio or http', 'stdio')
    .option('--host <ipv4>', 'Listening IPv4 address (default: 0.0.0.0)')
    .option('--hostname <name>', 'Hostname or IP used in links and HTTPS certificates')
    .option('--port <number>', 'IPA web server port (default: available port)', '0')
    .option('--mcp-port <number>', 'HTTP MCP port', '3001')
    .option('--cert <pem>', 'HTTPS certificate chain PEM')
    .option('--key <pem>', 'HTTPS private key PEM');
}
function tools(session, status) {
  const server = new McpServer(
    { name: 'iparoom', version: '0.1.0' },
    {
      instructions:
        'Create LAN IPA distribution links from local Xcode-exported files. Links live only while this MCP process runs. HTTP is download-only; HTTPS OTA still requires device trust and eligible signing. Delivery never proves device installation.'
    }
  );
  const run = (callback) => async (args, extra) => {
    try {
      const result = await callback(args, extra);
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        structuredContent: result
      };
    } catch (error) {
      return {
        isError: true,
        content: [{ type: 'text', text: error.message || 'IPA Room operation failed' }]
      };
    }
  };
  const readOnly = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
  server.registerTool(
    'iparoom_create_install_link',
    {
      description:
        'Import a local .ipa file (or directory containing exactly one IPA) and generate installation-page, download, manifest and OTA links using the configured hostname. Does not install the app on a device.',
      inputSchema: {
        path: z.string().min(1).describe('IPA path on the MCP server host; use an absolute path.'),
        notes: z.string().max(2000).optional()
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false
      }
    },
    run(async ({ path, notes }, extra) => ({
      ...(await session.upload(path, notes || '', extra.signal)),
      ...status()
    }))
  );
  server.registerTool(
    'iparoom_list_builds',
    {
      description: "List this MCP process's uploaded builds and current links.",
      inputSchema: {},
      annotations: readOnly
    },
    run(async () => ({ ...(await session.list()), ...status() }))
  );
  server.registerTool(
    'iparoom_get_install_link',
    {
      description: 'Read the current links for a build without rotating its share token.',
      inputSchema: { id: z.string().uuid() },
      annotations: readOnly
    },
    run(async ({ id }) => ({ ...(await session.info(id)), ...status() }))
  );
  server.registerTool(
    'iparoom_revoke_share',
    {
      description:
        'Revoke the current installation page, manifest and download links for a build. Does not uninstall apps or delete the original IPA.',
      inputSchema: { id: z.string().uuid() },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    run(async ({ id }) => ({ ...(await session.revoke(id)), ...status() }))
  );
  server.registerTool(
    'iparoom_server_status',
    {
      description:
        'Read web and MCP endpoints, listening address, configured hostname and session lifetime.',
      inputSchema: {},
      annotations: readOnly
    },
    run(async () => status())
  );
  return server;
}
export async function runMcp(options) {
  if (!['stdio', 'http'].includes(options.transport))
    throw new Error('--transport must be stdio or http.');
  const httpPort = portNumber(options.mcpPort ?? 3001, '--mcp-port');
  const token = process.env.IPAROOM_MCP_TOKEN || '';
  if (options.transport === 'http' && token.length < 24)
    throw new Error('HTTP MCP requires IPAROOM_MCP_TOKEN with at least 24 characters.');
  let session,
    listener,
    listening,
    closing,
    stopped = false,
    mcpUrl = null;
  const servers = new Set(),
    requests = new Set();
  const opening = createShareSession(options);
  const cleanup = () =>
    (closing ??= (async () => {
      stopped = true;
      session = await opening.catch(() => null);
      await listening?.catch(() => {});
      if (listener?.listening)
        await new Promise((resolveClose) => {
          listener.close(resolveClose);
          listener.closeAllConnections();
        });
      await Promise.allSettled([...servers].map((server) => server.close()));
      await session?.close();
      await Promise.allSettled([...requests]);
      process.removeListener('SIGINT', stop);
      process.removeListener('SIGTERM', stop);
      process.stdin.removeListener('end', stop);
    })());
  const stop = () => {
    cleanup().catch((error) => {
      console.error(`iparoom MCP: ${error.message}`);
      process.exitCode = 1;
    });
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  const status = () => ({ ...session.status(), transport: options.transport, mcpUrl });
  try {
    session = await opening;
    if (stopped) return;
    if (options.transport === 'stdio') {
      const server = tools(session, status);
      servers.add(server);
      process.stdin.once('end', stop);
      await server.connect(new StdioServerTransport());
      server.server.onclose = stop;
      console.error(
        `IPA Room MCP stdio ready. IPA server: ${session.origin}; listening on ${session.host}:${session.port}.`
      );
      return;
    }
    const reject = (res, code, message) => {
      res.writeHead(code, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        Connection: 'close'
      });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32000, message } }));
    };
    const allowedNames = new Set([
      session.hostname,
      'localhost',
      '127.0.0.1',
      ...Object.values(networkInterfaces())
        .flat()
        .filter(Boolean)
        .map((item) => item.address)
    ]);
    const serve = async (req, res) => {
      if (stopped) return reject(res, 503, 'MCP server is stopping.');
      const provided = Buffer.from(req.headers.authorization?.replace(/^Bearer /, '') || ''),
        expected = Buffer.from(token);
      if (provided.length !== expected.length || !timingSafeEqual(provided, expected))
        return reject(res, 401, 'A valid MCP Bearer token is required.');
      const allowedHosts = [...allowedNames].map(
        (name) =>
          `${name.includes(':') && !name.startsWith('[') ? `[${name}]` : name}:${listener.address().port}`
      );
      if (!allowedHosts.includes(req.headers.host)) return reject(res, 403, 'Invalid Host.');
      const allowedOrigins = allowedHosts.map(
        (host) => `${session.tls ? 'https' : 'http'}://${host}`
      );
      if (req.headers.origin && !allowedOrigins.includes(req.headers.origin))
        return reject(res, 403, 'Invalid Origin.');
      if (req.url !== '/mcp') return reject(res, 404, 'Use /mcp.');
      if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return reject(res, 405, 'Stateless MCP accepts POST only.');
      }
      if (!req.headers['content-type']?.startsWith('application/json'))
        return reject(res, 415, 'Expected application/json.');
      if (requests.size >= 32) return reject(res, 429, 'MCP server is busy.');
      let body;
      try {
        const bytes = await new Promise((resolveBody, rejectBody) => {
          const chunks = [];
          let size = 0;
          const done = () => {
            req.off('data', data);
            req.off('end', end);
            req.off('error', fail);
            req.off('aborted', aborted);
          };
          const fail = (error) => {
            done();
            rejectBody(error);
          };
          const aborted = () => fail(new Error('Request aborted'));
          const data = (chunk) => {
            size += chunk.length;
            if (size > 65536) {
              req.pause();
              fail(Object.assign(new Error('MCP request exceeds 64 KiB.'), { status: 413 }));
            } else chunks.push(chunk);
          };
          const end = () => {
            done();
            resolveBody(Buffer.concat(chunks));
          };
          req.on('data', data);
          req.once('end', end);
          req.once('error', fail);
          req.once('aborted', aborted);
        });
        body = JSON.parse(bytes.toString('utf8'));
      } catch (error) {
        return reject(
          res,
          error.status === 413 ? 413 : 400,
          error.status === 413 ? error.message : 'Invalid JSON request.'
        );
      }
      const server = tools(session, status),
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
          enableJsonResponse: true,
          enableDnsRebindingProtection: true,
          allowedHosts,
          allowedOrigins
        });
      servers.add(server);
      try {
        await server.connect(transport);
        await transport.handleRequest(req, res, body);
      } finally {
        await server.close();
        servers.delete(server);
      }
    };
    const respond = (req, res) => {
      const pending = serve(req, res);
      requests.add(pending);
      pending
        .catch((error) => {
          console.error(`MCP request failed: ${error.message}`);
          if (!res.headersSent) reject(res, 500, 'MCP request failed.');
          else res.destroy();
        })
        .finally(() => requests.delete(pending));
    };
    listener = session.tls ? createHttpsServer(session.tls, respond) : createHttpServer(respond);
    listening = new Promise((resolveListen, rejectListen) => {
      listener.once('error', rejectListen);
      listener.listen(httpPort, session.host, resolveListen);
    });
    await listening;
    mcpUrl = `${session.tls ? 'https' : 'http'}://${session.hostname}:${listener.address().port}/mcp`;
    if (stopped) {
      await cleanup();
      return;
    }
    console.error(
      `IPA Room MCP HTTP ready: ${mcpUrl}; IPA server: ${session.origin}; listening on ${session.host}.`
    );
  } catch (error) {
    await cleanup();
    throw error;
  }
}
