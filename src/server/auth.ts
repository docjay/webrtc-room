export interface IdentityAdapter {
  identity(request: Request): Promise<string | null>;
}
export class ProductionIdentityAdapter implements IdentityAdapter {
  public identity(_request: Request): Promise<string | null> {
    void _request;
    return Promise.resolve(null);
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
