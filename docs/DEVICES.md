# Testing on your Android and iOS phones

The phones provide real-device testing, but do not replace build tools. The current development server binds only to this computer's loopback address. **127.0.0.1 on a phone normally means the phone, not the computer.** Nothing has been installed on either phone, no device has been connected, and no LAN/public exposure has been configured.

## Android — preferred local USB route

Prerequisites on this Windows computer: Android SDK Platform 35, compatible Build Tools, Platform Tools (`adb`), JDK 21, and the phone's Windows USB driver if required. The SDK was not configured at the last build attempt. Install/configure it through Android Studio's SDK Manager, or provide an existing SDK path through `ANDROID_HOME`/`android/local.properties`.

1. On your own phone, enable Developer options and USB debugging, connect via USB, and approve this computer's debugging fingerprint.
2. Check the selected device with `adb devices`. If more than one is connected, use `adb -s YOUR_SERIAL` for every command below.
3. Build the app:

   ```sh
   cd android
   ./gradlew assembleDebug
   ```

4. Install the development APK and reverse the backend port:

   ```sh
   adb install -r app/build/outputs/apk/debug/app-debug.apk
   adb reverse tcp:8080 tcp:8080
   ```

5. In the native app, change **Server URL** to `http://127.0.0.1:8080`, sign in with your individual staff username/password. Initial owner credentials are in `.env` on first installation; changing an existing password must use the account workflow, not environment variables. `10.0.2.2` is for emulators, not physical phones. HTTP loopback is allowed only by the debug network configuration; do not weaken the release configuration.

To exercise the new **web** Orders/Kitchen workspaces in Android Chrome, additionally run:

```sh
adb reverse tcp:5173 tcp:5173
```

Open `http://127.0.0.1:5173` in Chrome on that phone. Vite proxies API calls on the computer. This USB route does not require exposing the dev server to Wi-Fi or the public internet.

Remove these routes when finished:

```sh
adb reverse --remove tcp:8080
adb reverse --remove tcp:5173
```

Disable USB debugging or revoke the computer's debugging authorization when it is no longer needed. These commands are instructions only; they have not been run against your phone.

## iPhone/iPad — native app

A Mac with Xcode, the iOS SDK and XcodeGen is needed to build the current SwiftUI project. Physical installation also requires configuring Apple development signing for your device. Owning an iPhone alone does not allow this Windows host to compile/sign the native app.

Generate/open the project as described in `../README.md`, choose your signing team and connected device in Xcode, and run a Debug build. Use an explicitly configured, reachable development **HTTPS** backend on the physical device; the default `localhost` URL is for a simulator on the backend's Mac, not a physical iPhone.

Do not add arbitrary-load exceptions or send passwords/session tokens to an untrusted/tunnel URL. We have not selected a hosting/certificate/signing setup yet.

## iPhone/iPad — web workspaces

The responsive web UI can be used in Safari once a trusted HTTPS development endpoint is configured and reachable from the phone. Windows development server localhost is not directly reachable as the iPhone's localhost; Android's `adb reverse` does not apply to iOS.

A desktop Chrome viewport capture is useful for layout review but is not a real iPhone/Safari test. No physical iOS test has been performed.

## What to check on actual devices

- New order → correct demo bill/tax totals → cash recorded once.
- Park an unpaid web bill → find it in Orders & bills → resume the same bill.
- Kitchen ticket appears once; preparation progresses separately from payment.
- Two staff screens cannot accidentally skip a stage with stale controls.
- Network interruption never appears as payment success; uncertain requests retain their IDs/transition intent for retry.
- Touch targets, keyboard visibility, rotation, background/resume and receipt readability.

The native authentication sources now use individual login, sign-out and session-revocation handling, but have not been compiled or run after those changes. They currently expose the initial takeaway checkout only; kitchen-only staff must use the web KDS until native kitchen screens exist. The new order history and KDS workspaces are implemented on the web; all clients' newly created orders receive a server-side kitchen ticket. Native workspace parity is a later task, not a verified feature today.
