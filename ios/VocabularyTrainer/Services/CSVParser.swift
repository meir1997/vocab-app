import Foundation

enum CSVParser {
    static func rows(from text: String) -> [[String]] {
        var rows: [[String]] = []
        var row: [String] = []
        var field = ""
        var isInsideQuotes = false
        var index = text.startIndex

        while index < text.endIndex {
            let character = text[index]

            if character == "\"" {
                let next = text.index(after: index)
                if isInsideQuotes, next < text.endIndex, text[next] == "\"" {
                    field.append("\"")
                    index = text.index(after: next)
                    continue
                }
                isInsideQuotes.toggle()
            } else if character == ",", !isInsideQuotes {
                row.append(field)
                field = ""
            } else if (character == "\n" || character == "\r"), !isInsideQuotes {
                if character == "\r" {
                    let next = text.index(after: index)
                    if next < text.endIndex, text[next] == "\n" {
                        index = next
                    }
                }
                row.append(field)
                if row.contains(where: { !$0.isEmpty }) {
                    rows.append(row)
                }
                row = []
                field = ""
            } else {
                field.append(character)
            }

            index = text.index(after: index)
        }

        row.append(field)
        if row.contains(where: { !$0.isEmpty }) {
            rows.append(row)
        }

        return rows
    }
}
