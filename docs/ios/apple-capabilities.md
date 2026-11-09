# Apple capabilities recorded by the owner

## 9 November 2026

The owner reports enabling these capabilities in Apple Developer:

- Associated Domains
- CarPlay Voice Based Conversation
- Push to Talk
- WeatherKit
- Maps

The owner subsequently confirmed **HealthKit** and **Push to Talk** were also
enabled specifically for the Apple Watch App ID. These are portal capabilities;
the current Watch companion still obtains health snapshots through the paired
iPhone and does not yet implement a Push to Talk service integration.

Preserve this as available portal setup for future feature planning. Enabling a
portal capability does not implement its app behavior, add target entitlements,
configure domains/services or prove any separately required Apple approval.
The owner previously submitted the CarPlay entitlement request; no approval reply
has been recorded. The specific App IDs receiving the five additions were not
enumerated in the message, so check target coverage when integrating a feature.

The owner also associated `group.com.danaakesen.jarvis` with both Watch App IDs:
`com.danaakesen.jarvis.watchkitapp` and
`com.danaakesen.jarvis.watchkitapp.widgets`. Signed TestFlight attempt 88
(42613537731) advanced past the previous App Group provisioning failure and then
failed on shared-code integer overflow for watchOS arm64_32. PR #1679 fixes that
separate compilation issue. Signed iPhone/Watch build 89 uploaded successfully
in run 42635187842 on 9 November. Apple processing and physical-device acceptance
remain separate checks.

Current iPhone source uses Push Notifications, HealthKit, shared App Groups and
the Microsoft authentication keychain group. APNs uses signing-key authentication;
the certificate-creation dialog does not require new push SSL certificates.

## Next feature candidates

These are planning candidates, not claims of implementation or instructions to
build them automatically. Prioritize them with the owner after the current
Factory, Watch and intelligent-notification release.

| Capability | Feature to consider | Integration still needed |
| --- | --- | --- |
| Watch HealthKit | Record workouts directly on Watch and supply live workout metrics | Watch authorization, workout session lifecycle, background delivery and reconciliation with iPhone uploads |
| Push to Talk | A deliberate press-to-speak Jarvis experience | Confirm platform/API support, audio-session behavior, service integration and device testing; portal enablement alone is not proof of watchOS support |
| Associated Domains | Open Jarvis notes, tasks and findings from universal links | Domain association file, target entitlements and authenticated in-app routing |
| WeatherKit | Weather-aware workout and daily suggestions | WeatherKit credentials, location choice, attribution and source integration |
| Maps | Places, travel and route-aware assistance | Location consent and concrete destination/navigation flows |
| CarPlay Voice Based Conversation | Hands-free Jarvis conversations in the car | Confirm Apple entitlement approval, supported CarPlay templates and vehicle testing |

Intelligent notifications are current authorized implementation work in PR #1669,
separate from these candidates. They reuse existing APNs registrations and saved
Jarvis data; they do not establish new Watch background health uploads.


## Production APNs activated — 9 November 2026

The owner created a replacement APNs key after the private file for the earlier
key could not be located. The replacement Key ID is held in Key Vault; it was not
read into this record. Do not reuse the previously discussed IDs `367DAUWL3Z` or
`PAUD5A32KG` from old instructions.

Run 42635939897 verified all three secrets in `kv-jarvis-rmw7kae3bza6a` through
ARM metadata: `apns-team-id`, `apns-key-id` and `apns-signing-key`. Team ID
`KCA96N89FA` is confirmed by the signed-build configuration. Private key values
were not retrieved or logged.

Activation run 42636282777 passed at 14:47 UTC. Backend revision `0000565` is
ready with production APNs and protected Key Vault references. Native approval
notifications, proactive checks/alerts, push and Health are enabled. Deployment
42635181674 also passed readiness and live conversation acceptance for the
intelligent-notification release, including startup migration 0076.

Actual APNs acceptance, phone receipt and notification-tap routing still require
an installed-device check. Watch notification mirroring is also a device check;
this does not establish Watch background HealthKit upload or workout recording.
