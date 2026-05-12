import { randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { rm } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import path from "node:path";

import type { RuntimeConfig } from "../config/index.js";
import type { HostedFileLink } from "../types/download.js";
import type { Logger } from "../utils/logger.js";

interface HostedFileEntry {
  cleanupPath: string;
  expiresAt: Date;
  fileName: string;
  filePath: string;
  token: string;
}

interface RegisterHostedFileOptions {
  cleanupPath: string;
  fileName: string;
  filePath: string;
}

export class TemporaryFileHost {
  private cleanupInterval: NodeJS.Timeout | undefined;
  private readonly entries = new Map<string, HostedFileEntry>();
  private server: Server | undefined;

  public constructor(
    private readonly config: RuntimeConfig,
    private readonly logger: Logger,
  ) {}

  public async start(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const server = createServer((request, response) => {
        void this.handleRequest(request, response);
      });

      const onError = (error: Error) => {
        reject(error);
      };

      this.server = server;
      server.once("error", onError);
      server.listen(this.config.HTTP_PORT, () => {
        server.off("error", onError);
        resolve();
      });
    });

    this.cleanupInterval = setInterval(() => {
      void this.cleanupExpiredEntries();
    }, 60_000);
    this.cleanupInterval.unref?.();

    this.logger.info("Temporary file host started", {
      httpPort: this.config.HTTP_PORT,
      publicBaseUrl: this.config.PUBLIC_BASE_URL,
    });
  }

  public register(options: RegisterHostedFileOptions): HostedFileLink {
    const token = createOpaqueToken();
    const expiresAt = new Date(Date.now() + this.config.TEMP_FILE_TTL_MS);

    this.entries.set(token, {
      cleanupPath: options.cleanupPath,
      expiresAt,
      fileName: path.basename(options.fileName),
      filePath: options.filePath,
      token,
    });

    this.logger.info("Hosted file registered", {
      expiresAt: expiresAt.toISOString(),
      token,
    });

    return {
      token,
      url: buildHostedFileUrl(this.config.PUBLIC_BASE_URL, token, options.fileName),
      expiresAt,
    };
  }

  public async cleanupExpiredEntries(now: Date = new Date()): Promise<void> {
    const expiredEntries = [...this.entries.values()].filter((entry) => entry.expiresAt <= now);

    for (const entry of expiredEntries) {
      await this.deleteEntry(entry);
    }
  }

  public async stop(): Promise<void> {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }

    const activeEntries = [...this.entries.values()];
    for (const entry of activeEntries) {
      await this.deleteEntry(entry);
    }

    if (!this.server) {
      return;
    }

    const server = this.server;
    this.server = undefined;

    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }

  private async handleRequest(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    if (request.method !== "GET") {
      response.writeHead(405, { Allow: "GET" });
      response.end("Method not allowed");
      return;
    }

    const parsedUrl = new URL(request.url ?? "/", "http://localhost");
    const routeMatch = /^\/downloads\/([^/]+)\/([^/]+)$/u.exec(parsedUrl.pathname);

    if (!routeMatch) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }

    const [, token] = routeMatch;
    const entry = this.entries.get(token ?? "");

    if (!entry) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }

    if (entry.expiresAt <= new Date()) {
      await this.deleteEntry(entry);
      response.writeHead(404);
      response.end("Not found");
      return;
    }

    const stream = createReadStream(entry.filePath);
    let streamOpened = false;

    stream.once("open", () => {
      streamOpened = true;
      response.writeHead(200, {
        "Cache-Control": "private, no-store, max-age=0",
        "Content-Disposition": `attachment; filename="${sanitizeHeaderValue(entry.fileName)}"`,
        "Content-Type": "application/octet-stream",
      });
      stream.pipe(response);
    });
    stream.once("error", async () => {
      await this.deleteEntry(entry);

      if (!streamOpened) {
        response.writeHead(404);
        response.end("Not found");
        return;
      }

      response.destroy();
    });
  }

  private async deleteEntry(entry: HostedFileEntry): Promise<void> {
    this.entries.delete(entry.token);

    try {
      await rm(entry.cleanupPath, {
        force: true,
        recursive: true,
      });
    } catch (error: unknown) {
      this.logger.warn("Failed to remove hosted file cleanup path", {
        cleanupPath: entry.cleanupPath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export function buildHostedFileUrl(baseUrl: string, token: string, fileName: string): string {
  const normalizedBaseUrl = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return new URL(`downloads/${token}/${encodeURIComponent(path.basename(fileName))}`, normalizedBaseUrl).toString();
}

function createOpaqueToken(): string {
  return randomBytes(18).toString("base64url");
}

function sanitizeHeaderValue(value: string): string {
  return value.replace(/["\r\n]/gu, "_");
}
