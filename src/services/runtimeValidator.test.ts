import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildChromeProfileValidationError, resolveChromeCookiesPath } from "./runtimeValidator.js";

test("resolveChromeCookiesPath uses the expected Linux Chrome cookie database layout", () => {
  assert.equal(
    resolveChromeCookiesPath("Default"),
    path.join(os.homedir(), ".config", "google-chrome", "Default", "Cookies"),
  );
});

test("resolveChromeCookiesPath supports named secondary profiles", () => {
  assert.equal(
    resolveChromeCookiesPath("Profile 2"),
    path.join(os.homedir(), ".config", "google-chrome", "Profile 2", "Cookies"),
  );
});

test("buildChromeProfileValidationError explains real directory names vs UI labels", () => {
  const checkedPath = path.join(os.homedir(), ".config", "google-chrome", "Arthur", "Cookies");
  const message = buildChromeProfileValidationError("Arthur", checkedPath);

  assert.match(message, /CHROME_PROFILE="Arthur"/u);
  assert.match(message, /Checked path:/u);
  assert.match(message, /Default/u);
  assert.match(message, /Profile 2/u);
  assert.match(message, /UI profile names may not match/u);
});
