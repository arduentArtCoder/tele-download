import assert from "node:assert/strict";
import test from "node:test";

import { curateDownloadOptions, getDeliveryModeForSize } from "./ytDlp.js";

test("curateDownloadOptions keeps one best candidate per height and caps the list", () => {
  const options = curateDownloadOptions(
    [
      { format_id: "401", vcodec: "avc1", acodec: "none", height: 2160, width: 3840, filesize: 80 * 1024 * 1024 },
      { format_id: "22", vcodec: "avc1", acodec: "mp4a", height: 1080, width: 1920, filesize: 30 * 1024 * 1024 },
      { format_id: "137", vcodec: "avc1", acodec: "none", height: 1080, width: 1920, filesize: 40 * 1024 * 1024 },
      { format_id: "136", vcodec: "avc1", acodec: "none", height: 720, width: 1280, filesize: 20 * 1024 * 1024 },
      { format_id: "135", vcodec: "avc1", acodec: "none", height: 480, width: 854, filesize: 10 * 1024 * 1024 },
      { format_id: "134", vcodec: "avc1", acodec: "none", height: 360, width: 640, filesize: 6 * 1024 * 1024 },
      { format_id: "133", vcodec: "avc1", acodec: "none", height: 240, width: 426, filesize: 4 * 1024 * 1024 },
      { format_id: "140", vcodec: "none", acodec: "mp4a", filesize: 5 * 1024 * 1024 },
    ],
    50 * 1024 * 1024,
  );

  assert.equal(options.length, 5);
  assert.deepEqual(
    options.map((option) => option.id),
    ["option-1", "option-2", "option-3", "option-4", "option-5"],
  );
  assert.equal(options[0]?.height, 2160);
  assert.equal(options[0]?.deliveryMode, "link");
  assert.equal(options[1]?.height, 1080);
  assert.equal(options[1]?.formatSelector, "22");
  assert.equal(options[1]?.deliveryMode, "telegram");
  assert.equal(options[4]?.height, 360);
});

test("getDeliveryModeForSize switches to hosted links above the Telegram limit", () => {
  const limit = 50 * 1024 * 1024;

  assert.equal(getDeliveryModeForSize(limit, limit), "telegram");
  assert.equal(getDeliveryModeForSize(limit + 1, limit), "link");
  assert.equal(getDeliveryModeForSize(undefined, limit), "telegram");
});
