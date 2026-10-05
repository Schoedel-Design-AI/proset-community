import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  NAMED_THREAD_LIMIT,
  deleteThreadWarningCopy,
  recordingsAffectedByDelete,
  threadsAffectedByDelete,
} from "../../shared/recording-delete-warning";

/**
 * The warning shown before a note that a Thought Thread uses is deleted.
 *
 * These are the decisions worth testing: whether to warn at all, which sentence
 * to use, and whether the names a user reads are de-duplicated and capped. The
 * translation itself is not this module's business, so it is not asserted here.
 */

test("nothing is affected, so there is no warning to show", () => {
  assert.equal(deleteThreadWarningCopy({}), null);
});

test("a recording used by one thread names that thread", () => {
  const copy = deleteThreadWarningCopy({ "rec-1": [{ id: "t1", title: "Alpha" }] });
  assert.deepEqual(copy, { key: "record.deleteUsedInThreadOne", params: { titles: "Alpha" } });
});

test("a recording used by two threads says how many and names them", () => {
  const copy = deleteThreadWarningCopy({
    "rec-1": [
      { id: "t1", title: "Alpha" },
      { id: "t2", title: "Beta" },
    ],
  });
  assert.deepEqual(copy, {
    key: "record.deleteUsedInThreads",
    params: { count: 2, titles: "Alpha, Beta" },
  });
});

test("two recordings in the SAME thread count as one thread and one name", () => {
  const usage = {
    "rec-1": [{ id: "t1", title: "Alpha" }],
    "rec-2": [{ id: "t1", title: "Alpha" }],
  };
  assert.equal(threadsAffectedByDelete(usage).length, 1);
  assert.equal(recordingsAffectedByDelete(usage), 2);
  assert.deepEqual(deleteThreadWarningCopy(usage), {
    key: "record.deleteUsedInThreadOne",
    params: { titles: "Alpha" },
  });
});

test("a bulk delete counts the recordings and names each thread once", () => {
  const usage = {
    "rec-1": [
      { id: "t1", title: "Alpha" },
      { id: "t2", title: "Beta" },
    ],
    "rec-2": [{ id: "t1", title: "Alpha" }],
  };
  assert.deepEqual(deleteThreadWarningCopy(usage, "bulk"), {
    key: "record.deleteUsedInThreadsBulk",
    params: { count: 2, titles: "Alpha, Beta" },
  });
});

test("past the naming limit the warning says how many names it hid", () => {
  const threads = ["Alpha", "Beta", "Gamma", "Delta", "Epsilon"].map((title, index) => ({
    id: `t${index}`,
    title,
  }));
  const copy = deleteThreadWarningCopy({ "rec-1": threads });
  assert.deepEqual(copy, {
    key: "record.deleteUsedInThreads",
    params: { count: 5, titles: `Alpha, Beta, Gamma +${5 - NAMED_THREAD_LIMIT}` },
  });
});

test("the limit is three names, and hidden names are counted, never dropped silently", () => {
  const make = (count: number) => ({
    "rec-1": Array.from({ length: count }, (_, index) => ({
      id: `t${index}`,
      title: `T${index}`,
    })),
  });
  assert.equal(deleteThreadWarningCopy(make(NAMED_THREAD_LIMIT))?.params.titles, "T0, T1, T2");
  assert.equal(
    deleteThreadWarningCopy(make(NAMED_THREAD_LIMIT + 1))?.params.titles,
    "T0, T1, T2 +1",
  );
});

test("every key this module can emit exists in both dictionaries", () => {
  // Read as a repo-relative path: the typed overload of readFileSync rejects a
  // URL, and the suite always runs from the repository root.
  const source = readFileSync("lib/i18n.tsx", "utf8");
  const keys = [
    "record.deleteUsedInThreadOne",
    "record.deleteUsedInThreads",
    "record.deleteUsedInThreadsBulk",
  ];
  for (const key of keys) {
    const values = source.split(`"${key}": "`).slice(1).map((chunk) => chunk.slice(0, chunk.indexOf('",')));
    assert.equal(values.length, 2, `${key} must be defined once per dictionary (English and Spanish)`);
    assert.notEqual(values[0], values[1], `${key} must be translated, not copied from English`);
    for (const value of values) {
      assert.ok(value.length > 0, `${key} must not be empty`);
    }
  }
});
