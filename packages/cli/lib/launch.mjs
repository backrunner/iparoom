import { spawn } from 'node:child_process';
import QRCode from 'qrcode';
import { createShareSession } from './session.mjs';
function openBrowser(url) {
  const command =
    process.platform === 'darwin'
      ? 'open'
      : process.platform === 'win32'
        ? 'rundll32.exe'
        : 'xdg-open';
  const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
  const child = spawn(command, args, { stdio: 'ignore' });
  child.on('error', () => console.error(`Could not open browser automatically. Open ${url}`));
  child.on('exit', (code) => {
    if (code) console.error(`Could not open browser automatically. Open ${url}`);
  });
}
export async function launch(file, options) {
  const abort = new AbortController();
  let session,
    closing,
    stopped = false;
  const opening = createShareSession(options);
  const cleanup = () =>
    (closing ??= (async () => {
      stopped = true;
      abort.abort();
      session = await opening.catch(() => null);
      await session?.close();
    })());
  const stop = () => {
    cleanup().catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    session = await opening;
    if (stopped) return;
    const result = await session.upload(file, options.notes || '', abort.signal);
    if (stopped) return;
    if (options.json) console.log(JSON.stringify({ ...result, ...session.status() }, null, 2));
    else {
      console.log(
        `${result.build.name} ${result.build.version} (${result.build.buildNumber})\nInstall page: ${result.build.installUrl}\nDownload: ${result.build.downloadUrl}`
      );
      console.log(
        await QRCode.toString(result.build.installUrl, { type: 'terminal', small: true })
      );
    }
    console.error(
      `Sharing on ${session.origin} (listening on ${session.host}:${session.port}). Press Ctrl+C to stop; temporary IPA data will be removed.`
    );
    if (!session.tls)
      console.error(
        'HTTP provides the page and download. iOS OTA needs --cert/--key with a certificate trusted by the device.'
      );
    if (options.open !== false) openBrowser(result.build.installUrl);
  } catch (error) {
    const interrupted = stopped;
    await cleanup();
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    if (!interrupted) throw error;
  }
}
