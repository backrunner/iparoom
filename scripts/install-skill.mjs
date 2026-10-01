import { fileURLToPath } from 'node:url';
import { installSkill } from '../packages/cli/lib/skill.mjs';
const source = fileURLToPath(new URL('../skills/iparoom-install', import.meta.url));
console.log(JSON.stringify(await installSkill(source), null, 2));
