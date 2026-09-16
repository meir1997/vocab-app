import SwiftUI

struct HomeView: View {
    @EnvironmentObject private var repository: VocabularyRepository
    @EnvironmentObject private var progressStore: ProgressStore

    @Binding var isPracticing: Bool
    @Binding var sessionLength: Int

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                header
                summary
                sessionPicker
                startButton
                sourceStatus
            }
            .padding(20)
        }
        .background(Color(.systemGroupedBackground))
        .navigationTitle("ארבע מילים")
        .navigationBarTitleDisplayMode(.inline)
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("מילים. בקצב שלך.")
                .font(.system(size: 34, weight: .bold, design: .rounded))
            Text("בכל שאלה בוחרים תרגום אחד מתוך ארבעה. לא בטוחים? מסמנים „לא יודע” והמילה תחזור בהמשך.")
                .font(.body)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var summary: some View {
        HStack(spacing: 12) {
            MetricCard(value: "\(progressStore.learnedCount)", label: "נלמדו", icon: "checkmark.seal.fill", tint: .green)
            MetricCard(value: "\(progressStore.accuracy)%", label: "דיוק", icon: "scope", tint: .blue)
            MetricCard(value: "\(repository.entries.count)", label: "במאגר", icon: "books.vertical.fill", tint: .purple)
        }
    }

    private var sessionPicker: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("אורך התרגול")
                .font(.headline)
            Picker("אורך התרגול", selection: $sessionLength) {
                Text("10 מילים").tag(10)
                Text("20 מילים").tag(20)
                Text("30 מילים").tag(30)
            }
            .pickerStyle(.segmented)
        }
        .padding(18)
        .background(.background, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
    }

    private var startButton: some View {
        Button {
            isPracticing = true
        } label: {
            HStack {
                Text("מתחילים תרגול")
                    .font(.headline)
                Spacer()
                Image(systemName: "arrow.left")
            }
            .padding(.horizontal, 20)
            .frame(maxWidth: .infinity, minHeight: 58)
        }
        .buttonStyle(.borderedProminent)
        .buttonBorderShape(.roundedRectangle(radius: 18))
        .tint(.indigo)
        .disabled(repository.entries.count < 4)
    }

    @ViewBuilder
    private var sourceStatus: some View {
        switch repository.state {
        case .idle, .loading:
            Label("טוענים את אוצר המילים…", systemImage: "arrow.triangle.2.circlepath")
                .foregroundStyle(.secondary)
        case .loaded:
            Label("אוצר המילים זמין גם אופליין", systemImage: "checkmark.icloud.fill")
                .foregroundStyle(.secondary)
        case .failed(let message):
            VStack(alignment: .leading, spacing: 10) {
                Label(message, systemImage: "exclamationmark.triangle.fill")
                    .foregroundStyle(.orange)
                Button("ניסיון נוסף") {
                    Task { await repository.load(forceRefresh: true) }
                }
            }
        }
    }
}

private struct MetricCard: View {
    let value: String
    let label: String
    let icon: String
    let tint: Color

    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: icon)
                .font(.title3)
                .foregroundStyle(tint)
            Text(value)
                .font(.title3.bold())
                .monospacedDigit()
            Text(label)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 16)
        .background(.background, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
    }
}
