import { Plugin } from "@opencode/plugin"
import { sharedHosting } from "./hosting.ts"
import { CtxHost } from "./opencode/ctx-host.ts"

export default Plugin.define({
  id: "opencode-bridge",
  async setup(ctx) {
    return sharedHosting().register(new CtxHost(ctx), ctx.options)
  },
})
