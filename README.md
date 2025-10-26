SociaLock User App — Quick Start & WebRTC notes
-----------------------------------------------

1) Create Supabase project. Run sql/schema.sql in SQL editor.
2) Enable Google auth provider in Supabase (set redirect URLs per Expo instructions).
3) In user-app folder: npm install
4) Create .env with SUPABASE_URL and SUPABASE_ANON keys.
5) To use WebRTC on mobile, you must build a custom dev client or use EAS:
   - Install react-native-webrtc and configure native modules.
   - For Expo managed workflow, follow: https://expo.dev/eas
   - Alternatively test WebRTC in web (expo web) where browser WebRTC works.
6) Start app: npm run start, then Expo Go or emulator.

WebRTC specifics:
- This scaffold uses Supabase 'signals' table for signaling (offer/answer/ICE).
- react-native-webrtc required for native mobile; on web the standard RTCPeerConnection works.
- File transfer uses DataChannel chunked transfer; file saved to device local storage upon receive.

---
### Native WebRTC (react-native-webrtc) setup notes (required for P2P on mobile)
To get full WebRTC (audio/video and DataChannel file transfer) on real Android/iOS devices you must use the `react-native-webrtc` native module and build a custom client with EAS or use the bare workflow.

Quick steps (summary):
1. Ensure EAS CLI installed and logged in: `npm i -g eas-cli` and `eas login`.
2. Install react-native-webrtc in the user-app:
   - `cd user-app`
   - `npx expo install react-native-webrtc` OR `yarn add react-native-webrtc`
   - If using Expo managed workflow you'll need a **custom dev client** (EAS) because react-native-webrtc has native code.
3. Configure permissions for Android (microphone/camera) in `app.json` or native manifests.
4. Build a development client: `eas build --profile development --platform android` then install the apk for testing.
5. For iOS, use EAS to build and test on device (requires Apple developer account).

Important: The scaffold's WebRTC demo (`components/WebRTCChat.js`) uses browser RTCPeerConnection and will work in `expo web` automatically. For mobile, replace RTCPeerConnection usage with the one from `react-native-webrtc` import per its docs.

Resources:
- react-native-webrtc: https://github.com/react-native-webrtc/react-native-webrtc
- Expo custom dev client: https://docs.expo.dev/development/introduction/
