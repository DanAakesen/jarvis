import JarvisCore
import SwiftUI
import UIKit

/// Day and week share a scrollable clock. Week columns use the same hour scale as the day.
struct JarvisCalendarTimeline: View {
    let days: [Date]
    let events: [JarvisTodayCalendarEntry]
    let calendar: Calendar
    @Binding var selectedDay: Date
    let onSelect: (JarvisTodayCalendarEntry) -> Void
    let onMove: (JarvisTodayCalendarEntry, Date) -> Void

    let onCreate: (Date) -> Void

    @ScaledMetric private var hour: CGFloat = 40
    private let gutter: CGFloat = 39
    @State private var dragging: String?
    @State private var shift = CGSize.zero
    @State private var proposedStart: Date?

    private struct Slot: Identifiable {
        let event: JarvisTodayCalendarEntry
        let start, end: CGFloat
        let lane: Int
        var lanes: Int
        var id: String { event.id }
    }

    var body: some View {
        if days.count > 1 {
            GeometryReader { viewport in
                ScrollView(.horizontal) {
                    clockGrid.frame(width: max(viewport.size.width, gutter + CGFloat(days.count) * 84))
                }
            }.frame(height: 10 * hour + 61)
        } else {
            clockGrid
        }
    }

    private var clockGrid: some View {
        VStack(spacing: 3) {
            if days.count > 1 {
                HStack(spacing: 0) {
                    Color.clear.frame(width: gutter)
                    ForEach(days, id: \.self) { day in
                        Button { selectedDay = day } label: {
                            VStack(spacing: 0) {
                                Text(day, format: .dateTime.weekday(.abbreviated))
                                Text(day, format: .dateTime.day()).fontWeight(.semibold)
                            }.font(.caption).frame(maxWidth: .infinity, minHeight: 42)
                                .foregroundStyle(calendar.isDate(day, inSameDayAs: selectedDay) ? JarvisDesignTokens.primaryAccent : .primary)
                                .contentShape(Rectangle())
                        }.buttonStyle(.plain)
                        .accessibilityAddTraits(calendar.isDate(day, inSameDayAs: selectedDay) ? .isSelected : [])
                    }
                }
            }
            ScrollView(.vertical) {
                GeometryReader { geo in
                    let width = max(1, (geo.size.width - gutter) / CGFloat(days.count))
                    ZStack(alignment: .topLeading) {
                        if days.count > 1 {
                            Path { path in
                                for column in 1..<days.count {
                                    let x = gutter + CGFloat(column) * width
                                    path.move(to: CGPoint(x: x, y: 6))
                                    path.addLine(to: CGPoint(x: x, y: 6 + 24 * hour))
                                }
                            }
                            .stroke(.secondary.opacity(0.22), lineWidth: 0.5)
                            .allowsHitTesting(false)
                            .accessibilityHidden(true)
                        }
                        ForEach(0..<25) { index in
                            HStack(spacing: 3) {
                                Text(String(format: "%02d.00", index)).font(.caption2.monospacedDigit())
                                    .foregroundStyle(.secondary).frame(width: gutter - 3, alignment: .leading)
                                Rectangle().fill(.secondary.opacity(0.22)).frame(height: 0.5)
                            }
                            .frame(height: 12).offset(y: CGFloat(index) * hour)
                        }
                        TimelineView(.periodic(from: .now, by: 60)) { context in
                            if let column = days.firstIndex(where: { calendar.isDate($0, inSameDayAs: context.date) }) {
                                Path { path in
                                    let y = 6 + clock(context.date) * hour
                                    let x = gutter + CGFloat(column) * width
                                    path.move(to: CGPoint(x: x, y: y))
                                    path.addLine(to: CGPoint(x: x + width, y: y))
                                }
                                .stroke(JarvisDesignTokens.primaryAccent, style: StrokeStyle(lineWidth: 1, dash: [3, 3]))
                                .allowsHitTesting(false)
                            }
                        }
                        emptySlots(columnWidth: width)
                        ForEach(Array(days.enumerated()), id: \.element) { index, day in
                            ForEach(slots(day)) { slot in
                                let column = width / CGFloat(slot.lanes)
                                let active = dragging == slot.id
                                block(slot.event, compact: days.count > 1)
                                    .frame(width: max(1, column - 2), height: max(10, (slot.end - slot.start) * hour - 1),
                                           alignment: .topLeading)
                                    .background(JarvisDesignTokens.primaryAccent.opacity(active ? 0.34 : 0.17),
                                                in: RoundedRectangle(cornerRadius: 5))
                                    .clipShape(RoundedRectangle(cornerRadius: 5))
                                    .contentShape(Rectangle())
                                    .gesture(moveGesture(slot.event, width: width))
                                    .onTapGesture { onSelect(slot.event) }
                                    .accessibilityAddTraits(.isButton)
                                    .accessibilityAction { onSelect(slot.event) }
                                    .offset(x: gutter + CGFloat(index) * width + CGFloat(slot.lane) * column + (active ? shift.width : 0),
                                            y: 6 + slot.start * hour + (active ? shift.height : 0))
                                    .zIndex(active ? 2 : 1)
                            }
                        }
                    }
                }.frame(height: 24 * hour + 15)
            }
            .frame(height: 10 * hour + 15)
            // A 10-hour window centred in the 24-hour sheet starts at 07.00.
            .defaultScrollAnchor(.center, for: .initialOffset)
        }
    }

