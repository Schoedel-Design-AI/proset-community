import assert from "node:assert/strict";
import test from "node:test";

import { resolveDeploymentInfo } from "../../server/deployment-info";

test("resolveDeploymentInfo prefers explicit env metadata", () => {
  const info = resolveDeploymentInfo(
    {
      APP_GIT_SHA: "af12c51987654321",
      APP_GIT_BRANCH: "main",
      APP_BUILD_TIME: "2026-05-20T12:34:56.000Z",
    } as unknown as NodeJS.ProcessEnv,
    {
      execCommand: () => {
        throw new Error("git should not be invoked when env metadata is present");
      },
      now: "2026-05-20T14:00:00.000Z",
      packageVersion: "1.0.6",
    },
  );

  assert.equal(info.gitSha, "af12c51987654321");
  assert.equal(info.shortSha, "af12c51");
  assert.equal(info.branch, "main");
  assert.equal(info.builtAt, "2026-05-20T12:34:56.000Z");
  assert.equal(info.startedAt, "2026-05-20T14:00:00.000Z");
  assert.equal(info.version, "1.0.6");
  assert.equal(info.sources.gitSha, "env");
  assert.equal(info.sources.branch, "env");
  assert.equal(info.sources.builtAt, "env");
});

test("resolveDeploymentInfo falls back to git commands when env metadata is absent", () => {
  const commands: string[] = [];
  const info = resolveDeploymentInfo(
    {} as unknown as NodeJS.ProcessEnv,
    {
      execCommand: (command) => {
        commands.push(command);
        if (command === "git rev-parse HEAD") {
          return "0123456789abcdef0123456789abcdef01234567\n";
        }
        if (command === "git rev-parse --abbrev-ref HEAD") {
          return "feature/deploy-info\n";
        }
        throw new Error(`Unexpected command: ${command}`);
      },
      now: "2026-05-20T15:00:00.000Z",
      packageVersion: "1.0.6",
    },
  );

  assert.deepEqual(commands, ["git rev-parse HEAD", "git rev-parse --abbrev-ref HEAD"]);
  assert.equal(info.gitSha, "0123456789abcdef0123456789abcdef01234567");
  assert.equal(info.shortSha, "0123456");
  assert.equal(info.branch, "feature/deploy-info");
  assert.equal(info.builtAt, null);
  assert.equal(info.sources.gitSha, "git");
  assert.equal(info.sources.branch, "git");
  assert.equal(info.sources.builtAt, "missing");
});

test("resolveDeploymentInfo uses baked file metadata when env values are unknown sentinels", () => {
  const info = resolveDeploymentInfo(
    {
      APP_GIT_SHA: "unknown",
      APP_GIT_BRANCH: "unknown",
      APP_BUILD_TIME: "",
    } as unknown as NodeJS.ProcessEnv,
    {
      execCommand: () => {
        throw new Error("git should not be invoked when baked metadata is present");
      },
      now: "2026-05-20T16:00:00.000Z",
      fileMetadata: {
        gitSha: "4c8678b1234567890fedcba",
        branch: "main",
        builtAt: "2026-05-20T15:45:00.000Z",
        version: "1.0.6",
      },
    },
  );

  assert.equal(info.gitSha, "4c8678b1234567890fedcba");
  assert.equal(info.shortSha, "4c8678b");
  assert.equal(info.branch, "main");
  assert.equal(info.builtAt, "2026-05-20T15:45:00.000Z");
  assert.equal(info.startedAt, "2026-05-20T16:00:00.000Z");
  assert.equal(info.version, "1.0.6");
  assert.equal(info.sources.gitSha, "file");
  assert.equal(info.sources.branch, "file");
  assert.equal(info.sources.builtAt, "file");
});