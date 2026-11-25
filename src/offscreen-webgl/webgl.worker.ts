import { WebGLManager } from './gl-manager';
import { WorkerMessageType, type WorkerLifecycleSnapshot, type WorkerMessages } from './worker-messages';

type Request = Extract<
	WorkerMessages,
	{ proxyId: string; type: WorkerMessageType.INIT | WorkerMessageType.CALL_METHOD | WorkerMessageType.EVAL_FN }
>;
const managers = new Map<string, WebGLManager>();
const failures = new Map<string, Error>();
const queues = new Map<string, Promise<void>>();
const sharedCanvas = new OffscreenCanvas(1, 1);
sharedCanvas.getContext('webgl');
const outputs = new Map<string, OffscreenCanvasRenderingContext2D>();
// canvasId -> proxy ids initialized for that output canvas.
const canvasProxies = new Map<string, Set<string>>();
// Outputs released before their (possibly delayed) INIT arrived. A late INIT
// for one of these canvases must never register an output or manager.
const releasedCanvases = new Set<string>();

function present(canvasId: string, source: OffscreenCanvas, width: number, height: number): void {
	const output = outputs.get(canvasId);
	if (!output) return;
	const canvas = output.canvas;
	if (canvas.width !== width || canvas.height !== height) {
		canvas.width = width;
		canvas.height = height;
		output.globalCompositeOperation = 'copy';
	}
	output.drawImage(source, 0, source.height - height, width, height, 0, 0, width, height);
}

function destroyManager(proxyId: string): void {
	const manager = managers.get(proxyId);
	if (manager) {
		// destroy() is idempotent and never throws, but guard anyway so lifecycle
		// bookkeeping always completes.
		try {
			manager.destroy();
		} catch (error) {
			console.error('[OffscreenWebGL worker] failed to destroy manager', proxyId, error);
		}
		managers.delete(proxyId);
	}
	failures.delete(proxyId);
}

/**
 * Releases a canvas output and every manager rendering to it. Safe to call
 * more than once and before INIT has been observed for the canvas.
 */
function releaseCanvas(canvasId: string): void {
	releasedCanvases.add(canvasId);
	const proxyIds = canvasProxies.get(canvasId);
	if (proxyIds) {
		proxyIds.forEach((proxyId) => destroyManager(proxyId));
		canvasProxies.delete(canvasId);
	}
	outputs.delete(canvasId);
}

function lifecycleSnapshot(): WorkerLifecycleSnapshot {
	return {
		managers: Array.from(managers.keys()),
		outputs: Array.from(outputs.keys()),
		releasedCanvases: Array.from(releasedCanvases),
		canvasProxies: Array.from(canvasProxies.entries()).map(([canvasId, ids]) => [canvasId, Array.from(ids)]),
	};
}

async function handle(data: Request): Promise<void> {
	try {
		if (data.type === WorkerMessageType.INIT) {
			// Unmount/teardown won the race against a delayed INIT. Drop it so it
			// cannot re-register an output context or manager.
			if (releasedCanvases.has(data.canvasId)) return;

			const canvas = sharedCanvas;
			if (data.output && !outputs.has(data.canvasId)) {
				const output = data.output.getContext('2d');
				if (!output) throw new Error('2D canvas rendering is not supported');
				output.globalCompositeOperation = 'copy';
				outputs.set(data.canvasId, output);
			}
			let proxyIds = canvasProxies.get(data.canvasId);
			if (!proxyIds) {
				proxyIds = new Set<string>();
				canvasProxies.set(data.canvasId, proxyIds);
			}
			proxyIds.add(data.proxyId);

			const result = WebGLManager.fromHTMLCanvasElement(
				canvas as unknown as HTMLCanvasElement,
				data.width,
				data.height,
				(width, height) => present(data.canvasId, canvas, width, height)
			);
			if (result.error) throw result.error;
			// A canvas-wide RELEASE may have been processed while INIT was in flight.
			if (releasedCanvases.has(data.canvasId)) {
				result.data?.destroy();
				managers.delete(data.proxyId);
				const ids = canvasProxies.get(data.canvasId);
				ids?.delete(data.proxyId);
				return;
			}
			managers.set(data.proxyId, result.data);
			failures.delete(data.proxyId);
			return;
		}

		const manager = managers.get(data.proxyId);
		if (!manager) {
			// Destroy is an idempotent lifecycle operation: a repeated destroy, or
			// one that races ahead of INIT, must not surface as a worker error.
			if (data.type === WorkerMessageType.CALL_METHOD && data.method === 'destroy') {
				if (data.async && data.id) postMessage({ type: WorkerMessageType.RESPONSE, id: data.id, result: null });
				return;
			}
			throw failures.get(data.proxyId) || new Error(`WebGLManager not initialized for ${data.proxyId}`);
		}
		let result: any;
		if (data.type === WorkerMessageType.CALL_METHOD) {
			const method = manager[data.method];
			if (typeof method !== 'function') throw new Error(`Method ${data.method} not found`);
			result = await (method as (...args: any[]) => any).apply(manager, data.args);
			if (data.method === 'destroy') managers.delete(data.proxyId);
		} else {
			const fn = new Function('manager', 'frame', 'timeElapsed', `return (${data.fn})(manager, frame, timeElapsed);`);
			result = await manager.runOnContext(data.key, fn as any, data.onEachFrame);
		}

		if (data.type === WorkerMessageType.CALL_METHOD && result && typeof result === 'object' && 'error' in result && 'data' in result) {
			if (result.error) throw result.error;
			// Manager and WebGL objects cannot be cloned across the worker boundary.
			result = null;
		}
		if (data.async && data.id) postMessage({ type: WorkerMessageType.RESPONSE, id: data.id, result });
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (data.type === WorkerMessageType.INIT) failures.set(data.proxyId, new Error(message));
		postMessage({ type: WorkerMessageType.ERROR, id: 'id' in data ? data.id : undefined, error: message });
	}
}

function dispatch(data: WorkerMessages): void {
	if (data?.type === WorkerMessageType.BATCH) return data.messages.forEach(dispatch);
	if (data?.type === WorkerMessageType.INSPECT) {
		return postMessage({ type: WorkerMessageType.RESPONSE, id: data.id, result: lifecycleSnapshot() });
	}
	if (data?.type === WorkerMessageType.RELEASE) return releaseCanvas(data.canvasId);
	if (!data || !('proxyId' in data)) return;
	const queue = (queues.get(data.proxyId) || Promise.resolve()).then(() => handle(data));
	queues.set(data.proxyId, queue);
	void queue.finally(() => {
		if (queues.get(data.proxyId) === queue) queues.delete(data.proxyId);
	});
}

addEventListener('message', (event: MessageEvent<WorkerMessages>) => dispatch(event.data));
