/**
 * Standalone build config for the dsh-weixin plugin. In this monorepo the
 * client-bundle preset is shared with dsh-pet-maid from ../../shared.
 *
 * The preset emits the node-half lib/ (host Weixin engine + bridge + routes +
 * tools) plus the browser bundle lib/client.js. The client entry is
 * auto-detected at src/client/index.ts. `weixin-agent-sdk` and its
 * `qrcode-terminal` dependency are bundled into the node half; the
 * @deepseek-ai/* SDK packages stay external (resolved from the host profile).
 */
import { clientBundle } from '../../shared/tsdown.client.ts'

export default clientBundle('@deepseek-ai/dsh-weixin', ['src/index.ts', 'src/invariant.ts'], {
  libExternal: [
    '@deepseek-ai/dsh-agent',
    '@deepseek-ai/dsh-host-webserver',
    '@deepseek-ai/dsh-settings',
    '@deepseek-ai/dsh-system-prompt',
    '@deepseek-ai/dsh-tools',
    '@deepseek-ai/dsh-llm',
    '@deepseek-ai/dsh-session',
  ],
})
