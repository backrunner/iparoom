import { get } from 'node:https';
export const tlsFetch = (url: string, ca?: Buffer, headers: Record<string, string> = {}) =>
  new Promise<Buffer>((resolve, reject) => {
    get(
      url,
      {
        ca,
        headers,
        family: 4,
        lookup: (_name, _options, callback) => callback(null, '127.0.0.1', 4)
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('error', reject);
        res.on('end', () =>
          res.statusCode === 200
            ? resolve(Buffer.concat(chunks))
            : reject(new Error(`HTTP ${res.statusCode}`))
        );
      }
    ).on('error', reject);
  });
