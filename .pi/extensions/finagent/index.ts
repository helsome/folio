import { registerTools } from '../../../packages/pi-extension/src/index.ts';

export default function finagentExtension(pi: Parameters<typeof registerTools>[0]) {
  registerTools(pi);
}
