import type {
  ProviderAdapter,
  ProviderConnectionResult,
  ProviderContext,
  ProviderHealth,
} from "./contracts";

export class MockProviderAdapter implements ProviderAdapter {
  readonly key: string;

  constructor(key: string) {
    this.key = key;
  }

  async connect(
    context: ProviderContext,
    authorizationCode: string,
  ): Promise<ProviderConnectionResult> {
    void authorizationCode;
    return {
      providerAccountId: `mock_${context.tenantId}_${this.key}`,
      displayName: `${this.key} development connection`,
      connectedAt: new Date().toISOString(),
    };
  }

  async disconnect(context: ProviderContext): Promise<void> {
    void context;
    return;
  }

  async refresh(context: ProviderContext): Promise<void> {
    void context;
    return;
  }

  async healthCheck(context: ProviderContext): Promise<ProviderHealth> {
    void context;
    return {
      status: "healthy",
      checkedAt: new Date().toISOString(),
      message: "Mock provider is operating normally.",
      latencyMs: 0,
    };
  }
}
