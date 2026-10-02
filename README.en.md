# IPA Room

LAN-hosted iOS test build distribution with **SvelteKit + Bits UI + SCSS**, a Node.js API, SQLite persistence, and a standalone CLI.

Upload an Xcode-exported IPA to get a shareable installation page, QR code, IPA download URL, and HTTPS `itms-services` manifest. Links can be revoked or rotated. The dashboard includes upload progress, metadata, release notes, search, signing filters, and build deletion.

Expand link management in the share dialog to rotate or revoke a link; use the row menu to delete a build. Bits UI controls support keyboard interaction, system dark appearance and mobile layouts, with installation requirements and help collapsed by default.

## Run locally

Requires Node.js 24+ and pnpm 12.

```sh
pnpm install
cp .env.example .env
# Set a random IPAROOM_ADMIN_TOKEN of at least 24 characters.
pnpm dev
```

Open the private LAN URL printed at startup (for example http://192.168.1.10:5173) and sign in with the configured admin token. Management APIs require a session or Bearer token. Sessions expire after seven days and are invalidated by token rotation.

```sh
pnpm check
pnpm test
pnpm build
pnpm exec playwright install chromium
pnpm test:e2e
pnpm start
```

`pnpm dev` and `pnpm start` load `.env` and default to `0.0.0.0` (all IPv4 interfaces). Ports default to 5173 and 3000; override with `PORT`. `IPAROOM_LAN_HOST` restricts binding to a local IPv4 address. `IPAROOM_HOSTNAME` selects the DNS name/IP in share links, independently of binding. Otherwise links use an automatically selected private LAN IPv4, or loopback if none is available. `IPAROOM_BASE_URL` overrides the advertised origin for HTTPS reverse proxies. Explicit localhost origins are preserved for local testing; wildcard addresses cannot be used in links. `IPAROOM_PUBLIC_URL` remains a compatibility alias. Restart after address changes.

## CLI

Build and install the standalone package, including the compiled web server:

```sh
pnpm pack:cli
npm install -g ./dist/iparoom-cli-0.1.0.tgz
iparoom ./MyApp.ipa
```

The direct-file command runs from any directory. It listens on all IPv4 interfaces, selects a private LAN address for links and an available port, imports the IPA, opens its installation page, and prints its URL and terminal QR code. No server setup or login is needed. Press Ctrl+C to stop the temporary server and remove its private IPA copy; the original file stays untouched. Share links stop working when the process exits. This mode ignores project `.env` files and saved remote credentials.

```sh
iparoom "/path/App with spaces.ipa" --notes "Regression build"
iparoom ./exports --no-open --json
iparoom ./MyApp.ipa --hostname ipa.lan --port 8443 --cert ./server.crt --key ./server.key
```

HTTP provides the page and download. iOS OTA requires a certificate matching the advertised hostname and trusted by the device. `--host` defaults to `0.0.0.0`, or can select a local IPv4. `--hostname` sets the advertised DNS name/IP; devices must resolve it to the server. Certificate hostname/key mismatches are rejected; `--port` defaults to 0 for automatic allocation. `--no-open` suppresses browser launch. `--json` prints startup metadata without the terminal QR code. Node.js 24+ is required. Xcode is only required for archive export, not serving exported IPA files. The package has not been published to npm.

To use an existing persistent server:

```sh
iparoom login --server https://192.168.1.10:8443
iparoom upload ./exports/MyApp.ipa --notes "Regression build"
iparoom export ./MyApp.xcarchive --options ./ExportOptions.plist --output ./exports
iparoom list --json
iparoom info <id> --json
iparoom share <id> --revoke
iparoom share <id> # Rotate the share link.
iparoom delete <id> --yes
iparoom logout
```

Login prompts for a hidden token. CI can inject `IPAROOM_SERVER` and `IPAROOM_TOKEN` and skip login. Credentials are stored with mode 0600 in `~/.config/iparoom/config.json`; override with `IPAROOM_CONFIG_DIR`. JSON goes to stdout, diagnostics and Xcode logs to stderr. Failures exit with code 1. Directory upload requires exactly one IPA. Tokens are never CLI arguments; authenticated requests do not follow redirects.

From source, use `pnpm cli ...`. For `npm link`, first run `pnpm build:cli`. `export` refuses output directories that already contain an IPA to prevent stale uploads; use a fresh export directory. It invokes `xcodebuild -exportArchive`; Xcode manages accounts, certificates, provisioning, and ExportOptions.plist.

## Independent MCP

The package exposes both `iparoom mcp` and the standalone `iparoom-mcp` executable. It starts its own temporary IPA web server, without an existing service or remote login. Default stdio sends only MCP protocol messages to stdout and logs to stderr.

```sh
iparoom-mcp --hostname ipa.lan --port 8443 --cert ./server.crt --key ./server.key
```

Generic agent configuration (replace certificate paths):

```json
{
  "mcpServers": {
    "iparoom": {
      "command": "iparoom-mcp",
      "args": [
        "--hostname",
        "ipa.lan",
        "--port",
        "8443",
        "--cert",
        "/path/server.crt",
        "--key",
        "/path/server.key"
      ]
    }
  }
}
```

Tools: `iparoom_create_install_link` accepts a local `path` and optional `notes`; `iparoom_list_builds` lists session builds; `iparoom_get_install_link` reads existing links by `id`; `iparoom_revoke_share` revokes them; `iparoom_server_status` reports endpoints and binding. Results include structured metadata, URLs, SHA-256, and unverified device-installation status. One process supports multiple IPAs. The path belongs to the MCP host, not the remote caller's computer.

`--host` defaults to `0.0.0.0`; `--hostname` sets all advertised page, manifest and IPA URLs. `--port` controls the IPA server and defaults to an available port. EOF, SIGINT or SIGTERM closes the servers and deletes temporary copies; original IPAs are preserved. Keep MCP running while testers use its links. No browser opens automatically.

For LAN clients, use stateless Streamable HTTP:

```sh
# Inject IPAROOM_MCP_TOKEN (at least 24 characters) through the environment.
iparoom-mcp --transport http --hostname ipa.lan --mcp-port 3001
```

Connect to `http://ipa.lan:3001/mcp` with `Authorization: Bearer <IPAROOM_MCP_TOKEN>`. `--mcp-port` is independent of the IPA web port. Supplying `--cert/--key` enables HTTPS on both ports. Host/Origin checks and a 64 KiB JSON limit apply. Stdio requires no MCP token. Independent CLI/MCP modes do not load project `.env` files; pass flags or environment values. HTTP still provides download-only IPA delivery; OTA requires trusted HTTPS and eligible signing.

### Add it to an agent client

After installing the CLI package, add a user-level stdio MCP:

```sh
codex mcp add iparoom -- iparoom-mcp
claude mcp add --scope user --transport stdio iparoom -- iparoom-mcp
gemini mcp add --scope user --transport stdio iparoom iparoom-mcp
```

GUI clients may not inherit your terminal's nvm/PATH. In that case, use an absolute Node 24+ path as `command` and the installed package's absolute `bin/iparoom-mcp.mjs` path in `args`, followed by hostname/certificate flags when needed. Refresh MCP or start a new client session and verify all five tools. Gemini enables servers only in trusted directories; retain existing tool approval and directory trust settings.

## Agent skill

The companion [`iparoom-install`](./skills/iparoom-install/SKILL.md) skill guides agents through Xcode export, direct/persistent LAN distribution, internal HTTPS trust, file integrity checks, and device installation evidence.

```sh
iparoom skill install
iparoom skill install --path /path/to/agent/skills --json
# Install directly from the source repository:
pnpm skill:install
```

The default destination is `$CODEX_HOME/skills` or `~/.codex/skills`. `--path` selects the parent skills directory. Invoke `$iparoom-install` in a new skill-enabled agent task; automatic discovery stays enabled. The bundled Python 3 stdlib script checks pages, HEAD/Range downloads, HTTPS plist manifests, and SHA-256. It does not equate delivery with device installation. Identical installs are idempotent; differing local skills are preserved rather than overwritten.

## LAN deployment

For HTTP management and downloads, configure `.env`:

```dotenv
IPAROOM_LAN_HOST=0.0.0.0
IPAROOM_HOSTNAME=192.168.1.10
IPAROOM_BASE_URL=http://192.168.1.10:3000
```

```sh
docker compose up -d --build
```

Replace the example IP with an address assigned to the server. Ports default to all IPv4 interfaces; IPAROOM_LAN_HOST can restrict them. No public domain or router port forwarding is needed. HTTP cannot provide iOS OTA installation.

For device installation, use the supplied Caddy internal CA overlay (Docker Compose 2.24.4+):

```sh
docker compose -f compose.yaml -f compose.https.yaml up -d --build
mkdir -p certs
docker compose -f compose.yaml -f compose.https.yaml cp \
  caddy:/data/caddy/pki/authorities/local/root.crt ./certs/iparoom-root.crt
```

The overlay closes the backend host port and serves `https://192.168.1.10:8443` on the configured listening address. Set `IPAROOM_HOSTNAME=ipa.lan` to issue a certificate for a DNS name that devices can resolve. It uses `tls internal`, with no public ACME issuer. After Caddy generates its CA, distribute only the root certificate to your test devices through AirDrop, Configurator, or MDM. For manual installation, enable full trust under Settings → General → About → Certificate Trust Settings, then open the HTTPS page in Safari. Keep CA private keys and volumes on the server.

Node CLI clients can trust the CA using `NODE_EXTRA_CA_CERTS=./certs/iparoom-root.crt`. An existing organizational CA/reverse proxy can be used instead. Certificates must match the actual IP or internal hostname; ignoring browser warnings is insufficient.

The startup scripts default `BODY_SIZE_LIMIT` to the application upload limit; an explicit value overrides it. Configure `IPAROOM_MAX_UPLOAD_BYTES` or `IPAROOM_DATA_DIR`. Deploy one instance and back up SQLite plus IPA files. Share URLs must be reachable from the same LAN; Wi-Fi client isolation can block access.

References: [Caddy local HTTPS](https://caddyserver.com/docs/automatic-https#local-https), [Apple certificate trust](https://support.apple.com/en-us/102390).

## Installation boundaries

OTA requires device-reachable LAN HTTPS with a certificate trusted by iOS. Open the installation page in iPhone/iPad Safari on the same LAN. Hosting remains private, although some signing validation may still require device access to Apple services. Ad Hoc and development provisioning usually require the device UDID in the profile; enterprise use is governed by Apple's Enterprise Program. App Store packages should be distributed through TestFlight or the App Store.

Provisioning metadata is a hint, not cryptographic signature verification. The service does not sign or re-sign applications. Expired, unknown, App Store, or HTTP-only builds show download access without an OTA button. A distribution URL does not create a remote LLDB connection; live debugging still requires an Xcode-supported device connection.

For a path without web HTTPS, download the IPA over LAN HTTP to a Mac and install it on an authorized connected device with Xcode / Device Hub or Apple Configurator. See the bilingual [device installation options](./skills/iparoom-install/references/nonhttps-installation.md). Automatic `iparoom devices` / `iparoom install` commands are proposed and not yet implemented.

Share URLs provide access to anyone who possesses them. Revocation and rotation invalidate the old page, manifest, and download URLs for future requests. Downloads already in progress and apps already installed are unaffected.

Tests use synthetic IPA fixtures, including binary Info.plist files. They verify API, CLI, browser, manifests, download integrity, byte ranges, and revocation. Fixtures are not signed installable apps; real-device OTA validation needs a valid signed IPA, trusted LAN HTTPS, and an eligible device.

See [Apple wireless distribution](https://support.apple.com/en-gb/guide/deployment/depce7cefc4d/1/web), [SvelteKit Node deployment](https://svelte.dev/docs/kit/adapter-node), and [Chinese API/configuration documentation](./README.md).
