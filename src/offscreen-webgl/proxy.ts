import { uuidv4 } from '../utils/uuid';
import { RunOnWorkerContextFn, WebGLManager } from './gl-manager';
import { WorkerMessageType, WorkerMessages, type WorkerLifecycleSnapshot } from './worker-messages';
import WebWorker from './webgl.worker?worker&inline';

type MappedManagerFunctions = { [K in keyof WebGLManager]: WebGLManager[K] extends (...args: any) => any ? WebGLManager[K] : never };
type MappedManagerFunctionsAsync = {
	[K in keyof WebGLManager as `${K & string}Async`]: WebGLManager[K] extends (...args: any) => any
		? (...args: Parameters<WebGLManager[K]>) => Promise<ReturnType<WebGLManager[K]>>
		: never;
};

export type WebGLManagerProxyType = WebGLManagerProxyClass & MappedManagerFunctions & MappedManagerFunctionsAsync;

const LIFECYCLE_METHODS = new Set(['destroy', 'destroyAsync', 'release', 'releaseAsync', 'dispose', 'disposeAsync']);

class WebGLManagerProxyClass {
	private static worker: Worker | null = null;
	private static workerFailure: Error | null = null;
	private static canvasIds = new WeakMap<HTMLCanvasElement, string>();
	private static releasedCanvases = new FinalizationRegistry<string>((canvasId) => {
		WebGLManagerProxyClass.worker?.postMessage({ type: WorkerMessageType.RELEASE, canvasId } satisfies WorkerMessages);
	});
	private static queuedMessages: WorkerMessages[] = [];
	private static pendingResponses: Record<string, { resolve: (value: any) => void; reject: (error: Error) => void }> = {};
	private readonly PROXY_ID = `WebGLManagerProxy-${uuidv4()}`;
	private canvasId: string = '';
	private destroyed = false;
	private destroyPromise: Promise<void> | null = null;

	private static readonly _managerPrototype = Object.getOwnPropertyNames(WebGLManager.prototype).reduce(
		(acc, prop) => {
			if ((WebGLManager.prototype as Record<string, any>)[prop as string] instanceof Function) {
				acc[prop] = prop + 'Async';
				acc[prop + 'Async'] = prop;
			}
			return acc;
		},
		{} as Record<string, string>
	);

	public static prewarm(): Worker {
		if (WebGLManagerProxyClass.worker) return WebGLManagerProxyClass.worker;
		const worker = new WebWorker();
		worker.onmessage = WebGLManagerProxyClass.handleMessage;
		worker.onerror = (event) => {
			const error = new Error(event.message || 'WebGL worker failed');
			WebGLManagerProxyClass.workerFailure = error;
			for (const pending of Object.values(WebGLManagerProxyClass.pendingResponses)) pending.reject(error);
			WebGLManagerProxyClass.pendingResponses = {};
		};
		WebGLManagerProxyClass.worker = worker;
		return worker;
	}

	/**
	 * Test/diagnostic seam: asks the shared worker for its current lifecycle
	 * bookkeeping (registered managers, output contexts and tombstones).
	 */
	public static inspectWorker(): Promise<WorkerLifecycleSnapshot> {
		const id = uuidv4();
		const ctor = WebGLManagerProxyClass;
		return new Promise<WorkerLifecycleSnapshot>((resolve, reject) => {
			ctor.pendingResponses[id] = { resolve, reject };
			try {
				const worker = ctor.prewarm();
				worker.postMessage({ type: WorkerMessageType.INSPECT, id } satisfies WorkerMessages);
			} catch (error) {
				delete ctor.pendingResponses[id];
				reject(error instanceof Error ? error : new Error(String(error)));
			}
		});
	}

