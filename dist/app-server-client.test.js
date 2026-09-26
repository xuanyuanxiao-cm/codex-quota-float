"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_events_1 = require("node:events");
const vitest_1 = require("vitest");
const app_server_client_1 = require("./app-server-client");
class FakeStdin {
    writes = [];
    ended = false;
    write(data) {
        this.writes.push(data);
        return true;
    }
    end() {
        this.ended = true;
    }
}
class FakeChild extends node_events_1.EventEmitter {
    stdin = new FakeStdin();
    stdout = new node_events_1.EventEmitter();
    stderr = new node_events_1.EventEmitter();
    killed = false;
    kill() {
        this.killed = true;
        this.emit('exit', 0, null);
    }
    send(message) {
        this.stdout.emit('data', `${JSON.stringify(message)}\n`);
    }
    sendRaw(data) {
        this.stdout.emit('data', data);
    }
}
function createClient() {
    const child = new FakeChild();
    const spawnImpl = () => child;
    return { client: new app_server_client_1.AppServerClient({ spawnImpl }), child, spawnImpl };
}
async function completeInitialization(client, child) {
    const starting = client.start();
    (0, vitest_1.expect)(child.stdin.writes).toHaveLength(1);
    (0, vitest_1.expect)(JSON.parse(child.stdin.writes[0])).toEqual({
        method: 'initialize',
        id: 1,
        params: {
            clientInfo: {
                name: 'codex-quota-float',
                title: 'Codex Quota Float',
                version: '0.1.0',
            },
            capabilities: {},
        },
    });
    child.send({ id: 1, result: {} });
    await starting;
    (0, vitest_1.expect)(JSON.parse(child.stdin.writes[1])).toEqual({ method: 'initialized' });
}
(0, vitest_1.describe)('AppServerClient', () => {
    (0, vitest_1.test)('prefers the Codex desktop CLI path over the denied WindowsApps command', () => {
        const command = (0, app_server_client_1.resolveAppServerCommand)({
            env: {
                CODEX_CLI_PATH: 'C:\\Users\\tester\\AppData\\Local\\OpenAI\\Codex\\bin\\current\\codex.exe',
                LOCALAPPDATA: 'C:\\Users\\tester\\AppData\\Local',
            },
        });
        (0, vitest_1.expect)(command).toBe('C:\\Users\\tester\\AppData\\Local\\OpenAI\\Codex\\bin\\current\\codex.exe');
    });
    (0, vitest_1.test)('discovers the bundled desktop CLI when no environment path is provided', () => {
        const command = (0, app_server_client_1.resolveAppServerCommand)({
            env: { LOCALAPPDATA: 'C:\\Users\\tester\\AppData\\Local' },
            readDirectory: () => ['older', 'current'],
            exists: (candidate) => candidate.endsWith('current\\codex.exe'),
        });
        (0, vitest_1.expect)(command).toBe('C:\\Users\\tester\\AppData\\Local\\OpenAI\\Codex\\bin\\current\\codex.exe');
    });
    (0, vitest_1.test)('sends initialize before initialized notification', async () => {
        const { client, child } = createClient();
        await completeInitialization(client, child);
    });
    (0, vitest_1.test)('returns rate limits together with reset credits', async () => {
        const { client, child } = createClient();
        await completeInitialization(client, child);
        const result = {
            primary: { usedPercent: 15, resetsAt: 123 },
            secondary: { usedPercent: 30 },
        };
        const resetCredits = {
            credits: [{
                    id: 'credit-1',
                    status: 'available',
                    resetType: 'windows_reset',
                    grantedAt: 1_700_000_000,
                    expiresAt: 1_700_086_400,
                    title: 'Quota reset',
                    description: 'Reset the current quota window',
                }],
            availableCount: 1,
        };
        const reading = client.readRateLimits();
        (0, vitest_1.expect)(JSON.parse(child.stdin.writes[2])).toEqual({
            method: 'account/rateLimits/read',
            id: 2,
        });
        child.send({ id: 99, result: { ignored: true } });
        child.send({ id: 2, result: { rateLimits: result, rateLimitResetCredits: resetCredits } });
        await (0, vitest_1.expect)(reading).resolves.toEqual({
            rateLimits: result,
            rateLimitResetCredits: resetCredits,
        });
    });
    (0, vitest_1.test)('delivers rate limit update notifications and supports unsubscribe', async () => {
        const { client, child } = createClient();
        await completeInitialization(client, child);
        const snapshots = [];
        const unsubscribe = client.onRateLimitsUpdated((snapshot) => snapshots.push(snapshot));
        const first = { primary: { usedPercent: 20 } };
        const second = { secondary: { usedPercent: 40 } };
        child.send({ method: 'account/rateLimits/updated', params: { rateLimits: first } });
        unsubscribe();
        child.send({ method: 'account/rateLimits/updated', params: { rateLimits: second } });
        (0, vitest_1.expect)(snapshots).toEqual([first]);
    });
    (0, vitest_1.test)('consumes the selected reset credit', async () => {
        const { client, child } = createClient();
        await completeInitialization(client, child);
        const consuming = client.consumeRateLimitResetCredit('credit-1');
        (0, vitest_1.expect)(JSON.parse(child.stdin.writes[2])).toEqual({
            method: 'account/rateLimitResetCredit/consume',
            id: 2,
            params: { creditId: 'credit-1', idempotencyKey: vitest_1.expect.any(String) },
        });
        child.send({ id: 2, result: { outcome: 'reset' } });
        await (0, vitest_1.expect)(consuming).resolves.toEqual({ outcome: 'reset' });
    });
    (0, vitest_1.test)('rejects a request when the JSON-RPC response has an error', async () => {
        const { client, child } = createClient();
        await completeInitialization(client, child);
        const reading = client.readRateLimits();
        child.send({ id: 2, error: { code: -32000, message: 'not authorized' } });
        await (0, vitest_1.expect)(reading).rejects.toThrow('not authorized');
    });
    (0, vitest_1.test)('rejects pending requests when the child exits', async () => {
        const { client, child } = createClient();
        await completeInitialization(client, child);
        const reading = client.readRateLimits();
        child.emit('exit', 1, null);
        await (0, vitest_1.expect)(reading).rejects.toThrow('exited');
    });
    (0, vitest_1.test)('ignores malformed lines and unknown notifications', async () => {
        const { client, child } = createClient();
        await completeInitialization(client, child);
        (0, vitest_1.expect)(() => child.sendRaw('{not-json}\n')).not.toThrow();
        (0, vitest_1.expect)(() => child.send({ method: 'unknown/event', params: {} })).not.toThrow();
    });
    (0, vitest_1.test)('ends the child cleanly on stop', async () => {
        const { client, child } = createClient();
        await completeInitialization(client, child);
        await client.stop();
        (0, vitest_1.expect)(child.stdin.ended).toBe(true);
        (0, vitest_1.expect)(child.killed).toBe(true);
    });
    (0, vitest_1.test)('uses an environment command override when no command option is supplied', async () => {
        const previous = process.env.CODEX_QUOTA_FLOAT_APP_SERVER_COMMAND;
        process.env.CODEX_QUOTA_FLOAT_APP_SERVER_COMMAND = 'mock-codex';
        try {
            const child = new FakeChild();
            let spawnedCommand = '';
            const client = new app_server_client_1.AppServerClient({
                spawnImpl: (command, args) => {
                    spawnedCommand = `${command} ${args.join(' ')}`;
                    return child;
                },
            });
            const starting = client.start();
            child.send({ id: 1, result: {} });
            await starting;
            (0, vitest_1.expect)(spawnedCommand).toBe('mock-codex app-server --stdio');
            await client.stop();
        }
        finally {
            if (previous === undefined) {
                delete process.env.CODEX_QUOTA_FLOAT_APP_SERVER_COMMAND;
            }
            else {
                process.env.CODEX_QUOTA_FLOAT_APP_SERVER_COMMAND = previous;
            }
        }
    });
});
