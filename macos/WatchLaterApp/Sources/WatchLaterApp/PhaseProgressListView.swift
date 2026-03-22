import SwiftUI

struct PhaseProgressListView: View {
    @Bindable var model: TransferViewModel

    var body: some View {
        VStack(spacing: 12) {
            ForEach(model.phaseProgressRows) { snapshot in
                PhaseProgressRowView(snapshot: snapshot)
            }
        }
        .padding(.top, 4)
    }
}