    @ViewBuilder
    private func emptySlots(columnWidth: CGFloat) -> some View {
        // This layer sits behind the appointment buttons and excludes the hour labels.
        CalendarBlankPress { state, point in
            switch state {
            case .began, .changed:
                proposedStart = slotStart(at: point, columnWidth: columnWidth)
            case .ended:
                proposedStart = nil
                if let start = slotStart(at: point, columnWidth: columnWidth) { onCreate(start) }
            default:
                proposedStart = nil
            }
        }
        .frame(width: columnWidth * CGFloat(days.count), height: 24 * hour)
        .offset(x: gutter, y: 6)
        .accessibilityHidden(true)

        if let start = proposedStart,
           let column = days.firstIndex(where: { calendar.isDate($0, inSameDayAs: start) }) {
            let time = clock(start)
            Text(start, style: .time)
                .font(.caption.weight(.semibold)).monospacedDigit()
                .padding(.horizontal, 4)
                .frame(width: max(1, columnWidth - 2), height: min(1, 24 - time) * hour, alignment: .topLeading)
                .foregroundStyle(JarvisDesignTokens.primaryAccent)
                .background(JarvisDesignTokens.primaryAccent.opacity(0.25), in: RoundedRectangle(cornerRadius: 5))
                .overlay { RoundedRectangle(cornerRadius: 5).strokeBorder(JarvisDesignTokens.primaryAccent) }
                .offset(x: gutter + CGFloat(column) * columnWidth, y: 6 + time * hour)
                .zIndex(3)
                .allowsHitTesting(false)
                .accessibilityHidden(true)
        }
    }

    private func slotStart(at point: CGPoint, columnWidth: CGFloat) -> Date? {
        guard !days.isEmpty else { return nil }
        let column = min(days.count - 1, max(0, Int(floor(point.x / columnWidth))))
        let quarter = min(95, max(0, Int((point.y / hour * 4).rounded())))
        return calendar.date(bySettingHour: quarter / 4, minute: quarter % 4 * 15, second: 0, of: days[column],
                             matchingPolicy: .nextTimePreservingSmallerComponents)
    }

    private func slots(_ day: Date) -> [Slot] {
        guard let range = calendar.dateInterval(of: .day, for: day) else { return [] }
        let entries = events.filter { $0.allDay != true && $0.start < range.end && $0.end > range.start }
            .sorted { ($0.start, $0.id) < ($1.start, $1.id) }
        var output: [Slot] = [], group: [Slot] = [], ends: [Date] = []
        func flush() {
            output += group.map { var item = $0; item.lanes = ends.count; return item }
            group.removeAll(); ends.removeAll()
        }
        for entry in entries {
            if let last = ends.max(), entry.start >= last { flush() }
            let lane = ends.firstIndex { $0 <= entry.start } ?? ends.count
            if lane == ends.count { ends.append(entry.end) } else { ends[lane] = entry.end }
            let start = entry.start <= range.start ? 0 : clock(entry.start)
            let end = entry.end >= range.end ? 24 : clock(entry.end)
            group.append(Slot(event: entry, start: start, end: max(start + 0.05, end), lane: lane, lanes: 1))
        }
        flush()
        return output
    }

    private func clock(_ date: Date) -> CGFloat {
        CGFloat(calendar.component(.hour, from: date)) + CGFloat(calendar.component(.minute, from: date)) / 60
    }

    private func block(_ event: JarvisTodayCalendarEntry, compact: Bool) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(event.title).font(compact ? .caption2 : .caption.weight(.semibold)).lineLimit(compact ? 2 : 1)
            if !compact {
                Text(event.start, style: .time).font(.caption2)
            }
        }.padding(.horizontal, compact ? 2 : 6).padding(.top, 2)
        .foregroundStyle(JarvisDesignTokens.primaryAccent)
        .accessibilityLabel(Text(event.title) + Text(", ") + Text(event.start, style: .time))
    }

    private func moveGesture(_ event: JarvisTodayCalendarEntry, width: CGFloat) -> some Gesture {
        LongPressGesture(minimumDuration: 0.4)
            .sequenced(before: DragGesture(minimumDistance: 1))
            .onChanged { value in
                if case let .second(true, drag) = value {
                    dragging = event.id; shift = drag?.translation ?? .zero
                }
            }
            .onEnded { value in
                defer { dragging = nil; shift = .zero }
                guard case let .second(true, drag?) = value else { return }
                let daysMoved = days.count == 1 ? 0 : Int((drag.translation.width / width).rounded())
                let minutes = Int((drag.translation.height / hour * 4).rounded()) * 15
                guard minutes != 0 || daysMoved != 0,
                      let day = calendar.date(byAdding: .day, value: daysMoved, to: event.start),
                      let start = calendar.date(byAdding: .minute, value: minutes, to: day) else { return }
                onMove(event, start)
            }
    }
}

/// A stationary hold reports its location even when the finger lifts without dragging.
private struct CalendarBlankPress: UIViewRepresentable {
    let update: (UIGestureRecognizer.State, CGPoint) -> Void

    final class TouchSurface: UIView {
        var update: ((UIGestureRecognizer.State, CGPoint) -> Void)?

        @objc func press(_ recognizer: UILongPressGestureRecognizer) {
            update?(recognizer.state, recognizer.location(in: self))
        }
    }

    func makeUIView(context: Context) -> TouchSurface {
        let view = TouchSurface()
        let press = UILongPressGestureRecognizer(target: view, action: #selector(TouchSurface.press(_:)))
        press.minimumPressDuration = 0.4
        view.addGestureRecognizer(press)
        return view
    }

    func updateUIView(_ view: TouchSurface, context: Context) {
        view.update = update
    }
}
