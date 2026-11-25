import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_VS_SHADER } from '../../src/defaults';
import { OffscreenWebGL } from '../../src/offscreen-webgl/offscreen-webgl';
import { WebGLManagerProxy } from '../../src/offscreen-webgl/proxy';
import { createUniformStream } from '../../src/offscreen-webgl/uniform-stream';
import type { WorkerLifecycleSnapshot } from '../../src/offscreen-webgl/worker-messages';
import { WorkerMessageType } from '../../src/offscreen-webgl/worker-messages';

const redShader = 'precision mediump float; void main() { gl_FragColor = vec4(1., 0., 0., 1.); }';
const colorShader = `precision highp float;
uniform vec3 u_color;
void main() { gl_FragColor = vec4(u_color, 1.0); }`;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function pixel(canvas: HTMLCanvasElement, x = 1, y = 1): number[] {
	const copy = document.createElement('canvas');
	copy.width = canvas.width;
	copy.height = canvas.height;
	const context = copy.getContext('2d')!;
	context.drawImage(canvas, 0, 0);
	return Array.from(context.getImageData(x, y, 1, 1).data);
}

function readyCanvas(container: HTMLElement): HTMLCanvasElement {
	const canvas = container.querySelector('canvas');
	expect(canvas, 'canvas should be mounted').not.toBeNull();
	expect(canvas!.dataset.ready).toBe('true');
	return canvas!;
}

/** Records every message (flattening BATCH envelopes) while letting it pass through to the real worker. */
function spyWorkerMessages(): {
	sent: any[];
	spy: ReturnType<typeof vi.spyOn>;
	restore: () => void;
} {
	const sent: any[] = [];
	const original = Worker.prototype.postMessage;
	const spy = vi.spyOn(Worker.prototype, 'postMessage').mockImplementation(function (this: Worker, message: any, options?: any) {
		const flat = message?.type === WorkerMessageType.BATCH ? message.messages : [message];
		for (const item of flat) sent.push(item);
		return original.call(this, message, options);
	});
	return {
		sent,
		spy,
		restore: () => spy.mockRestore(),
	};
}

async function workerSnapshot(): Promise<WorkerLifecycleSnapshot> {
	return WebGLManagerProxy.inspectWorker();
}

async function waitForWorker(predicate: (snapshot: WorkerLifecycleSnapshot) => boolean): Promise<WorkerLifecycleSnapshot> {
	await vi.waitFor(
		async () => {
			expect(predicate(await workerSnapshot())).toBe(true);
		},
		{ timeout: 5000 }
	);
	return workerSnapshot();
}