	constructor(canvas: HTMLCanvasElement) {
		const worker = WebGLManagerProxyClass.prewarm();

		let canvasId = WebGLManagerProxyClass.canvasIds.get(canvas);
		let output: OffscreenCanvas | undefined;
		if (!canvasId) {
			if (typeof canvas.transferControlToOffscreen !== 'function') throw new Error('OffscreenCanvas is not supported');
			output = canvas.transferControlToOffscreen();
			canvasId = `OffscreenWebGLOutput-${uuidv4()}`;
			WebGLManagerProxyClass.canvasIds.set(canvas, canvasId);
			WebGLManagerProxyClass.releasedCanvases.register(canvas, canvasId);
		}
		this.canvasId = canvasId;
		WebGLManagerProxyClass.flush();
		worker.postMessage(
			{
				type: WorkerMessageType.INIT,
				width: canvas.width,
				height: canvas.height,
				proxyId: this.PROXY_ID,
				canvasId,
				output,
			} satisfies WorkerMessages,
			output ? [output] : []
		);

		return WebGLManagerProxyClass.wrapThisPrototype(this);
	}

	private static wrapThisPrototype(thisObj: WebGLManagerProxyClass): WebGLManagerProxyType {
		return new Proxy(thisObj, {
			get(target, prop, receiver) {
				// Lifecycle methods have explicit idempotent implementations.
				if (typeof prop === 'string' && LIFECYCLE_METHODS.has(prop)) {
					const value = Reflect.get(target, prop, receiver);
					return typeof value === 'function' ? value.bind(target) : value;
				}
				if (WebGLManagerProxyClass._managerPrototype[prop as string] && !(prop as string).startsWith('runOnContext')) {
					if (prop.toString().endsWith('Async')) {
						return (...args: any[]) => {
							return thisObj.callMethodAsync(
								WebGLManagerProxyClass._managerPrototype[prop as string] as keyof WebGLManager,
								...args
							);
						};
					} else {
						return (...args: any[]) => {
							thisObj.callMethod(prop as keyof WebGLManager, ...args);
						};
					}
				}
				return Reflect.get(target, prop, receiver);
			},
		}) as unknown as WebGLManagerProxyType;
	}

	private static handleMessage(event: MessageEvent<WorkerMessages>) {
		const { data } = event;
		if (data.type === WorkerMessageType.RESPONSE) {
			const { id, result, error } = data;
			if (WebGLManagerProxyClass.pendingResponses[id]) {
				error
					? WebGLManagerProxyClass.pendingResponses[id].reject(new Error(error))
					: WebGLManagerProxyClass.pendingResponses[id].resolve(result);
				delete WebGLManagerProxyClass.pendingResponses[id];
			} else {
				console.warn(`[WebGLManagerProxy] No pending response for ID: ${id}`, data);
			}
		} else if (data.type === WorkerMessageType.ERROR) {
			const { error, id } = data;
			if (id && WebGLManagerProxyClass.pendingResponses[id]) {
				WebGLManagerProxyClass.pendingResponses[id].reject(new Error(error));
				delete WebGLManagerProxyClass.pendingResponses[id];
			} else {
				console.error(`[WebGLManagerProxy] Error received without pending response for ID: ${id}`, error);
			}
		}
	}

	private static enqueue(message: WorkerMessages): void {
		const queue = WebGLManagerProxyClass.queuedMessages;
		queue.push(message);
		if (queue.length === 1) queueMicrotask(WebGLManagerProxyClass.flush);
	}

	private static flush(): void {
		const messages = WebGLManagerProxyClass.queuedMessages;
		if (!messages.length) return;
		WebGLManagerProxyClass.queuedMessages = [];
		WebGLManagerProxyClass.worker?.postMessage(
			messages.length === 1 ? messages[0] : ({ type: WorkerMessageType.BATCH, messages } satisfies WorkerMessages)
		);
	}

	/**
	 * Releases the worker-side manager and 2D output context for this canvas.
	 * Idempotent: repeated calls post nothing and never throw.
	 */
	public destroy(): void {
		if (this.destroyed) return;
		this.destroyed = true;
		const ctor = WebGLManagerProxyClass;
		// Preserve ordering after any already-queued fire-and-forget messages.
		ctor.flush();
		const worker = ctor.worker;
		if (!worker) return;
		worker.postMessage({
			type: WorkerMessageType.CALL_METHOD,
			proxyId: this.PROXY_ID,
			method: 'destroy',
			args: [],
		} satisfies WorkerMessages);
		worker.postMessage({
			type: WorkerMessageType.RELEASE,
			canvasId: this.canvasId,
		} satisfies WorkerMessages);
	}

	/** Alias for {@link destroy}: releases both the manager and its output. */
	public release(): void {
		this.destroy();
	}

