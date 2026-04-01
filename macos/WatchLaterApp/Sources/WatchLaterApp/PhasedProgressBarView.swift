import SwiftUI

struct PhasedProgressBarView: View {
    let progress: Double
    let markers: [Double]

    var body: some View {
        GeometryReader { geometry in
            let clampedProgress = min(max(progress, 0), 1)

            ZStack(alignment: .leading) {
                Capsule(style: .continuous)
                    .fill(Color(nsColor: .controlColor))

                Capsule(style: .continuous)
                    .fill(Color.accentColor)
                    .frame(width: max(geometry.size.width * clampedProgress, 8))

                ForEach(Array(markers.enumerated()), id: \.offset) { _, marker in
                    Rectangle()
                        .fill(Color.white.opacity(0.55))
                        .frame(width: 1.5)
                        .padding(.vertical, 1)
                        .offset(x: geometry.size.width * marker)
                }
            }
        }
        .frame(height: 10)
        .accessibilityHidden(true)
    }
}
