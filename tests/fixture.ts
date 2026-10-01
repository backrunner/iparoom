import { ZipFile } from 'yazl';
import * as plist from 'plist';
export async function fixture(
  options: {
    profile?: boolean;
    malformed?: boolean;
    extraApp?: boolean;
    binary?: Buffer;
    padding?: number;
  } = {}
) {
  const zip = new ZipFile();
  const info = {
    CFBundlePackageType: 'APPL',
    CFBundleIdentifier: 'dev.iparoom.fixture',
    CFBundleDisplayName: '测试 & Demo',
    CFBundleShortVersionString: '1.2.0',
    CFBundleVersion: '42',
    MinimumOSVersion: '16.0'
  };
  zip.addBuffer(
    options.binary ?? Buffer.from(options.malformed ? 'invalid' : plist.build(info)),
    'Payload/Fixture.app/Info.plist'
  );
  if (options.extraApp)
    zip.addBuffer(Buffer.from(plist.build(info)), 'Payload/Other.app/Info.plist');
  if (options.profile !== false)
    zip.addBuffer(
      Buffer.from(
        'CMS-FIXTURE' +
          plist.build({
            ProvisionedDevices: ['fixture-udid'],
            Entitlements: { 'get-task-allow': false },
            ExpirationDate: new Date('2030-01-01')
          }) +
          'END'
      ),
      'Payload/Fixture.app/embedded.mobileprovision'
    );
  zip.addBuffer(
    Buffer.from('This is a metadata test fixture, not a signed installable application.'),
    'Payload/Fixture.app/Fixture'
  );
  if (options.padding)
    zip.addBuffer(Buffer.alloc(options.padding), 'Payload/Fixture.app/padding', {
      compress: false
    });
  zip.end();
  const chunks: Buffer[] = [];
  for await (const chunk of zip.outputStream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}
