import { describe, expect, it, vi } from "vitest";
import {
  WorkspaceRetrievalService,
  type RetrievalSearch,
} from "./WorkspaceRetrievalService.js";

function deferred(): {
  promise: Promise<void>;
  resolve: () => void;
} {
  let resolvePromise = (): void => undefined;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

function fakeSearch(name: string): RetrievalSearch & { name: string } {
  return {
    name,
    load: vi.fn(async () => undefined),
    search: vi.fn(async () => []),
  };
}

describe("WorkspaceRetrievalService", () => {
  it("coalesces cold preparation until one complete snapshot is ready", async () => {
    const firstIndex = deferred();
    const index = {
      index: vi.fn(() => firstIndex.promise),
      getRepoMapText: vi.fn(async () => "repo-map"),
    };
    const search = fakeSearch("generation-1");
    const service = new WorkspaceRetrievalService("C:/workspace", {
      createIndex: () => index,
      createSearch: () => search,
    });

    const warm = service.warm();
    const left = service.prepare();
    const right = service.prepare();
    await Promise.resolve();
    expect(index.index).toHaveBeenCalledOnce();
    expect(search.load).not.toHaveBeenCalled();

    firstIndex.resolve();
    await expect(warm).resolves.toBeUndefined();
    await expect(left).resolves.toMatchObject({
      search,
      repoMap: "repo-map",
      generation: 1,
    });
    await expect(right).resolves.toMatchObject({ search, generation: 1 });
    expect(search.load).toHaveBeenCalledOnce();
  });

  it("serves the last snapshot while a coalesced background refresh runs", async () => {
    let now = 0;
    const background = deferred();
    const index = {
      index: vi
        .fn<[], Promise<void>>()
        .mockResolvedValueOnce(undefined)
        .mockReturnValueOnce(background.promise)
        .mockResolvedValueOnce(undefined),
      getRepoMapText: vi.fn(async () => "repo-map"),
    };
    const firstSearch = fakeSearch("generation-1");
    const secondSearch = fakeSearch("generation-2");
    const thirdSearch = fakeSearch("generation-3");
    const createSearch = vi
      .fn<[], RetrievalSearch>()
      .mockReturnValueOnce(firstSearch)
      .mockReturnValueOnce(secondSearch)
      .mockReturnValueOnce(thirdSearch);
    const service = new WorkspaceRetrievalService("C:/workspace", {
      now: () => now,
      refreshIntervalMs: 10,
      createIndex: () => index,
      createSearch,
    });

    await expect(service.prepare()).resolves.toMatchObject({
      search: firstSearch,
      generation: 1,
    });
    now = 11;
    await expect(service.prepare()).resolves.toMatchObject({
      search: firstSearch,
      generation: 1,
      refreshing: true,
    });
    await expect(service.prepare()).resolves.toMatchObject({
      search: firstSearch,
      generation: 1,
      refreshing: true,
    });
    expect(index.index).toHaveBeenCalledTimes(2);

    service.invalidate();
    background.resolve();
    await service.settle();
    await expect(service.prepare()).resolves.toMatchObject({
      search: thirdSearch,
      generation: 3,
    });
    expect(index.index).toHaveBeenCalledTimes(3);
  });

  it("does not turn an elapsed freshness interval into shutdown work", async () => {
    let now = 0;
    const index = {
      index: vi.fn(async () => undefined),
      getRepoMapText: vi.fn(async () => "repo-map"),
    };
    const service = new WorkspaceRetrievalService("C:/workspace", {
      now: () => now,
      refreshIntervalMs: 10,
      createIndex: () => index,
      createSearch: () => fakeSearch("snapshot"),
    });

    await service.prepare();
    now = 100;
    await service.settle();

    expect(index.index).toHaveBeenCalledOnce();
  });
});
