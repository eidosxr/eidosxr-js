/**
 * Tests for render() message handling and mount lifecycle.
 *
 * - The init-message handler must post a *snapshot* of the valtio proxy:
 *   proxies are not structured-cloneable, so cloning/posting the proxy
 *   itself threw DataCloneError on every renderer init and the spec never
 *   reached the iframe.
 * - render() resolves when the renderer reports ready (init or status), not
 *   on iframe load, and fails with a timeout if it never does.
 * - Schema validation runs alongside the renderer load. Schemas that cannot be
 *   loaded are a warning; an invalid spec is an error.
 * - Every failure cleans up the container, otherwise the
 *   data-eidos-initialized guard rejects every retry in that element.
 * - Messages go to the renderer's origin, not '*'.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import * as v8 from "node:v8";

// Some DOM test environments do not expose structuredClone. Polyfill with
// the v8 serializer, which has the same DataCloneError semantics for
// proxies as the real structured clone algorithm.
if (typeof globalThis.structuredClone !== "function") {
  (globalThis as Record<string, unknown>).structuredClone = (value: unknown) =>
    v8.deserialize(v8.serialize(value));
}

// render() schema-validates against the live schema URL — stub it so tests
// stay offline. SchemaUnavailableError stays the real class.
vi.mock("../src/lib/eidosmodel", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/eidosmodel")>();
  return { ...actual, validateSchema: vi.fn().mockResolvedValue(true) };
});

import { SchemaUnavailableError, validateSchema } from "../src/lib/eidosmodel";
import { EidosRenderError, render, RenderOptions } from "../src/lib/render";

const RENDERER_ORIGIN = "https://render.eidos.oceanum.io";

const makeSpec = () => ({
  version: "0.11",
  id: "test-spec",
  name: "Test Spec",
  root: { id: "root", nodeType: "world" },
});

const makeContainer = () => {
  const el = document.createElement("div");
  document.body.appendChild(el);
  return el;
};

/** render() creates its iframe synchronously, before validation. */
const iframeOf = (el: HTMLElement): HTMLIFrameElement => {
  const iframe = el.querySelector<HTMLIFrameElement>("iframe");
  if (!iframe) throw new Error("iframe was not created");
  return iframe;
};

/** Post a message to the host as if from the renderer iframe. */
const fromRenderer = (
  iframe: HTMLIFrameElement,
  data: unknown,
  origin = RENDERER_ORIGIN,
) => {
  window.dispatchEvent(
    new MessageEvent("message", { data, source: iframe.contentWindow, origin }),
  );
};

const init = (iframe: HTMLIFrameElement, origin = RENDERER_ORIGIN) =>
  fromRenderer(iframe, { type: "init", id: "test-spec" }, origin);

/** The status event the renderer's Eidos component emits once mounted. */
const status = (iframe: HTMLIFrameElement) =>
  fromRenderer(iframe, {
    action: "status",
    source: "eidos",
    data: { code: 1, message: "ready" },
  });

/** Let pending promise callbacks run. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Render, then bring the renderer up so render() resolves. */
const mount = async (el: HTMLElement, options?: RenderOptions) => {
  const pending = render(el, makeSpec(), options);
  init(iframeOf(el));
  return pending;
};

/** Settlement state of a promise, without awaiting it. */
const track = <T>(promise: Promise<T>) => {
  const state = { settled: false };
  promise.then(
    () => (state.settled = true),
    () => (state.settled = true),
  );
  return state;
};

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.mocked(validateSchema).mockReset();
  vi.mocked(validateSchema).mockResolvedValue(true);
  document.body.innerHTML = "";
});

