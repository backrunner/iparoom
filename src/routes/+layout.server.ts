import { runtimeEnvironment } from '$lib/server/config';
export const load = () => {
  const env = runtimeEnvironment();
  return {
    certificateInstallUrl:
      env.IPAROOM_CA_INSTALL_URL || (env.IPAROOM_CA_CERT || env.IPAROOM_CA_ROOT_URL ? '/ca' : null)
  };
};
