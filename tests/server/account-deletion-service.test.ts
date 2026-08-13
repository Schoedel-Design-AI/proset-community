import assert from "node:assert/strict";
import test from "node:test";
import { deleteAuthUserIfPresent } from "../../server/account-deletion-service";

test("account deletion removes the authentication identity", async () => {
  const deleted: string[] = [];
  await deleteAuthUserIfPresent({
    async deleteUser(userId) {
      deleted.push(userId);
    },
  }, "user-1");

  assert.deepEqual(deleted, ["user-1"]);
});

test("account deletion tolerates an already-absent authentication identity", async () => {
  await assert.doesNotReject(() => deleteAuthUserIfPresent({
    async deleteUser() {
      throw { errorInfo: { code: "auth/user-not-found" } };
    },
  }, "user-1"));
});

test("account deletion stops when authentication deletion fails", async () => {
  await assert.rejects(() => deleteAuthUserIfPresent({
    async deleteUser() {
      throw { code: "auth/internal-error" };
    },
  }, "user-1"), (error: { code?: string }) => error.code === "auth/internal-error");
});
