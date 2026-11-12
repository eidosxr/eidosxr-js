import { proxy, subscribe, snapshot, Proxy } from "valtio/vanilla";
import { SchemaUnavailableError, validateSchema } from "./eidosmodel";
import { EidosSpec } from "../schema/interfaces";
import { MINOR_VERSION } from "./version";

const DEFAULT_RENDERER = `https://render.eidos.oceanum.io/v${MINOR_VERSION}/index.html`;
const DEFAULT_READY_TIMEOUT_MS = 30_000;
// setTimeout fires at once for delays above a signed 32-bit int (~24.8 days).
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

/**
 * Why render() failed:
 * - `load`: the iframe reported a load error, the renderer document is from
 *   another origin than the renderer URL, or the container was removed before
 *   the renderer was ready.
 * - `timeout`: the renderer did not report ready within `readyTimeout`; this
 *   is also how an unreachable renderer host shows up in most browsers.
 * - `validation`: the spec does not satisfy the EIDOS schema.
 */
export type EidosRenderErrorKind = "load" | "timeout" | "validation";

/** The error render() rejects with, and passes to `onError`. */
export class EidosRenderError extends Error {
  readonly kind: EidosRenderErrorKind;

  constructor(
    kind: EidosRenderErrorKind,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "EidosRenderError";
    this.kind = kind;
  }
}

/**
 * Options for rendering an EIDOS spec
 */
export interface RenderOptions {
  /** The unique identifier for the EIDOS spec (optional, defaults to spec.id) */
  id?: string;
  /** Optional callback for handling events from the renderer */
  eventListener?: (payload: unknown) => void;
  /** URL of the EIDOS renderer */
  renderer?: string;
  /** Authentication token to pass to the renderer for data fetching */
  authToken?: string | (() => string | Promise<string>);
  /** Optional callback when the spec proxy changes (for syncing to external state like Yjs) */
  onChange?: (snapshot: EidosSpec) => void;
  /** Called once the renderer has reported ready and the spec has been checked, just before render() resolves */
  onReady?: () => void;
  /** Called when render() fails, with the error it rejects with */
  onError?: (error: EidosRenderError) => void;
  /**
   * Milliseconds to wait for the renderer to report ready before failing
   * (default 30000; 0, Infinity or more than 2^31-1 waits indefinitely). If the
   * renderer is ready by then but the schemas are still loading, the spec is
   * rendered unvalidated.
   */
  readyTimeout?: number;
  /** Log every message from the renderer to the console */
  debug?: boolean;
}

/**
 * Result from the render function
 */
export interface RenderResult {
  /** The reactive EIDOS spec proxy */
  spec: Proxy<EidosSpec>;
  /** Update the auth token sent to the renderer */
  updateAuth: (
    token: string | (() => string | Promise<string>),
  ) => Promise<void>;
  /** The iframe element */
  iframe: HTMLIFrameElement;
  /** Destroy the renderer and clean up resources */
  destroy: () => void;
  /** Send an event action to the renderer's event bus */
  triggerAction: (payload: unknown) => void;
}

/**
 * The postMessage target for the renderer: its origin, so that the spec and
 * the auth token can only be delivered to a document from that origin. A URL
 * without an origin of its own (data:, about:, unparseable) falls back to '*'.
 */
const rendererTargetOrigin = (renderer: string): string => {
  try {
    const { origin } = new URL(renderer, document.baseURI);
    return origin === "null" ? "*" : origin;
  } catch {
    return "*";
  }
};

/**
 * Whether `observed` is `expected` upgraded from http to https on the same
 * host with default ports: what an HTTPS redirect of the renderer URL does.
 * Following that redirect only moves to a more secure scheme on the same host,
 * so it is the one origin change render() adopts.
 */
const isHttpsUpgrade = (expected: string, observed: string): boolean => {
  try {
    const from = new URL(expected);
    const to = new URL(observed);
    return (
      from.protocol === "http:" &&
      to.protocol === "https:" &&
      from.hostname === to.hostname &&
      from.port === "" &&
      to.port === ""
    );
  } catch {
    return false;
  }
};

/**
 * Embed the EIDOS iframe and set up message passing.
 *
 * The iframe is created straight away; the spec is schema-validated alongside
 * it. render() resolves once the renderer reports ready (its first `init` or
 * `status` message) and the spec has been checked. It rejects with an
 * EidosRenderError if the renderer fails to load or does not report ready in
 * time, or if the spec is invalid; the container is then cleared, so render()
 * can be retried in it. If the schemas cannot be loaded, the spec is rendered
 * unvalidated and a warning is logged. Renderer events that arrive before
 * render() resolves reach eventListener in a later task, after the caller has
 * the RenderResult.
 *
 * @param element HTML element to render the EIDOS spec into
 * @param spec The EIDOS specification object
 * @param options Render options including id, eventListener, renderer URL, and authToken
 * @returns A RenderResult object containing the spec proxy and control methods
 */
