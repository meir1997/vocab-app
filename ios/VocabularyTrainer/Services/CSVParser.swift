import Foundation

enum CSVParser {
    enum ParseError: Error {
        case malformedQuotes
    }

    static func rows(from text: String) -> [[String]] {
        (try? parse(text)) ?? []
    }

    /// Reads Unicode scalars so Swift's combined CRLF Character cannot hide record breaks.
    /// Quoted CR/LF stays inside the field; malformed quotes reject the whole download.
    static func parse(_ text: String) throws -> [[String]] {
        let scalars = text.unicodeScalars
        var rows: [[String]] = []
        var row: [String] = []
        var field = ""
        var quoted = false
        var closedQuote = false
        var index = scalars.startIndex

        if index < scalars.endIndex, scalars[index] == "\u{FEFF}" {
            index = scalars.index(after: index)
        }

        func finishField() {
            row.append(field)
            field = ""
            closedQuote = false
        }

        func finishRow() {
            finishField()
            if row.contains(where: { !$0.isEmpty }) {
                rows.append(row)
            }
            row = []
        }

        while index < scalars.endIndex {
            let scalar = scalars[index]
            let next = scalars.index(after: index)
            if quoted {
                if scalar == "\"" {
                    if next < scalars.endIndex, scalars[next] == "\"" {
                        field.unicodeScalars.append("\"")
                        index = scalars.index(after: next)
                        continue
                    }
                    quoted = false
                    closedQuote = true
                } else {
                    field.unicodeScalars.append(scalar)
                }
            } else if scalar == "," {
                finishField()
            } else if scalar == "\r" || scalar == "\n" {
                finishRow()
                if scalar == "\r", next < scalars.endIndex, scalars[next] == "\n" {
                    index = scalars.index(after: next)
                    continue
                }
            } else if scalar == "\"", field.isEmpty, !closedQuote {
                quoted = true
            } else {
                guard scalar != "\"", !closedQuote else { throw ParseError.malformedQuotes }
                field.unicodeScalars.append(scalar)
            }
            index = next
        }

        guard !quoted else { throw ParseError.malformedQuotes }
        if !field.isEmpty || !row.isEmpty || closedQuote {
            finishRow()
        }
        return rows
    }
}
