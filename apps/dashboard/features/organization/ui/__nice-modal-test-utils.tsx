import type { FC } from "react";
import { act, render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import NiceModal, { type NiceModalHocProps } from "@ebay/nice-modal-react";

/**
 * Shared harness for testing `NiceModal.create(...)` components: mounts a
 * fresh `QueryClient` + `NiceModal.Provider`, then drives the modal via the
 * real `NiceModal.show(...)` imperative API (not a directly-rendered
 * component), matching how the app actually opens these modals.
 */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

export function renderNiceModalHost(queryClient: QueryClient): void {
  render(
    <QueryClientProvider client={queryClient}>
      <NiceModal.Provider>
        <div data-testid="nice-modal-host" />
      </NiceModal.Provider>
    </QueryClientProvider>,
  );
}

/** Mounts the host tree then imperatively shows `Modal` with `props`. */
export async function showNiceModal<P extends object, R = unknown>(
  Modal: FC<P & NiceModalHocProps>,
  props: P,
  queryClient: QueryClient = createTestQueryClient(),
): Promise<{ queryClient: QueryClient; result: Promise<R> }> {
  renderNiceModalHost(queryClient);
  let resultPromise!: Promise<R>;
  await act(async () => {
    resultPromise = NiceModal.show(Modal, props) as Promise<R>;
  });
  return { queryClient, result: resultPromise };
}