const render = async (
  element: HTMLElement,
  spec: EidosSpec,
  options: RenderOptions = {},
): Promise<RenderResult> => {
  const {
    id,
    eventListener,
    renderer = DEFAULT_RENDERER,
    authToken,
    onChange,
    onReady,
    onError,
    readyTimeout = DEFAULT_READY_TIMEOUT_MS,
    debug = false,
  } = options;

  // Check if this container is already initialized
  // We check both for an existing iframe and a marker on the container itself
  // This prevents double-mounting even if destroy() was called but the container is being reused
  const existingIframe = element.querySelector("iframe[data-eidos-renderer]");
  const isInitialized =
    element.getAttribute("data-eidos-initialized") === "true";

  if (existingIframe || isInitialized) {
    throw new Error(
      "EIDOS renderer already mounted in this container. Call destroy() before re-rendering.",
    );
  }

  // Create Valtio proxy - naturally mutable, no unprotect needed
  const eidos = proxy(structuredClone(spec));
  const _id = id || spec.id;
  let targetOrigin = rendererTargetOrigin(renderer);

  // Mark container as initialized. Every failure path below clears it again.
  element.setAttribute("data-eidos-initialized", "true");

  return new Promise((resolve, reject) => {
    const iframe = document.createElement("iframe");
    iframe.src = `${renderer}?id=${_id}`;
    iframe.width = "100%";
    iframe.height = "100%";
    iframe.frameBorder = "0";
    // Mark this as an EIDOS iframe for duplicate detection
    iframe.setAttribute("data-eidos-renderer", "true");
    element.appendChild(iframe);

    let settled = false;
    let rendererReady = false;
    let specChecked = false;
    let specDelivered = false;
    let readyTimer: ReturnType<typeof setTimeout> | undefined;
    // Renderer events that arrive before render() settles are held back, so
    // eventListener only sees events from an embed that actually mounted.
    let heldEvents: unknown[] | null = [];

    // contentWindow is read per message rather than captured: it is the
    // iframe's WindowProxy, which stays the same object across navigation.
    const post = (message: object) =>
      iframe.contentWindow?.postMessage(message, targetOrigin);

    // Helper to send auth token to iframe
    const sendAuth = async (
      token: string | (() => string | Promise<string>),
    ) => {
      const resolvedToken = typeof token === "function" ? await token() : token;
      post({ id: _id, type: "auth", payload: resolvedToken });
    };

    const triggerAction = (payload: unknown) => {
      post({ id: _id, type: "event", payload });
    };

    const clearReadyTimer = () => {
      if (readyTimer !== undefined) {
        clearTimeout(readyTimer);
        readyTimer = undefined;
      }
    };

    // A throwing host callback must not leave render() unsettled.
    const callSafely = (name: string, callback: () => void) => {
      try {
        callback();
      } catch (e) {
        console.error(`[EIDOS] ${name} threw:`, e);
      }
    };

    const maybeResolve = () => {
      if (settled || !rendererReady || !specChecked) return;
      settled = true;
      clearReadyTimer();
      resolve({
        spec: eidos,
        updateAuth: sendAuth,
        triggerAction,
        iframe,
        destroy: teardown,
      });
      // resolve() only queues the caller's continuation, so onReady still
      // runs before `await render()` returns.
      callSafely("onReady", () => onReady?.());
      // Held events go out in a later task, once the caller's continuation
      // has run and it holds the RenderResult: a listener may use it. Events
      // arriving meanwhile keep being held, so the order is kept.
      setTimeout(() => {
        const held = heldEvents;
        heldEvents = null;
        for (const data of held ?? []) {
          callSafely("eventListener", () => eventListener?.(data));
        }
      }, 0);
    };

    const markReady = () => {
      if (rendererReady) return;
      rendererReady = true;
      maybeResolve();
    };

    // Send the spec and the auth token.
    const deliverSpec = () => {
      specDelivered = true;
      // Snapshot first: the valtio proxy itself is not structured-cloneable
      // (postMessage/structuredClone throw DataCloneError on any Proxy), so
      // cloning `eidos` directly made this crash and the spec never arrived.
      post({ id: _id, type: "spec", payload: snapshot(eidos) });
      if (authToken) {
        sendAuth(authToken);
      }
    };

    // Our iframe now holds a document from an origin other than the one the
    // messages are addressed to.
    let warnedOrigin = false;
    const checkOrigin = (origin: string): boolean => {
      if (targetOrigin === "*" || origin === targetOrigin) return true;
      if (isHttpsUpgrade(targetOrigin, origin)) {
        console.warn(
          `[EIDOS] Renderer ${renderer} redirected to ${origin}; use the https URL.`,
        );
        targetOrigin = origin;
        return true;
      }
      // Any other origin is not adopted: the iframe may have navigated away,
      // and the spec and auth token must not follow it there. Its messages
      // are ignored.
      const message =
        `EIDOS renderer document is from ${origin}, not from ${targetOrigin}, ` +
        `the origin of the renderer URL (a cross-origin redirect?). ` +
        `Use the renderer's final URL.`;
      if (settled) {
        if (!warnedOrigin) console.warn(`[EIDOS] ${message}`);
        warnedOrigin = true;
      } else {
        fail(new EidosRenderError("load", message));
      }
      return false;
    };

    // Listen from the start rather than from iframe load: the renderer
    // announces itself (`init`, then a `status` event) as soon as it mounts,
    // which is before the iframe's load event.
    const messageHandler = (event: MessageEvent) => {
      if (event.source !== iframe.contentWindow) return;
      const data = event.data;
      if (!data || typeof data !== "object") return;
      if (!checkOrigin(event.origin)) return;

      if (debug) {
        console.log(
          "[EIDOS] Message from renderer:",
          data.type ?? data.action,
          data,
        );
      }

      // Check ID only if both message and expected ID exist
      // Some EIDOS renderers may not include ID in event messages
      if (data.id && data.id !== _id) return;

      if (data.type === "init") {
        // The renderer asks for the spec until it gets one: answer each time.
        deliverSpec();
        markReady();
      } else if (data.type || data.action || data.control) {
        // Process as event - EIDOS events may not have 'type' but have 'action' and 'control'
        if (data.action === "status") {
          // The renderer is listening once it reports status, so make sure
          // it has the spec even if its init was not seen.
          if (!specDelivered) deliverSpec();
          markReady();
        }
        if (heldEvents) {
          heldEvents.push(data);
        } else {
          eventListener?.(data);
        }
      }
    };
    window.addEventListener("message", messageHandler);

    // Subscribe to changes and send patches to renderer
    const unsubscribe = subscribe(eidos, () => {
      const currentSnapshot = snapshot(eidos);

      // Send to renderer iframe
      post({ id: _id, type: "spec", payload: currentSnapshot });

      // Notify parent of changes (for Yjs sync, etc.)
      onChange?.(currentSnapshot as EidosSpec);
    });

    function teardown() {
      heldEvents = null;
      clearReadyTimer();
      window.removeEventListener("message", messageHandler);
      unsubscribe();
      iframe.remove();
      // Clear the initialization marker so the container can be reused
      element.removeAttribute("data-eidos-initialized");
    }

    // Clean up the failed mount so the container can be retried —
    // otherwise the data-eidos-initialized guard rejects every
    // subsequent render() in this element.
    const fail = (error: EidosRenderError) => {
      if (settled) return;
      settled = true;
      teardown();
      reject(error);
      callSafely("onError", () => onError?.(error));
    };

    iframe.onerror = () => {
      fail(new EidosRenderError("load", "Failed to load EIDOS renderer"));
    };

    if (readyTimeout > 0 && readyTimeout <= MAX_TIMEOUT_MS) {
      readyTimer = setTimeout(() => {
        readyTimer = undefined;
        if (!iframe.isConnected) {
          // The host removed the embed before it was ready: it is no longer
          // wanted, so clean up and reject without reporting through onError.
          settled = true;
          teardown();
          reject(
            new EidosRenderError(
              "load",
              "EIDOS renderer was removed from the document before it was ready",
            ),
          );
          return;
        }
        if (!rendererReady) {
          fail(
            new EidosRenderError(
              "timeout",
              `EIDOS renderer did not report ready within ${readyTimeout} ms`,
            ),
          );
          return;
        }
        // The renderer is up but the schemas are still loading: as when they
        // cannot be loaded at all, render the spec unvalidated.
        console.warn(
          `[EIDOS] Spec not validated: the EIDOS schemas did not load within ${readyTimeout} ms`,
        );
        specChecked = true;
        maybeResolve();
      }, readyTimeout);
    }

    // Validate alongside the renderer load rather than before it, so the
    // renderer is not held up by fetching and compiling the schemas.
    validateSchema(spec).then(
      () => {
        specChecked = true;
        maybeResolve();
      },
      (e: unknown) => {
        if (e instanceof SchemaUnavailableError) {
          // Says nothing about the spec: render it unvalidated.
          if (!settled) {
            console.warn(`[EIDOS] Spec not validated: ${e.message}`);
          }
          specChecked = true;
          maybeResolve();
          return;
        }
        const message = e instanceof Error ? e.message : String(e);
        if (settled) {
          // Validation outlasted readyTimeout and the embed is already up.
          if (iframe.isConnected) {
            console.warn(`[EIDOS] Invalid Eidos Spec: ${message}`);
          }
          return;
        }
        fail(
          new EidosRenderError("validation", `Invalid Eidos Spec: ${message}`, {
            cause: e,
          }),
        );
      },
    );
  });
};

export { render };