	public destroyAsync(): Promise<void> {
		if (this.destroyPromise) return this.destroyPromise;
		// A synchronous destroy() already dispatched teardown but without an ack.
		if (this.destroyed) return Promise.resolve();
		this.destroyed = true;
		const ctor = WebGLManagerProxyClass;
		const id = uuidv4();
		this.destroyPromise = new Promise<void>((resolve) => {
			ctor.pendingResponses[id] = { resolve: () => resolve(), reject: () => resolve() };
			try {
				ctor.flush();
				const worker = ctor.prewarm();
				worker.postMessage({
					type: WorkerMessageType.CALL_METHOD,
					proxyId: this.PROXY_ID,
					method: 'destroy',
					args: [],
					id,
					async: true,
				} satisfies WorkerMessages);
				// Canvas-scoped output/manager release, ordered after destroy.
				worker.postMessage({
					type: WorkerMessageType.RELEASE,
					canvasId: this.canvasId,
				} satisfies WorkerMessages);
			} catch {
				delete ctor.pendingResponses[id];
				resolve();
			}
		});
		return this.destroyPromise;
	}

	public releaseAsync(): Promise<void> {
		return this.destroyAsync();
	}

	public dispose(): void {
		this.destroy();
	}

	public disposeAsync(): Promise<void> {
		return this.destroyAsync();
	}

	public callMethod<ManagerMethod extends keyof WebGLManager>(method: ManagerMethod, ...args: any[]): void {
		if (this.destroyed) return;
		WebGLManagerProxyClass.enqueue({
			type: WorkerMessageType.CALL_METHOD,
			proxyId: this.PROXY_ID,
			method,
			args,
		});
	}

	public callMethodAsync<ManagerMethod extends keyof WebGLManager>(
		method: ManagerMethod,
		...args: any[]
	): Promise<ReturnType<WebGLManager[ManagerMethod] extends (...args: any) => any ? WebGLManager[ManagerMethod] : never>> {
		if (this.destroyed) {
			// Match the worker's post-teardown rejection wording so callers can
			// observe destruction through the same error as a missing manager.
			return Promise.reject(new Error(`WebGLManager not initialized for ${this.PROXY_ID}`));
		}
		const id = uuidv4();
		return this.request(id, {
			type: WorkerMessageType.CALL_METHOD,
			proxyId: this.PROXY_ID,
			method,
			args,
			id,
			async: true,
		});
	}

	public runOnContext(key: string, fn: RunOnWorkerContextFn, onEachFrame: boolean = false) {
		if (this.destroyed) return;
		WebGLManagerProxyClass.enqueue({
			type: WorkerMessageType.EVAL_FN,
			fn: fn.toString(),
			onEachFrame,
			proxyId: this.PROXY_ID,
			key,
		});
	}

	public runOnContextAsync<T>(key: string, fn: RunOnWorkerContextFn<T>, onEachFrame: boolean = false) {
		if (this.destroyed) return Promise.reject(new Error(`WebGLManager not initialized for ${this.PROXY_ID}`));
		const id = uuidv4();
		return this.request<T>(id, {
			type: WorkerMessageType.EVAL_FN,
			fn: fn.toString(),
			onEachFrame,
			id,
			async: true,
			proxyId: this.PROXY_ID,
			key,
		});
	}

	private request<T>(id: string, message: WorkerMessages): Promise<T> {
		return new Promise<T>((resolve, reject) => {
			WebGLManagerProxyClass.pendingResponses[id] = { resolve, reject };
			try {
				if (WebGLManagerProxyClass.workerFailure) throw WebGLManagerProxyClass.workerFailure;
				if (!WebGLManagerProxyClass.worker) throw new Error('WebGL worker is unavailable');
				WebGLManagerProxyClass.flush();
				WebGLManagerProxyClass.worker.postMessage(message);
			} catch (error) {
				delete WebGLManagerProxyClass.pendingResponses[id];
				reject(error);
			}
		});
	}
}

export const WebGLManagerProxy = WebGLManagerProxyClass as unknown as {
	new (worker: HTMLCanvasElement): WebGLManagerProxyType;
	prewarm(): Worker;
	inspectWorker(): Promise<WorkerLifecycleSnapshot>;
};