describe("render() readiness", () => {
  it("responds to the renderer init message with a cloneable spec snapshot", async () => {
    const el = makeContainer();
    const pending = render(el, makeSpec());
    const iframe = iframeOf(el);
    const postMessage = vi.spyOn(iframe.contentWindow!, "postMessage");

    init(iframe);
    const view = await pending;

    expect(postMessage).toHaveBeenCalledTimes(1);
    const message = postMessage.mock.calls[0][0] as {
      id: string;
      type: string;
      payload: Record<string, unknown>;
    };
    expect(message.type).toBe("spec");
    expect(message.id).toBe("test-spec");
    expect(message.payload.name).toBe("Test Spec");
    // The payload must survive the structured clone that postMessage
    // performs — the old code posted the raw valtio proxy, which throws.
    expect(() => structuredClone(message.payload)).not.toThrow();

    view.destroy();
  });

  it("does not resolve on iframe load alone", async () => {
    const el = makeContainer();
    const pending = render(el, makeSpec(), { readyTimeout: 0 });
    const state = track(pending);

    iframeOf(el).dispatchEvent(new Event("load"));
    await flush();
    expect(state.settled).toBe(false);

    init(iframeOf(el));
    (await pending).destroy();
  });

  it("resolves and calls onReady on the renderer's init message", async () => {
    const el = makeContainer();
    const onReady = vi.fn();
    const view = await mount(el, { onReady });
    expect(onReady).toHaveBeenCalledTimes(1);
    view.destroy();
  });

  it("resolves on the renderer's status event and still passes it to eventListener", async () => {
    const el = makeContainer();
    const onReady = vi.fn();
    const eventListener = vi.fn();
    const pending = render(el, makeSpec(), { onReady, eventListener });

    status(iframeOf(el));
    const view = await pending;
    await flush(); // held events are delivered in a later task

    expect(onReady).toHaveBeenCalledTimes(1);
    expect(eventListener).toHaveBeenCalledWith(
      expect.objectContaining({ action: "status" }),
    );
    view.destroy();
  });

  it("ignores messages that do not come from its own iframe", async () => {
    const el = makeContainer();
    const pending = render(el, makeSpec(), { readyTimeout: 0 });
    const state = track(pending);

    window.dispatchEvent(
      new MessageEvent("message", {
        data: { type: "init", id: "test-spec" },
        source: window,
      }),
    );
    await flush();
    expect(state.settled).toBe(false);

    init(iframeOf(el));
    (await pending).destroy();
  });

  it("times out, reports the error, and leaves the container retryable", async () => {
    vi.useFakeTimers();
    const el = makeContainer();
    const onError = vi.fn();
    const onReady = vi.fn();
    const pending = render(el, makeSpec(), {
      readyTimeout: 5000,
      onError,
      onReady,
    });
    const assertion = expect(pending).rejects.toMatchObject({
      name: "EidosRenderError",
      kind: "timeout",
      message: "EIDOS renderer did not report ready within 5000 ms",
    });

    await vi.advanceTimersByTimeAsync(4999);
    expect(onError).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await assertion;

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toBeInstanceOf(EidosRenderError);
    expect(onReady).not.toHaveBeenCalled();
    expect(el.getAttribute("data-eidos-initialized")).toBeNull();
    expect(el.querySelector("iframe")).toBeNull();
    vi.useRealTimers();

    // A retry in the same container must not hit the already-mounted guard.
    const view = await mount(el);
    expect(view.iframe.isConnected).toBe(true);
    view.destroy();
  });

  it("stops the ready timer once the renderer is ready", async () => {
    vi.useFakeTimers();
    const el = makeContainer();
    const onError = vi.fn();
    const view = await mount(el, { readyTimeout: 1000, onError });
    await vi.advanceTimersByTimeAsync(5000);
    expect(onError).not.toHaveBeenCalled();
    expect(view.iframe.isConnected).toBe(true);
    view.destroy();
  });

  it("cleans up the container when the iframe fails to load, allowing retry", async () => {
    const el = makeContainer();
    const onError = vi.fn();
    const pending = render(el, makeSpec(), { onError });
    iframeOf(el).dispatchEvent(new Event("error"));

    await expect(pending).rejects.toMatchObject({
      kind: "load",
      message: "Failed to load EIDOS renderer",
    });
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "load" }),
    );
    expect(el.getAttribute("data-eidos-initialized")).toBeNull();
    expect(el.querySelector("iframe")).toBeNull();

    // A retry in the same container must not hit the already-mounted guard.
    const view = await mount(el);
    expect(view.iframe).toBe(iframeOf(el));
    view.destroy();
  });

  it("sends the spec when the renderer reports status without an init", async () => {
    const el = makeContainer();
    const pending = render(el, makeSpec());
    const iframe = iframeOf(el);
    const postMessage = vi.spyOn(iframe.contentWindow!, "postMessage");

    status(iframe);
    const view = await pending;
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "spec" }),
      RENDERER_ORIGIN,
    );
    view.destroy();
  });

  it("still resolves when onReady throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const el = makeContainer();
    const view = await mount(el, {
      onReady: () => {
        throw new Error("host bug");
      },
    });
    expect(view.iframe.isConnected).toBe(true);
    expect(console.error).toHaveBeenCalledWith(
      "[EIDOS] onReady threw:",
      expect.any(Error),
    );
    view.destroy();
  });

  it("still rejects when onError throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const el = makeContainer();
    const pending = render(el, makeSpec(), {
      onError: () => {
        throw new Error("host bug");
      },
    });
    iframeOf(el).dispatchEvent(new Event("error"));
    await expect(pending).rejects.toMatchObject({ kind: "load" });
  });

  it("passes events that arrive before ready to eventListener once it resolves", async () => {
    const el = makeContainer();
    const seen: string[] = [];
    const pending = render(el, makeSpec(), {
      eventListener: (e) => seen.push((e as { action: string }).action),
      onReady: () => seen.push("onReady"),
    });
    const iframe = iframeOf(el);

    fromRenderer(iframe, { action: "viewStateChange" });
    expect(seen).toEqual([]);
    init(iframe);
    const view = await pending;
    // Held events go out in a later task, after the caller has the result.
    expect(seen).toEqual(["onReady"]);
    await flush();
    expect(seen).toEqual(["onReady", "viewStateChange"]);

    fromRenderer(iframe, { action: "click" });
    expect(seen).toEqual(["onReady", "viewStateChange", "click"]);
    view.destroy();
  });

  it("lets a held event's listener use the awaited RenderResult", async () => {
    const el = makeContainer();
    let view: Awaited<ReturnType<typeof render>> | undefined;
    const iframes: HTMLIFrameElement[] = [];
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const pending = render(el, makeSpec(), {
      // As a host would: dereference the result it awaited.
      eventListener: () => iframes.push(view!.iframe),
    });
    const iframe = iframeOf(el);

    status(iframe); // ready, and itself an event for eventListener
    view = await pending;
    await flush();

    expect(iframes).toEqual([iframe]);
    expect(errors).not.toHaveBeenCalled();
    view.destroy();
  });

  it("drops held events when destroyed before they are delivered", async () => {
    const el = makeContainer();
    const eventListener = vi.fn();
    const pending = render(el, makeSpec(), { eventListener });
    status(iframeOf(el));
    (await pending).destroy();
    await flush();
    expect(eventListener).not.toHaveBeenCalled();
  });

  it("cleans up quietly when the container is removed before ready", async () => {
    vi.useFakeTimers();
    const el = makeContainer();
    const onError = vi.fn();
    const pending = render(el, makeSpec(), { readyTimeout: 1000, onError });
    const assertion = expect(pending).rejects.toMatchObject({ kind: "load" });
    const removeListener = vi.spyOn(window, "removeEventListener");

    el.remove();
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;

    expect(onError).not.toHaveBeenCalled();
    expect(removeListener).toHaveBeenCalledWith(
      "message",
      expect.any(Function),
    );
    expect(el.getAttribute("data-eidos-initialized")).toBeNull();
  });

  it.each([2 ** 31, Infinity])(
    "treats a readyTimeout of %s as no timeout rather than firing at once",
    async (readyTimeout) => {
      vi.useFakeTimers();
      const el = makeContainer();
      const onError = vi.fn();
      const pending = render(el, makeSpec(), { readyTimeout, onError });
      const state = track(pending);

      await vi.advanceTimersByTimeAsync(60_000);
      expect(onError).not.toHaveBeenCalled();
      expect(state.settled).toBe(false);

      init(iframeOf(el));
      (await pending).destroy();
    },
  );
});

