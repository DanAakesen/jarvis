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
