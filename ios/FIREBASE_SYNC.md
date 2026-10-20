# Native Firebase synchronization

## Status and scope

`chatgpt-design-ios` was rebased cleanly onto main `9d34630398b8b8ff0b0ba1ec3875cc468dcf325d`, then `chatgpt-ios-firebase` was created from it. This branch includes the preceding native design/offline-library commits. Web application files are read-only references and are unchanged by this work.

The app supports Google → Firebase Authentication and two-way Firestore synchronization with the existing **vocab-app-meir** project. **The native Firebase registration file is not present in the repository.** The app deliberately remains usable offline and does not initialize Firebase or offer an unusable Google login when that registration is missing.

## Native setup

1. In the existing Firebase project `vocab-app-meir`, register/select the iOS app whose bundle ID matches the app target. The current target remains `com.example.VocabularyTrainer`; choose the intended production bundle ID before registration/release and update both Debug and Release if needed.
2. Download that iOS app's `GoogleService-Info.plist`, with its iOS OAuth `CLIENT_ID` and `REVERSED_CLIENT_ID`. Place it at `ios/VocabularyTrainer/Resources/Firebase/GoogleService-Info.plist`. The path is ignored by Git. Do not use the web app ID or invent an iOS OAuth client.
3. Confirm Google is enabled under Firebase Authentication for this same project. If OAuth consent/test-user restrictions apply to the native client, complete those in the project console.
4. Open `ios/VocabularyTrainer.xcodeproj` in **Xcode 26.2 or later**, select the shared `VocabularyTrainer` scheme, resolve packages, and configure the intended Apple signing team for a physical device.
5. The build generates Info.plist from the committed template and registers the downloaded `REVERSED_CLIENT_ID` automatically. The native configuration folder is copied as a resource; no project editing or duplicate manual callback-scheme entry is needed.

The build/runtime validators check the project (`vocab-app-meir`), sender (`71704465708`), native `:ios:` app ID, bundle ID, API/OAuth client formatting, and registered callback scheme. Firebase SDK **12.19.2** and Google Sign-In **10.0.0** are pinned exactly: the current Firebase 13 / Google Sign-In 10 releases have incompatible App Check package requirements. No package lock or native client identifier is fabricated.

## Shared Firestore contract

Source: `app.js` on main `9d34630398`. The only document read or written is `users/{FirebaseAuth.uid}`. Values use the web representation; dates are **numeric epoch milliseconds**, not Firestore Timestamp values.

| Location | Representation |
| --- | --- |
| `fw.progress.<original English word>` | `{r: correct, w: incorrectOrUnknown, s: consecutiveCorrect, next: epochMilliseconds}` |
| `fw.settings` | `{length: positiveInteger or "all", mode: string, goal: positiveInteger}` |
| `fw.stats` | `{attempts, correct, days: {"YYYY-MM-DD": {a: attempts, c: correct}}}` |
| `fw.bands` | `{current: hundredBand, recent: [0 or 1]}`; recent has at most 50 answers |
| `fwUpdatedAt` | numeric epoch milliseconds, also used by the web for preference conflict resolution |
| `email` | authenticated user's email or null |

A word is known when `s >= 2`, matching the web. There is no separate cloud `knownWords`, serial, schema-version, or tombstone field. Word keys retain source spelling (`Mr`, `c.`, etc.); iOS's lowercase identity is a local projection. Dotted word names remain literal nested dictionary keys. Original source ranks supply the displayed serial and 100-word band; gaps from duplicates are retained and the last serial is **10000**.

The merge selects the entire word record with more total attempts, breaking ties with the later `next`. It does not add counters from replicas. The higher band wins; equal bands adopt the longer recent window. Settings follow the web document timestamp when the remote settings include `length`. Statistics retain the larger-total winner and merge the union of day keys with per-day maxima. The day-key union preserves local days that the current web's replacement step can otherwise discard. Unknown JSON fields and words round-trip.

Native choice practice also honors synchronized length (including `all`) and bands. It preserves web `typing`/`reverse` mode values instead of overwriting them; the native quiz currently remains multiple-choice and displays that distinction. A new word outside the current band is not silently introduced or marked learned.

## Delivery and account isolation

- Local answers, preferences and pending state are persisted before network access. A missing network never replaces the complete library or deletes local progress.
- A server observation is required before an initial upload. Each write is a Firestore transaction that reads the current document, merges, and writes with `merge: true`; transaction retries do not mutate the UI/store.
- Identical snapshots do not cause an upload loop. SDK pending-write snapshots are not treated as confirmed remote data. A write's server echo is deferred until its completion so a later local preference edit cannot be overwritten by an older acknowledgement.
- Anonymous practice has its own namespace. Existing `wordProgress.v1` migrates once; guest work is claimed only by the first signed-in UID on this installation. Other accounts have independent durable stores. Signing out returns to the guest store without copying the signed-in user's private progress to it.
- Account changes detach listeners, invalidate old callbacks and pending tasks, and dismiss the active quiz. A quiz created for a previous UID cannot record into the current account. A network request already committed by Firestore cannot be undone on logout, but its late completion cannot modify another account's local state.
- Failed deliveries remain pending; a server observation, foreground entry, manual retry, or reconnect retry resumes delivery.

The existing web contract has no deletion/reset tombstones or per-answer event IDs. Concurrent device counters are resolved by its winner rules rather than summed; cloud reset/removal propagation and exact accumulation of simultaneous answers are not promised. No incompatible cloud schema or production security-rule changes are introduced here.

## Validation and remaining checks

Local Windows checks: six portable Python tests for native Info.plist/callback generation, four existing Node import tests, complete source/rank comparison for all 9,998 words, project references, and protected-web diff checks. No local Swift compiler, Xcode or physical iPhone is available.

There are **52 XCTest methods** (12 prior + 40 new). New cases cover model encoding/merge, raw casing, dotted keys, numeric milliseconds, unknown-field preservation, known status, rank/band boundaries, legacy migration, separate UID stores, stale listeners, same-UID reconnect, late acknowledgements, later settings/answer edits, offline retry, native configuration validation, and unavailable-auth behavior. Tests use isolated UserDefaults and fake cloud transport; they do not authenticate or write to production Firebase. The macOS CI workflow resolves the real SDK packages, builds the app and runs this suite.

Still requires the actual native configuration and a real device/account: Google OAuth presentation/callback, persisted sign-in and logout, matching the web Firebase UID, deployed Firestore rules allowing only the signed-in owner's document, real network transitions, background/foreground delivery, and an end-to-end web ↔ iOS round trip. Example owner-rule condition to verify in the existing deployment is `request.auth != null && request.auth.uid == userId`; this branch does not deploy rules or loosen access.

References: [Firebase Google sign-in](https://firebase.google.com/docs/auth/ios/google-signin), [Google native setup](https://developers.google.com/identity/sign-in/ios/start-integrating), [Firestore transactions](https://firebase.google.com/docs/firestore/manage-data/transactions), [snapshot metadata](https://firebase.google.com/docs/reference/swift/firebasefirestore/api/reference/Classes/SnapshotMetadata), [Firebase release notes](https://firebase.google.com/support/release-notes/ios).