describe('OffscreenWebGL lifecycle teardown', () => {
	let root: Root | null = null;
	let container: HTMLDivElement | null = null;
	let recorder: ReturnType<typeof spyWorkerMessages> | null = null;

	afterEach(() => {
		try {
			root?.unmount();
		} catch {}
		container?.remove();
		recorder?.restore();
		vi.restoreAllMocks();
		root = null;
		container = null;
		recorder = null;
	});

	function setupDom(): HTMLDivElement {
		container = document.createElement('div');
		document.body.appendChild(container);
		root = createRoot(container);
		return container;
	}

	it('releases the worker output context and manager on unmount and posts RELEASE', async () => {
		const dom = setupDom();
		recorder = spyWorkerMessages();
		root!.render(
			createElement('div', { style: { width: 4, height: 4 } }, createElement(OffscreenWebGL, { fragmentShader: redShader }))
		);

		const canvas = await vi.waitFor(() => readyCanvas(dom));
		await vi.waitFor(() => expect(pixel(canvas)).toEqual([255, 0, 0, 255]));

		const init = recorder.sent.find((message) => message.type === WorkerMessageType.INIT);
		expect(init).toBeTruthy();
		const { proxyId, canvasId } = init;

		recorder.sent.length = 0;
		root!.unmount();
		root = null;

		// Teardown messages are dispatched synchronously by the unmount cleanup.
		expect(
			recorder.sent.some(
				(message) => message.type === WorkerMessageType.CALL_METHOD && message.method === 'destroy' && message.proxyId === proxyId
			),
			'destroy call should be posted'
		).toBe(true);
		expect(
			recorder.sent.some((message) => message.type === WorkerMessageType.RELEASE && message.canvasId === canvasId),
			'RELEASE should be posted for the output canvas'
		).toBe(true);

		await waitForWorker((snapshot) => !snapshot.managers.includes(proxyId) && !snapshot.outputs.includes(canvasId));

		// Settling time must not produce additional RELEASE messages.
		const releaseCount = recorder.sent.filter((m) => m.type === WorkerMessageType.RELEASE && m.canvasId === canvasId).length;
		await sleep(50);
		expect(recorder.sent.filter((m) => m.type === WorkerMessageType.RELEASE && m.canvasId === canvasId)).toHaveLength(releaseCount);
	});

	it('destroys a proxy repeatedly without side effects and keeps another canvas rendering', async () => {
		recorder = spyWorkerMessages();
		const canvasA = document.createElement('canvas');
		const canvasB = document.createElement('canvas');
		for (const canvas of [canvasA, canvasB]) {
			canvas.width = 4;
			canvas.height = 4;
			document.body.appendChild(canvas);
		}
		const proxyA = new WebGLManagerProxy(canvasA);
		const proxyB = new WebGLManagerProxy(canvasB);
		const idA = (proxyA as any).PROXY_ID as string;
		const cidA = (proxyA as any).canvasId as string;
		const idB = (proxyB as any).PROXY_ID as string;

		try {
			await Promise.all([proxyA.setVertexShaderAsync(DEFAULT_VS_SHADER), proxyB.setVertexShaderAsync(DEFAULT_VS_SHADER)]);
			await Promise.all([proxyA.setFragmentShadersAsync([redShader]), proxyB.setFragmentShadersAsync([redShader])]);
			await Promise.all([proxyA.setupWholeScreenQuadAsync(), proxyB.setupWholeScreenQuadAsync()]);
			await Promise.all([proxyA.updateUniformAsync('u_resolution', [4, 4]), proxyB.updateUniformAsync('u_resolution', [4, 4])]);
			await Promise.all([proxyA.resizeAsync(4, 4), proxyB.resizeAsync(4, 4)]);
			await vi.waitFor(() => {
				expect(pixel(canvasA)).toEqual([255, 0, 0, 255]);
				expect(pixel(canvasB)).toEqual([255, 0, 0, 255]);
			});

			recorder.sent.length = 0;
			await proxyA.destroyAsync();
			// Repeated async/sync destruction must be safe no-ops.
			await proxyA.destroyAsync();
			expect(() => {
				proxyA.destroy();
				(proxyA as any).release();
				(proxyA as any).dispose();
			}).not.toThrow();

			expect(recorder.sent.filter((m) => m.type === WorkerMessageType.RELEASE && m.canvasId === cidA)).toHaveLength(1);
			await waitForWorker((s) => !s.managers.includes(idA) && !s.outputs.includes(cidA) && s.managers.includes(idB));

			// The sibling proxy must still accept calls and paint.
			await proxyB.paintCanvasAsync();
			await vi.waitFor(() => expect(pixel(canvasB)).toEqual([255, 0, 0, 255]));

			// Calls against the destroyed proxy must not reach the worker.
			recorder.sent.length = 0;
			proxyA.updateUniforms({ u_color: [0, 1, 0] } as any);
			proxyA.paintCanvas();
			await expect(proxyA.paintCanvasAsync()).rejects.toThrow(/not initialized/);
			await sleep(20);
			expect(recorder.sent.some((m) => m.proxyId === idA)).toBe(false);
		} finally {
			await proxyB.destroyAsync().catch(() => {});
			canvasA.remove();
			canvasB.remove();
		}
	});

	it('stops draw/update messages for an unmounted canvas while the other keeps streaming', async () => {
		const dom = setupDom();
		recorder = spyWorkerMessages();
		const stream = createUniformStream({ u_color: [1, 0, 0] });

		const instance = (key: string) =>
			createElement(
				'div',
				{ key, 'data-instance': key, style: { width: '4px', height: '4px' } },
				createElement(OffscreenWebGL, { fragmentShader: colorShader, uniformStream: stream, refreshRate: 60 })
			);

		// Mount A first so its INIT/proxy id is unambiguous.
		root!.render(createElement('div', null, instance('a')));
		const canvasA = await vi.waitFor(() => {
			const canvas = dom.querySelector<HTMLCanvasElement>('[data-instance="a"] canvas')!;
			expect(canvas?.dataset.ready).toBe('true');
			return canvas;
		});
		await vi.waitFor(() => expect(pixel(canvasA)).toEqual([255, 0, 0, 255]));
		const initA = recorder.sent.find((m) => m.type === WorkerMessageType.INIT)!;
		const idA = initA.proxyId as string;
		const cidA = initA.canvasId as string;

		// Add B sharing the same stream/worker.
		root!.render(createElement('div', null, instance('a'), instance('b')));
		const canvasB = await vi.waitFor(() => {
			const canvas = dom.querySelector<HTMLCanvasElement>('[data-instance="b"] canvas')!;
			expect(canvas?.dataset.ready).toBe('true');
			return canvas;
		});
		await vi.waitFor(() => {
			expect(pixel(canvasA)).toEqual([255, 0, 0, 255]);
			expect(pixel(canvasB)).toEqual([255, 0, 0, 255]);
		});
		const idB = recorder.sent
			.filter((m) => m.type === WorkerMessageType.INIT)
			.map((m) => m.proxyId)
			.find((id) => id !== idA)!;
		expect(idB).toBeTruthy();

		// Unmount A, keep B.
		root!.render(createElement('div', null, instance('b')));
		await vi.waitFor(() => expect(dom.querySelector('[data-instance="a"]')).toBeNull());
		await waitForWorker((s) => !s.managers.includes(idA) && !s.outputs.includes(cidA) && s.managers.includes(idB));

		// Whatever is currently presented on A is the last frame it ever shows.
		await sleep(60);
		const frozenA = pixel(canvasA);

		recorder.sent.length = 0;
		stream.set('u_color', [0, 1, 0]);
		await vi.waitFor(() => expect(pixel(canvasB)).toEqual([0, 255, 0, 255]));
		stream.set('u_color', [0, 0, 1]);
		await vi.waitFor(() => expect(pixel(canvasB)).toEqual([0, 0, 255, 255]));
		await sleep(120);

		// No message of any kind may target the destroyed proxy after unmount.
		expect(recorder.sent.some((m) => m.proxyId === idA)).toBe(false);
		// The detached canvas must not have been painted again.
		expect(pixel(canvasA)).toEqual(frozenA);

		if (!crossOriginIsolated) {
			// Main-thread fallback stream drives B through update + paint messages.
			const methodsForB = recorder.sent
				.filter((m) => m.proxyId === idB && m.type === WorkerMessageType.CALL_METHOD)
				.map((m) => m.method);
			expect(methodsForB).toContain('updateUniforms');
			expect(methodsForB).toContain('paintCanvas');
		}
	});

	it('does not resurrect manager or output when INIT arrives after unmount', async () => {
		const dom = setupDom();
		const original = Worker.prototype.postMessage;
		let held: { message: any; options: any; worker: Worker } | null = null;
		recorder = spyWorkerMessages();
		// Replace the pass-through implementation with one that pins the first INIT.
		recorder.spy.mockImplementation(function (this: Worker, message: any, options?: any) {
			if (message?.type === WorkerMessageType.INIT && !held) {
				held = { message, options, worker: this };
				return;
			}
			return original.call(this, message, options);
		});

		root!.render(
			createElement('div', { style: { width: 4, height: 4 } }, createElement(OffscreenWebGL, { fragmentShader: redShader }))
		);
		await vi.waitFor(() => expect(held).not.toBeNull(), { timeout: 5000 });
		const { proxyId, canvasId } = held!.message;

		// Unmount while INIT is still in flight; destroy + RELEASE reach the worker first.
		root!.unmount();
		root = null;
		await waitForWorker((s) => s.releasedCanvases.includes(canvasId) && !s.managers.includes(proxyId));

		// Deliver the late INIT.
		original.call(held!.worker, held!.message, held!.options);
		await sleep(80);

		const snapshot = await workerSnapshot();
		expect(snapshot.managers).not.toContain(proxyId);
		expect(snapshot.outputs).not.toContain(canvasId);
		// The late INIT is consumed by the tombstone rather than registered.
		expect(snapshot.canvasProxies.some(([id]) => id === canvasId)).toBe(false);
	});

	it('survives unmounting before ready repeatedly without leaking worker state', async () => {
		const dom = setupDom();
		recorder = spyWorkerMessages();

		for (let i = 0; i < 5; i++) {
			const container = document.createElement('div');
			container.style.width = '4px';
			container.style.height = '4px';
			dom.appendChild(container);
			const localRoot = createRoot(container);
			const seen = recorder.sent.length;
			localRoot.render(createElement(OffscreenWebGL, { fragmentShader: redShader }));
			// As soon as INIT is dispatched, teardown is safe to trigger: setup may
			// still be waiting on worker acknowledgements ("not ready yet").
			await vi.waitFor(() => expect(recorder.sent.slice(seen).some((m) => m.type === WorkerMessageType.INIT)).toBe(true), {
				timeout: 5000,
			});
			localRoot.unmount();
			container.remove();
		}

		const initIds = recorder.sent.filter((m) => m.type === WorkerMessageType.INIT).map((m) => m.proxyId as string);
		const canvasIds = recorder.sent.filter((m) => m.type === WorkerMessageType.INIT).map((m) => m.canvasId as string);
		expect(initIds.length).toBeGreaterThan(0);
		await waitForWorker((s) => initIds.every((id) => !s.managers.includes(id)) && canvasIds.every((id) => !s.outputs.includes(id)));
	});
});
