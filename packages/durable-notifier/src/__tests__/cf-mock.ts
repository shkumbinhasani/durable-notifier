// Mock for cloudflare:workers — provides a stub DurableObject base class
export class DurableObject {
  ctx: any;
  env: any;
  constructor(ctx?: any, env?: any) {
    this.ctx = ctx;
    this.env = env;
  }
}
