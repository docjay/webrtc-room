export interface IdentityAdapter {
  identity(request: Request): Promise<string | null>;
}
export class ProductionIdentityAdapter implements IdentityAdapter {
  public identity(request: Request): Promise<string | null> {
    // This header is injected by the Sites dispatcher after it has authenticated
    // the visitor. It is deliberately read only in the production adapter:
    // development keeps its loopback-only test seam below.
    const identity = request.headers.get('oai-authenticated-user-id');
    return Promise.resolve(identity && identity.trim() ? identity : null);
  }
}
export class DevelopmentIdentityAdapter implements IdentityAdapter {
  public constructor(private readonly enabled: boolean) {}
  public identity(request: Request): Promise<string | null> {
    const host = new URL(request.url).hostname;
    if (!this.enabled || !['localhost', '127.0.0.1', '::1'].includes(host))
      return Promise.resolve(null);
    return Promise.resolve(request.headers.get('x-dev-identity'));
  }
}
export async function requireOwner(
  request: Request,
  ownerId: string | undefined,
  adapter: IdentityAdapter,
): Promise<boolean> {
  return Boolean(ownerId) && (await adapter.identity(request)) === ownerId;
}