describe("render() validation", () => {
  it("creates the iframe without waiting for validation, and resolves once it settles", async () => {
    let finishValidation!: (valid: boolean) => void;
    vi.mocked(validateSchema).mockReturnValueOnce(
      new Promise((resolve) => (finishValidation = resolve)),
    );
    const el = makeContainer();
    const pending = render(el, makeSpec());
    const state = track(pending);

    // The iframe exists, and gets the spec, while validation is pending.
    const iframe = iframeOf(el);
    const postMessage = vi.spyOn(iframe.contentWindow!, "postMessage");
    init(iframe);
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "spec" }),
      RENDERER_ORIGIN,
    );
    await flush();
    expect(state.settled).toBe(false);

    finishValidation(true);
    (await pending).destroy();
  });

  it("renders and warns when the schemas cannot be loaded", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const onError = vi.fn();
    vi.mocked(validateSchema).mockRejectedValueOnce(
      new SchemaUnavailableError(
        "EIDOS schemas could not be loaded: Loading error: 404",
      ),
    );
    const el = makeContainer();
    const view = await mount(el, { onError });

    expect(view.iframe.isConnected).toBe(true);
    expect(onError).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("Spec not validated"),
    );
    view.destroy();
  });

  it("renders and warns with the schema host unreachable (real validator)", async () => {
    // The real validateSchema, with every request to the schema host failing
    // as it does when schemas.oceanum.io is blocked.
    const actual = await vi.importActual<
      typeof import("../src/lib/eidosmodel")
    >("../src/lib/eidosmodel");
    vi.mocked(validateSchema).mockImplementationOnce(actual.validateSchema);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const el = makeContainer();
    const view = await mount(el);

    expect(view.iframe.isConnected).toBe(true);
    expect(warn).toHaveBeenCalledWith(
      "[EIDOS] Spec not validated: EIDOS schemas could not be loaded: Failed to fetch",
    );
    view.destroy();
  });

  it("rejects an invalid spec, reports it, and leaves the container retryable", async () => {
    const onError = vi.fn();
    vi.mocked(validateSchema).mockRejectedValueOnce(
      new Error("EIDOS spec validation failed: /name: must be string"),
    );
    const el = makeContainer();
    const pending = render(el, makeSpec(), { onError });

    await expect(pending).rejects.toMatchObject({
      kind: "validation",
      message:
        "Invalid Eidos Spec: EIDOS spec validation failed: /name: must be string",
    });
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "validation" }),
    );
    expect(el.getAttribute("data-eidos-initialized")).toBeNull();
    expect(el.querySelector("iframe")).toBeNull();

    // A retry in the same container must not hit the already-mounted guard.
    const view = await mount(el);
    expect(view.iframe.isConnected).toBe(true);
    view.destroy();
  });

  it("does not pass events from an embed that is rejected as invalid", async () => {
    let failValidation!: (e: Error) => void;
    vi.mocked(validateSchema).mockReturnValueOnce(
      new Promise((_, reject) => (failValidation = reject)),
    );
    const eventListener = vi.fn();
    const el = makeContainer();
    const pending = render(el, makeSpec(), { eventListener });
    const iframe = iframeOf(el);

    init(iframe);
    status(iframe);
    failValidation(new Error("EIDOS spec validation failed: /name"));

    await expect(pending).rejects.toMatchObject({ kind: "validation" });
    expect(eventListener).not.toHaveBeenCalled();
  });

  it("bounds the wait on validation by readyTimeout once the renderer is ready", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let failValidation!: (e: Error) => void;
    vi.mocked(validateSchema).mockReturnValueOnce(
      new Promise((_, reject) => (failValidation = reject)),
    );
    const onError = vi.fn();
    const el = makeContainer();
    const pending = render(el, makeSpec(), { readyTimeout: 5000, onError });
    const state = track(pending);
    init(iframeOf(el));

    await vi.advanceTimersByTimeAsync(4999);
    expect(state.settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const view = await pending;

    expect(onError).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      "[EIDOS] Spec not validated: the EIDOS schemas did not load within 5000 ms",
    );

    // A late verdict on a live embed is reported, not acted on.
    failValidation(new Error("EIDOS spec validation failed: /name"));
    await vi.advanceTimersByTimeAsync(0);
    expect(warn).toHaveBeenLastCalledWith(
      "[EIDOS] Invalid Eidos Spec: EIDOS spec validation failed: /name",
    );
    expect(view.iframe.isConnected).toBe(true);
    view.destroy();
  });
});

