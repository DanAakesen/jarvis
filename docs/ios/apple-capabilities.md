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
separate compilation issue.

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


## Existing APNs key confirmed

The owner confirmed that **Jarvis APNs key**, Key ID `367DAUWL3Z`, already has
Push enabled. Reuse its downloaded `.p8` private key; no replacement is needed
for this integration if that file is available and the key permits production
Jarvis delivery. Store the key only in Azure Key Vault as `apns-signing-key`,
with `apns-key-id` and `apns-team-id`. The private key is not part of this record.
The existing signed-build configuration confirms Team ID `KCA96N89FA`.
Use that value for `apns-team-id` and `367DAUWL3Z` for `apns-key-id` in
`kv-jarvis-rmw7kae3bza6a`.
The primary has merged server configuration support; secret storage, activation
and installed receipt are not yet confirmed.

The owner has a downloaded `.p8`, but the shown filename is
`AuthKey_PAUD5A32KG.p8`, which indicates a different Key ID. Matching
`AuthKey_367DAUWL3Z.p8` or confirmation that PAUD5A32KG is an active APNs key is
still needed before choosing its runtime Key ID. Do not relabel a different key.
Readiness run 42627268441 confirms APNs is not wired into the backend yet;
Key Vault secret presence remains unverified because metadata listing failed.
