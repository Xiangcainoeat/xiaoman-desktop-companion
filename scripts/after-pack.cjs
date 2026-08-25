const { execFileSync } = require("node:child_process");
const path = require("node:path");

const UNUSED_INFO_KEYS = [
  "NSAppTransportSecurity",
  "NSAudioCaptureUsageDescription",
  "NSBluetoothAlwaysUsageDescription",
  "NSBluetoothPeripheralUsageDescription",
  "NSCameraUsageDescription",
  "NSMicrophoneUsageDescription",
];

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") {
    return;
  }

  const appName = `${context.packager.appInfo.productFilename}.app`;
  const infoPath = path.join(context.appOutDir, appName, "Contents", "Info.plist");

  for (const key of UNUSED_INFO_KEYS) {
    try {
      execFileSync("/usr/bin/plutil", ["-remove", key, infoPath], {
        stdio: "ignore",
      });
    } catch {
      // A missing optional key already satisfies the privacy boundary.
    }
  }
};