describe("render() messaging", () => {
  it("sends the spec, auth token and actions to the renderer's origin, not '*'", async () => {
    const el = makeContainer();
    const pending = render(el, makeSpec(), { authToken: "secret-token" });
    const iframe = iframeOf(el);
    const postMessage = vi.spyOn(iframe.contentWindow!, "postMessage");

    init(iframe);
    const view = await pending;
    await flush(); // sendAuth awaits the token
    view.spec.name = "Renamed";
    await flush(); // valtio batches the change notification
    view.triggerAction({ action: "openPanel" });
    await view.updateAuth(() => "next-token");

    const types = postMessage.mock.calls.map(
      ([message]) => (message as { type: string }).type,
    );
    expect(types).toEqual(["spec", "auth", "spec", "event", "auth"]);
    for (const [message, targetOrigin] of postMessage.mock.calls) {
      expect(targetOrigin, JSON.stringify(message)).toBe(RENDERER_ORIGIN);
    }
    view.destroy();
  });

  it.each([
    ["https://example.com:8443/eidos/index.html", "https://example.com:8443"],
    ["/renderer/index.html", window.location.origin],
    ["data:text/html,<p>renderer</p>", "*"],
  ])("derives the target origin of renderer %s", async (renderer, origin) => {
    const el = makeContainer();
    const pending = render(el, makeSpec(), { renderer });
    const iframe = iframeOf(el);
    const postMessage = vi.spyOn(iframe.contentWindow!, "postMessage");

    init(iframe, origin === "*" ? "null" : origin);
    const view = await pending;
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "spec" }),
      origin,
    );
    view.destroy();
  });

  it("fails clearly when the renderer is served from another origin", async () => {
    const el = makeContainer();
    const onError = vi.fn();
    const pending = render(el, makeSpec(), { onError });
    const iframe = iframeOf(el);
    const postMessage = vi.spyOn(iframe.contentWindow!, "postMessage");

    // e.g. the renderer URL redirected to a CDN host.
    init(iframe, "https://cdn.example.com");

    await expect(pending).rejects.toMatchObject({
      kind: "load",
      message: expect.stringContaining(
        "EIDOS renderer document is from https://cdn.example.com, not from https://render.eidos.oceanum.io",
      ),
    });
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "load" }),
    );
    // Nothing, the token included, was sent to the other origin.
    expect(postMessage).not.toHaveBeenCalled();
    expect(el.querySelector("iframe")).toBeNull();
  });

  it("warns about, and ignores, another origin after the embed is up", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const eventListener = vi.fn();
    const el = makeContainer();
    const view = await mount(el, { eventListener });
    await flush();

    fromRenderer(view.iframe, { action: "click" }, "https://elsewhere.example");
    expect(eventListener).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(
        "renderer document is from https://elsewhere.example",
      ),
    );
    expect(view.iframe.isConnected).toBe(true);
    view.destroy();
  });

  it("follows an http to https redirect of the renderer on the same host", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const el = makeContainer();
    const pending = render(el, makeSpec(), {
      renderer: "http://render.eidos.oceanum.io/v0.12/index.html",
      authToken: "secret-token",
    });
    const iframe = iframeOf(el);
    const postMessage = vi.spyOn(iframe.contentWindow!, "postMessage");

    init(iframe, RENDERER_ORIGIN);
    const view = await pending;
    await flush(); // sendAuth awaits the token

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("use the https URL"),
    );
    expect(postMessage.mock.calls.map(([, origin]) => origin)).toEqual([
      RENDERER_ORIGIN,
      RENDERER_ORIGIN,
    ]);
    view.destroy();
  });

  it("logs renderer messages only with debug on", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    const quiet = makeContainer();
    (await mount(quiet)).destroy();
    expect(log).not.toHaveBeenCalled();

    const verbose = makeContainer();
    (await mount(verbose, { debug: true })).destroy();
    expect(log).toHaveBeenCalledWith(
      "[EIDOS] Message from renderer:",
      "init",
      expect.objectContaining({ type: "init" }),
    );
  });

  it("stops listening and frees the container on destroy", async () => {
    const el = makeContainer();
    const eventListener = vi.fn();
    const view = await mount(el, { eventListener });
    const iframe = view.iframe;

    view.destroy();
    fromRenderer(iframe, { action: "click" });

    expect(eventListener).not.toHaveBeenCalled();
    expect(el.getAttribute("data-eidos-initialized")).toBeNull();
    expect(el.querySelector("iframe")).toBeNull();
  });
});
