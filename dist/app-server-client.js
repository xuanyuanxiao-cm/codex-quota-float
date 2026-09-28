"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppServerClient = void 0;
exports.resolveAppServerCommand = resolveAppServerCommand;
const node_child_process_1 = require("node:child_process");
const node_crypto_1 = require("node:crypto");
const node_fs_1 = require("node:fs");
const { readAccountKey } = require('./account-identity');
const node_path_1 = __importDefault(require("node:path"));
const DEFAULT_COMMAND = 'codex';
const DEFAULT_ARGS = ['app-server', '--stdio'];
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
function resolveAppServerCommand(options = {}) {
    const env = options.env ?? process.env;
    if (env.CODEX_CLI_PATH) {
        return env.CODEX_CLI_PATH;
    }
    const localAppData = env.LOCALAPPDATA;
    if (localAppData) {
        const commandRoot = node_path_1.default.join(localAppData, 'OpenAI', 'Codex', 'bin');
        const exists = options.exists ?? node_fs_1.existsSync;
        const readDirectory = options.readDirectory ?? ((directory) => (0, node_fs_1.readdirSync)(directory));
        try {
            for (const version of readDirectory(commandRoot).sort().reverse()) {
                const candidate = node_path_1.default.join(commandRoot, version, 'codex.exe');
                if (exists(candidate)) {
                    return candidate;
                }
            }
        }
        catch {
            // The desktop CLI folder is optional; fall back to the shell command below.
        }
    }
    return DEFAULT_COMMAND;
}
const defaultSpawn = (command, args) => {
    const shell = process.platform === 'win32' && (/\.(?:cmd|bat)$/i.test(command) || command === DEFAULT_COMMAND);
    return (0, node_child_process_1.spawn)(shell ? `"${command}"` : command, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        shell,
        windowsHide: true,
        cwd: process.env.CODEX_QUOTA_FLOAT_APP_SERVER_CWD || undefined,
    });
};
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function rpcError(value) {
    if (isRecord(value) && typeof value.message === 'string') {
        return new Error(value.message);
    }
    return new Error(typeof value === 'string' ? value : 'JSON-RPC request failed');
}
class AppServerClient {
    command;
    args;
    spawnImpl;
    requestTimeoutMs;
    child;
    nextRequestId = 1;
    pending = new Map();
    resetAttemptKeys = new Map();
    listeners = new Set();
    inputBuffer = '';
    startPromise;
    initialized = false;
    constructor(options) {
        this.getAccountKey = options?.getAccountKey ?? readAccountKey;
        this.command = options?.command ?? process.env.CODEX_QUOTA_FLOAT_APP_SERVER_COMMAND ?? resolveAppServerCommand();
        this.args = [...(options?.args ?? DEFAULT_ARGS)];
        this.spawnImpl = options?.spawnImpl ?? defaultSpawn;
        this.requestTimeoutMs = options?.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    }
    start() {
        if (this.initialized) {
            return Promise.resolve();
        }
        if (this.startPromise) {
            return this.startPromise;
        }
        const operation = this.startInternal().catch((error) => {
            if (this.startPromise === operation)
                this.startPromise = undefined;
            throw error;
        });
        this.startPromise = operation;
        return operation;
    }
    async startInternal() {
        this.nextRequestId = 1;
        this.inputBuffer = '';
        this.child = this.spawnImpl(this.command, this.args);
        const child = this.child;
        this.attachChild(child);
        try {
            await this.sendRequest('initialize', {
                clientInfo: {
                    name: 'codex-quota-float',
                    title: 'Codex Quota Float',
                    version: '0.1.0',
                },
                capabilities: {},
            });
            if (this.child !== child)
                throw new Error('AppServerClient connection ended during initialization');
            this.sendNotification('initialized');
            this.initialized = true;
        }
        catch (error) {
            this.disconnectChild(child, error);
            throw error;
        }
    }
    async readRateLimits(onReading) {
        const accountKey = this.getAccountKey();
        if (this.initialized && this.lastAccountKey !== undefined && accountKey !== this.lastAccountKey) await this.stop();
        if (!this.initialized || !this.child) {
            await this.start();
        }
        this.lastAccountKey = accountKey;
        return this.sendRequest('account/rateLimits/read', undefined, (result) => {
            if (accountKey !== this.getAccountKey()) throw new Error('Account changed during quota read');
            if (!isRecord(result) || !('rateLimits' in result)) {
                throw new Error('Invalid rate limits response');
            }
            const reading = {
                ...(accountKey ? { accountKey } : {}),
                rateLimits: result.rateLimits,
                rateLimitResetCredits: isRecord(result.rateLimitResetCredits)
                    ? result.rateLimitResetCredits
                    : null,
            };
            // Apply the reply before parsing any later notification in this chunk.
            onReading?.(reading);
            return reading;
        });
    }
    consumeRateLimitResetCredit(creditId) {
        if (!this.initialized || !this.child) {
            return Promise.reject(new Error('AppServerClient is not started'));
        }
        const idempotencyKey = this.resetAttemptKeys.get(creditId) ?? (0, node_crypto_1.randomUUID)();
        // Preserve the key after an uncertain failure so a retry cannot redeem twice.
        this.resetAttemptKeys.set(creditId, idempotencyKey);
        return this.sendRequest('account/rateLimitResetCredit/consume', { creditId, idempotencyKey }).then((result) => {
            if (!isRecord(result) || typeof result.outcome !== 'string') {
                throw new Error('Invalid reset credit response');
            }
            this.resetAttemptKeys.delete(creditId);
            return result;
        });
    }
    onRateLimitsUpdated(listener) {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }
    async stop() {
        const child = this.child;
        this.initialized = false;
        this.startPromise = undefined;
        if (!child) {
            this.rejectPending(new Error('AppServerClient stopped'));
            return;
        }
        this.disconnectChild(child, new Error('AppServerClient stopped'));
    }
    attachChild(child) {
        // Drain unused diagnostics so a full stderr pipe cannot block RPC replies.
        child.stderr?.resume?.();
        child.stdout.on('data', (chunk) => this.handleData(child, chunk));
        child.stdin.on?.('error', (error) => this.disconnectChild(child, error));
        child.on('error', (error) => this.disconnectChild(child, error));
        child.on('exit', (code, signal) => this.handleChildEnded(child, new Error(`AppServerClient child exited (code=${code ?? 'unknown'}, signal=${signal ?? 'none'})`)));
        child.on('close', (code, signal) => this.handleChildEnded(child, new Error(`AppServerClient child closed (code=${code ?? 'unknown'}, signal=${signal ?? 'none'})`)));
    }
    disconnectChild(child, error) {
        if (this.child !== child)
            return;
        this.handleChildEnded(child, error);
        child.stdin.end?.();
        child.kill?.();
    }
    handleChildEnded(child, error) {
        if (this.child !== child) {
            return;
        }
        this.child = undefined;
        this.initialized = false;
        this.startPromise = undefined;
        this.inputBuffer = '';
        this.rejectPending(error);
    }
    handleData(child, chunk) {
        if (this.child !== child) {
            return;
        }
        this.inputBuffer += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
        let newlineIndex = this.inputBuffer.indexOf('\n');
        while (newlineIndex >= 0) {
            const line = this.inputBuffer.slice(0, newlineIndex).trim();
            this.inputBuffer = this.inputBuffer.slice(newlineIndex + 1);
            newlineIndex = this.inputBuffer.indexOf('\n');
            if (!line) {
                continue;
            }
            try {
                this.handleMessage(JSON.parse(line));
            }
            catch {
                // Malformed messages are ignored so one bad line cannot break the stream.
            }
        }
    }
    handleMessage(message) {
        if (!isRecord(message)) {
            return;
        }
        if (typeof message.id === 'number') {
            const pending = this.pending.get(message.id);
            if (!pending) {
                return;
            }
            this.pending.delete(message.id);
            clearTimeout(pending.timer);
            if ('error' in message) {
                pending.reject(rpcError(message.error));
            }
            else {
                pending.resolve(message.result);
            }
            return;
        }
        if (message.method !== 'account/rateLimits/updated' || !isRecord(message.params)) {
            return;
        }
        const snapshot = message.params.rateLimits;
        if (!isRecord(snapshot)) {
            return;
        }
        if (this.lastAccountKey !== undefined && this.lastAccountKey !== this.getAccountKey()) return;
        for (const listener of this.listeners) {
            listener(snapshot);
        }
    }
    sendNotification(method) {
        const child = this.child;
        if (!child) {
            throw new Error('AppServerClient child is not running');
        }
        child.stdin.write(`${JSON.stringify({ method })}\n`);
    }
    sendRequest(method, params, transformResult) {
        const child = this.child;
        if (!child) {
            return Promise.reject(new Error('AppServerClient child is not running'));
        }
        const id = this.nextRequestId++;
        const message = params === undefined ? { method, id } : { method, id, params };
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                const error = new Error(`AppServerClient request timed out: ${method}`);
                error.code = 'APP_SERVER_TIMEOUT';
                this.disconnectChild(child, error);
            }, this.requestTimeoutMs);
            this.pending.set(id, { resolve: (result) => {
                try { resolve(transformResult ? transformResult(result) : result); }
                catch (error) { reject(error); }
            }, reject, timer });
            try {
                child.stdin.write(`${JSON.stringify(message)}\n`);
            }
            catch (error) {
                this.disconnectChild(child, error instanceof Error ? error : new Error(String(error)));
            }
        });
    }
    rejectPending(error) {
        const requests = [...this.pending.values()];
        this.pending.clear();
        for (const request of requests) {
            clearTimeout(request.timer);
            request.reject(error);
        }
    }
}
exports.AppServerClient = AppServerClient;
