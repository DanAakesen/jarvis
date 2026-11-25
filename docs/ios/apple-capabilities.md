# Apple capabilities

Portal capability, checked-in entitlement, successful signing and device acceptance are separate.

| Capability | Current evidence |
| --- | --- |
| Push and App Groups | iPhone and Watch targets use the relevant app groups and entitlements. The backend references protected APNs signing configuration; successful readiness or an upload does not prove an alert reached a phone or Watch. |
| HealthKit | iPhone syncs HealthKit. The Watch reads daily steps from local HealthKit when authorised and uses them to refresh its signed-in paired-phone snapshot. The step reader does not write to HealthKit. |
| CarPlay Voice Based Conversation | The owner reported Apple's entitlement grant on 21 November 2026. The app has no configured CarPlay scene; capability activation, shipping and in-car behavior are not verified. |
| Maps and Location | The iPhone uses native MapKit and When In Use permission. An address can be supplied as the starting point. Portal routing-app capability is separate. Nearby business search and Directions are **not accepted on device**. |
| Associated Domains, Push to Talk, WeatherKit | Owner-reported portal enablement. Target coverage and service integration need verification before implementation. |

See the [checked-in target definitions](../../apps/ios/project.yml), [integration contract](integration-contract.md), and [current TestFlight checks](../../PLAN.md#next-steps-and-blockers). Never put team, signing-key or real device identifiers here.
