import { proxy, subscribe, snapshot, Proxy } from "valtio/vanilla";
import { SchemaUnavailableError, validateSchema } from "./eidosmodel";
import { EidosSpec } from "../schema/interfaces";
import { MINOR_VERSION } from "./version";

const DEFAULT_RENDERER = `https://render.eidos.oceanum.io/v${MINOR_VERSION}/index.html`;
const DEFAULT_READY_TIMEOUT_MS = 30_000;

/**
 * Why render() failed:
 * - `load`: the renderer iframe failed to load.
 * - `timeout`: the renderer did not report ready within `readyTimeout`.
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
  /** Milliseconds to wait for the renderer to report ready before failing (default 30000; 0 waits indefinitely) */
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
 * Embed the EIDOS iframe and set up message passing.
 *
 * The iframe is created straight away; the spec is schema-validated alongside
 * it. render() resolves once the renderer reports ready (its first `init` or
 * `status` message) and the spec has been checked. It rejects with an
 * EidosRenderError if the renderer fails to load or does not report ready in
 * time, or if the spec is invalid; the container is then cleared, so render()
 * can be retried in it. If the schemas cannot be loaded, the spec is rendered
 * unvalidated and a warning is logged.
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
  const targetOrigin = rendererTargetOrigin(renderer);

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
    let readyTimer: ReturnType<typeof setTimeout> | undefined;

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

    const maybeResolve = () => {
      if (settled || !rendererReady || !specChecked) return;
      settled = true;
      onReady?.();
      resolve({
        spec: eidos,
        updateAuth: sendAuth,
        triggerAction,
        iframe,
        destroy: teardown,
      });
    };

    const markReady = () => {
      if (rendererReady) return;
      rendererReady = true;
      clearReadyTimer();
      maybeResolve();
    };

    // Listen from the start rather than from iframe load: the renderer
    // announces itself (`init`, then a `status` event) as soon as it mounts,
    // which is before the iframe's load event.
    const messageHandler = (event: MessageEvent) => {
      if (event.source !== iframe.contentWindow) return;
      const data = event.data;
      if (!data || typeof data !== "object") return;

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
        // Send initial spec. Snapshot first: the valtio proxy itself is
        // not structured-cloneable (postMessage/structuredClone throw
        // DataCloneError on any Proxy), so cloning `eidos` directly made
        // this handler crash on every init and the spec never arrived.
        post({ id: _id, type: "spec", payload: snapshot(eidos) });
        // Send auth token on init if provided
        if (authToken) {
          sendAuth(authToken);
        }
        markReady();
      } else if (data.type || data.action || data.control) {
        // Process as event - EIDOS events may not have 'type' but have 'action' and 'control'
        if (data.action === "status") markReady();
        eventListener?.(data);
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
      onError?.(error);
      reject(error);
    };

    iframe.onerror = () => {
      fail(new EidosRenderError("load", "Failed to load EIDOS renderer"));
    };

    if (Number.isFinite(readyTimeout) && readyTimeout > 0) {
      readyTimer = setTimeout(() => {
        fail(
          new EidosRenderError(
            "timeout",
            `EIDOS renderer did not report ready within ${readyTimeout} ms`,
          ),
        );
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
