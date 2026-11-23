import CoreLocation
import JarvisCore
import MapKit
import SwiftUI

/// Displays the current phone's temporary MapKit response to a conversational lookup.
struct JarvisAppleMapsCard: View {
    let card: AppleMapsViewData
    @ObservedObject private var store = JarvisAppleMapsStore.shared
    @State private var selection: Int?
    @State private var refreshing = false
    @State private var handoffFailed = false

    var body: some View {
        VStack(alignment: .leading, spacing: JarvisDesignTokens.rowSpacing) {
            if let result = store.result(for: card.lookupId) {
                if !result.places.isEmpty {
                    map(for: result)
                    if result.places.count > 1 {
                        ForEach(result.places.indices, id: \.self) { index in
                            let place = result.places[index]
                            JarvisLabelledButton(
                                title: place.name, subtitle: place.address, systemImage: "mappin",
                                trailingSystemImage: selection == index ? "checkmark" : nil,
                                isFullWidth: true, isLeading: true, isSelected: selection == index
                            ) {
                                selection = index
                                handoffFailed = false
                            }
                        }
                    }
                    if let place = selectedPlace(in: result) {
                        if result.places.count == 1 {
                            Text(place.name).font(.headline)
                            Text(place.address).font(.subheadline).foregroundStyle(.secondary)
                        }
                        if let seconds = place.travelSeconds {
                            let minutes = max(1, Int(ceil(seconds / 60)))
                            Label("About \(minutes) min \(result.mode == "walking" ? "walking" : "driving")",
                                  systemImage: result.mode == "walking" ? "figure.walk" : "car")
                            if let arrival = result.arriveBy.flatMap(AppleMapsResult.date) {
                                let leave = arrival.addingTimeInterval(-seconds - Double(result.bufferMinutes ?? 0) * 60)
                                Text("Leave by \(leave.formatted(date: .abbreviated, time: .shortened))")
                                if let buffer = result.bufferMinutes, buffer > 0 {
                                    Text("Includes a \(buffer) min buffer").font(.footnote).foregroundStyle(.secondary)
                                }
                            }
                            if let observed = AppleMapsResult.date(result.observedAt) {
                                Text("Estimated at \(observed.formatted(date: .omitted, time: .shortened))")
                                    .font(.footnote).foregroundStyle(.secondary)
                            }
                        }
                        JarvisLabelledButton(title: "Directions", systemImage: "arrow.triangle.turn.up.right.diamond",
                                             identifier: "maps.directions", isEmphasised: true) {
                            Task { await directions(to: place, result: result) }
                        }
                    }
                }
                if let reason = result.reason { Text(reason).font(.footnote).foregroundStyle(.secondary) }
                if result.places.isEmpty {
                    refreshButton(title: "Search again")
                }
            } else {
                Text(card.request.query).font(.body)
                refreshButton(title: "Look up in Apple Maps")
            }
            if handoffFailed {
                Text("Apple Maps couldn’t open directions.").font(.footnote).foregroundStyle(.secondary)
            }
        }
        .privacySensitive()
        .onChange(of: card.lookupId) { _, _ in
            selection = nil
            handoffFailed = false
        }
    }

    private func selectedPlace(in result: AppleMapsResult) -> AppleMapsPlace? {
        if result.places.count == 1 { return result.places[0] }
        guard let selection, result.places.indices.contains(selection) else { return nil }
        return result.places[selection]
    }

    private func map(for result: AppleMapsResult) -> some View {
        Map(interactionModes: []) {
            ForEach(result.places.indices, id: \.self) { index in
                let place = result.places[index]
                Marker(place.name, coordinate: .init(latitude: place.latitude, longitude: place.longitude))
            }
            if let selected = selectedPlace(in: result), let path = selected.path, path.count > 1 {
                MapPolyline(coordinates: path.map { .init(latitude: $0.latitude, longitude: $0.longitude) })
                    .stroke(.blue, lineWidth: 4)
            }
        }
        .mapStyle(.standard)
        .frame(height: 148)
        .accessibilityLabel("Map showing \(result.places.map(\.name).joined(separator: ", "))")
    }

    private func refreshButton(title: String) -> some View {
        JarvisLabelledButton(title: title, systemImage: "map", identifier: "maps.refresh",
                             isBusy: refreshing, isDisabled: refreshing) {
            refreshing = true
            Task {
                await store.refresh(lookupId: card.lookupId, request: card.request)
                selection = nil
                refreshing = false
            }
        }
    }

    @MainActor
    private func directions(to place: AppleMapsPlace, result: AppleMapsResult) async {
        let destination = MKMapItem(location: CLLocation(latitude: place.latitude, longitude: place.longitude), address: nil)
        destination.name = place.name
        var items: [MKMapItem] = []
        if let origin = result.origin, origin.isCurrentLocation != true {
            let start = MKMapItem(location: CLLocation(latitude: origin.latitude, longitude: origin.longitude), address: nil)
            start.name = origin.name
            items.append(start)
        }
        items.append(destination)
        let mode = result.mode == "walking" ? MKLaunchOptionsDirectionsModeWalking : MKLaunchOptionsDirectionsModeDriving
        let opened = await MKMapItem.openMaps(with: items, launchOptions: [MKLaunchOptionsDirectionsModeKey: mode])
        handoffFailed = !opened
    }
}
