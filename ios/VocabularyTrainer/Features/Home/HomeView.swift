import SwiftUI

struct HomeView: View {
    @EnvironmentObject private var repository: VocabularyRepository
    @EnvironmentObject private var progressStore: ProgressStore
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    @Binding var isPracticing: Bool
    @Binding var sessionLength: Int

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 26) {
                brand
                introduction
                summary
                practiceCard
                sourceStatus
            }
            .frame(maxWidth: 640)
            .padding(.horizontal, 22)
            .padding(.top, 18)
            .padding(.bottom, 28)
            .frame(maxWidth: .infinity)
        }
        .scrollIndicators(.hidden)
        .background(WordTheme.canvas)
        .foregroundStyle(WordTheme.ink)
        .navigationTitle("ארבע מילים")
    }

    private var brand: some View {
        HStack(spacing: 12) {
            VStack(spacing: 3) {
                HStack(spacing: 3) {
                    RoundedRectangle(cornerRadius: 4).fill(WordTheme.forest)
                    RoundedRectangle(cornerRadius: 4).fill(WordTheme.coral)
                }
                HStack(spacing: 3) {
                    RoundedRectangle(cornerRadius: 4).fill(WordTheme.softGreen)
                    RoundedRectangle(cornerRadius: 4).fill(WordTheme.forest)
                }
            }
            .frame(width: 34, height: 34)
            .accessibilityHidden(true)

            Text("ארבע מילים")
                .font(.headline)
            Spacer()
            Text("אנגלית, בקצב שלך")
                .font(.caption.weight(.medium))
                .foregroundStyle(WordTheme.muted)
                .multilineTextAlignment(.leading)
        }
        .accessibilityElement(children: .combine)
    }

    private var introduction: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(progressStore.totalAttempts == 0 ? "מילה חדשה.\nצעד קטן קדימה." : "טוב שחזרתם.\nממשיכים לגלות מילים.")
                .font(.system(.largeTitle, design: .rounded, weight: .bold))
                .lineSpacing(3)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)

            Text("מילה באנגלית, ארבע אפשרויות בעברית. תרגול קצר שעוזר להפוך מילים חדשות למוכרות.")
                .font(.body)
                .foregroundStyle(WordTheme.muted)
                .lineSpacing(4)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var summary: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("הדרך שלכם")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(WordTheme.muted)
                .accessibilityAddTraits(.isHeader)

            let layout = (dynamicTypeSize >= .xxLarge)
                ? AnyLayout(VStackLayout(spacing: 10))
                : AnyLayout(HStackLayout(alignment: .top, spacing: 10))

            layout {
                MetricCard(
                    value: progressStore.learnedCount.formatted(),
                    label: "מילים נלמדו",
                    icon: "checkmark.seal",
                    tint: WordTheme.forest,
                    isHorizontal: (dynamicTypeSize >= .xxLarge)
                )
                MetricCard(
                    value: progressStore.totalAttempts == 0 ? "—" : "\(progressStore.accuracy)%",
                    label: "דיוק בתרגול",
                    icon: "scope",
                    tint: WordTheme.coral,
                    isHorizontal: (dynamicTypeSize >= .xxLarge)
                )
                MetricCard(
                    value: repository.entries.isEmpty ? "—" : repository.entries.count.formatted(),
                    label: "מילים בספרייה",
                    icon: "books.vertical",
                    tint: WordTheme.forest,
                    isHorizontal: (dynamicTypeSize >= .xxLarge)
                )
            }

            Text("מילה נחשבת נלמדת אחרי שלוש תשובות נכונות ברצף.")
                .font(.caption)
                .foregroundStyle(WordTheme.muted)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var practiceCard: some View {
        VStack(alignment: .leading, spacing: 18) {
            VStack(alignment: .leading, spacing: 6) {
                Text("פנו רגע למילים")
                    .font(.title2.bold())
                    .accessibilityAddTraits(.isHeader)
                Text("כמה מילים נתרגל הפעם?")
                    .font(.subheadline)
                    .foregroundStyle(WordTheme.muted)
            }

            let layout = (dynamicTypeSize >= .xxLarge)
                ? AnyLayout(VStackLayout(spacing: 10))
                : AnyLayout(HStackLayout(spacing: 10))

            layout {
                ForEach([10, 20, 30], id: \.self) { length in
                    sessionOption(length)
                }
            }
            .accessibilityElement(children: .contain)
            .accessibilityLabel("אורך התרגול")

            Button {
                isPracticing = true
            } label: {
                HStack(spacing: 12) {
                    Text(repository.entries.count < 4 ? "ממתינים לספריית המילים" : "מתחילים לתרגל")
                        .multilineTextAlignment(.leading)
                    Spacer(minLength: 8)
                    Image(systemName: "arrow.left")
                        .accessibilityHidden(true)
                }
            }
            .buttonStyle(WordPrimaryButtonStyle())
            .disabled(repository.entries.count < 4)
            .accessibilityHint("פותח תרגול של \(sessionLength) מילים")

            Label("אין לחץ. אפשר לגלות את התשובה ולהמשיך בקצב שלכם.", systemImage: "leaf")
                .font(.footnote)
                .foregroundStyle(WordTheme.muted)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(20)
        .background(WordTheme.paper, in: RoundedRectangle(cornerRadius: 28, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 28, style: .continuous)
                .stroke(WordTheme.line.opacity(0.7), lineWidth: 1)
        }
    }

    private func sessionOption(_ length: Int) -> some View {
        let isSelected = sessionLength == length
        return Button {
            sessionLength = length
        } label: {
            HStack(spacing: 6) {
                VStack(spacing: 3) {
                    Text(length.formatted())
                        .font(.title3.bold())
                        .monospacedDigit()
                    Text("מילים")
                        .font(.caption)
                }
                if isSelected {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.caption)
                        .accessibilityHidden(true)
                }
            }
            .foregroundStyle(isSelected ? WordTheme.forest : WordTheme.muted)
            .padding(.horizontal, 8)
            .padding(.vertical, 13)
            .frame(maxWidth: .infinity, minHeight: 68)
            .background(isSelected ? WordTheme.softGreen : WordTheme.canvas, in: RoundedRectangle(cornerRadius: 17, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 17, style: .continuous)
                    .stroke(isSelected ? WordTheme.forest : WordTheme.line, lineWidth: isSelected ? 1.5 : 1)
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(length) מילים")
        .accessibilityValue(isSelected ? "נבחר" : "")
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }

    @ViewBuilder
    private var sourceStatus: some View {
        VStack(alignment: .leading, spacing: 12) {
            switch repository.state {
            case .idle, .loading:
                HStack(spacing: 10) {
                    ProgressView()
                        .tint(WordTheme.forest)
                    Text("מכינים את ספריית המילים…")
                        .font(.subheadline)
                }
                .accessibilityElement(children: .combine)
            case .loaded:
                Label("הספרייה זמינה גם בלי חיבור", systemImage: "checkmark.circle")
                    .font(.subheadline.weight(.semibold))
                Text(librarySourceDescription)
                    .font(.footnote)
                    .foregroundStyle(WordTheme.muted)
                    .fixedSize(horizontal: false, vertical: true)
                refreshButton
            case .failed(let message):
                Label(message, systemImage: "exclamationmark.triangle")
                    .font(.subheadline)
                    .foregroundStyle(WordTheme.coral)
                    .fixedSize(horizontal: false, vertical: true)
                refreshButton
            }

            if let message = repository.refreshMessage {
                Text(message)
                    .font(.footnote)
                    .foregroundStyle(WordTheme.coral)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityLabel("עדכון הספרייה: \(message)")
            }
        }
        .foregroundStyle(WordTheme.muted)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 4)
    }

    private var refreshButton: some View {
        Button {
            Task { await repository.load(forceRefresh: true) }
        } label: {
            HStack(spacing: 8) {
                if repository.isRefreshing {
                    ProgressView()
                        .tint(WordTheme.forest)
                        .accessibilityHidden(true)
                } else {
                    Image(systemName: "arrow.clockwise")
                        .accessibilityHidden(true)
                }
                Text(repository.isRefreshing ? "בודקים עדכונים…" : "עדכון הספרייה מהמקור")
                    .font(.subheadline.weight(.semibold))
                    .multilineTextAlignment(.leading)
            }
            .foregroundStyle(WordTheme.forest)
            .frame(minHeight: 44, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(repository.isRefreshing)
        .accessibilityHint("נדרש חיבור לאינטרנט. המילים השמורות נשארות זמינות בזמן העדכון.")
    }

    private var librarySourceDescription: String {
        let count = repository.entries.count.formatted()
        switch repository.source {
        case .live:
            return "\(count) מילים, מעודכנות מגיליון המקור."
        case .cache:
            return "\(count) מילים מהספרייה השמורה במכשיר."
        case .bundled, .none:
            return "\(count) מילים כלולות באפליקציה, מוכנות לתרגול."
        }
    }
}

private struct MetricCard: View {
    let value: String
    let label: String
    let icon: String
    let tint: Color
    var isHorizontal = false

    var body: some View {
        let layout = isHorizontal
            ? AnyLayout(HStackLayout(spacing: 14))
            : AnyLayout(VStackLayout(alignment: .leading, spacing: 12))

        layout {
            Image(systemName: icon)
                .font(.title3)
                .foregroundStyle(tint)
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 5) {
                Text(value)
                    .font(.title2.bold())
                    .monospacedDigit()
                    .foregroundStyle(WordTheme.ink)
                    .environment(\.layoutDirection, .leftToRight)
                    .fixedSize(horizontal: false, vertical: true)
                Text(label)
                    .font(.caption)
                    .foregroundStyle(WordTheme.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if isHorizontal {
                Spacer(minLength: 0)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(WordTheme.paper, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(value == "—" ? "\(label): עדיין אין נתונים" : "\(label): \(value)")
    }
}
