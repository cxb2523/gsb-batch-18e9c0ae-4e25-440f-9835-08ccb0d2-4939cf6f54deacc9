import { createServer } from 'node:net';
import { defineConfig } from 'vitest/config';

const headed = process.env.HEADED === 'true';
const isolated = process.env.CROSS_ORIGIN_ISOLATED === 'true';

async function canListen(port: number, host: string): Promise<boolean> {
	return new Promise((resolve) => {
		const server = createServer();
		server.once('error', () => resolve(false));
		server.once('listening', () => server.close(() => resolve(true)));
		server.listen(port, host);
	});
}

async function findFreePort(host: string): Promise<number> {
	return new Promise((resolve, reject) => {
		const server = createServer();
		server.once('error', reject);
		server.listen(0, host, () => {
			const { port } = server.address() as { port: number };
			server.close(() => resolve(port));
		});
	});
}

/**
 * Vitest's fixed browser API port can sit inside an OS-excluded port range on
 * some Windows hosts (listen fails with EACCES). Keep the upstream default
 * wherever it works, honor an explicit override, and otherwise fall back to a
 * free loopback port so the browser suite stays executable locally.
 */
async function resolveBrowserApi(): Promise<{ host: '127.0.0.1'; port: number } | undefined> {
	if (process.env.VITEST_BROWSER_PORT) return { host: '127.0.0.1', port: Number(process.env.VITEST_BROWSER_PORT) };
	const [ipv4, ipv6] = await Promise.all([canListen(63315, '127.0.0.1'), canListen(63315, '::1')]);
	if (ipv4 && ipv6) return undefined;
	return { host: '127.0.0.1', port: await findFreePort('127.0.0.1') };
}

export default defineConfig(async () => {
	const api = await resolveBrowserApi();
	const browser = () => ({
		enabled: true,
		provider: 'playwright' as const,
		headless: !headed,
		...(api ? { api } : {}),
		instances: [
			{
				browser: 'chromium' as const,
				launch: {
					channel: 'chromium',
					args: ['--no-sandbox', '--disable-setuid-sandbox', '--enable-webgl', '--use-gl=angle'],
				},
			},
		],
	});

	return {
		server: {
			headers: isolated ? { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' } : {},
		},
		optimizeDeps: { include: ['react/jsx-dev-runtime'] },
		test: {
			projects: [
				{
					test: {
						name: 'unit',
						include: ['tests/unit/**/*.test.ts'],
						environment: 'node',
					},
				},
				{
					extends: true,
					test: {
						name: 'browser',
						include: ['tests/browser/**/*.test.ts'],
						provide: { isolated },
						browser: browser(),
					},
				},
			],
		},
	};
});
