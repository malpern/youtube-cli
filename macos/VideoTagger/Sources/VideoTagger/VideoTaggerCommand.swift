import ArgumentParser
import Foundation
import TaggingKit

@main
struct VideoTaggerCommand: ParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "video-tagger",
        abstract: "Cluster and tag YouTube videos from an inventory snapshot.",
        version: "0.1.0"
    )

    @Option(name: .shortAndLong, help: "Path to inventory.json. If omitted, finds the latest in ./runs/.")
    var inventory: String?

    @Option(name: .shortAndLong, help: "Number of clusters to create.")
    var clusters: Int = 20

    @Option(name: .shortAndLong, help: "Output path for tags.json.")
    var output: String = "tags.json"

    @Option(name: .long, help: "Max k-means iterations.")
    var maxIterations: Int = 100

    @Flag(name: .long, help: "Print cluster summary to stdout instead of writing JSON.")
    var summary: Bool = false

    func run() throws {
        let inventoryUrl = try resolveInventoryPath()
        print("Loading inventory from \(inventoryUrl.path)...")

        let options = TaggingPipeline.Options(
            clusterCount: clusters,
            maxIterations: maxIterations
        )

        let result = try TaggingPipeline.run(
            inventoryPath: inventoryUrl,
            options: options
        )

        print("Embedded \(result.embeddedVideos) of \(result.totalVideos) videos")
        print("Clustered into \(result.clusterCount) groups in \(result.iterations) iterations")
        print()

        if summary {
            printSummary(result)
        } else {
            let outputUrl = URL(fileURLWithPath: output)
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
            let data = try encoder.encode(result)
            try data.write(to: outputUrl)
            print("Tags written to \(outputUrl.path)")
        }
    }

    private func resolveInventoryPath() throws -> URL {
        if let inventory {
            let url = URL(fileURLWithPath: inventory)
            guard FileManager.default.fileExists(atPath: url.path) else {
                throw ValidationError("Inventory file not found: \(inventory)")
            }
            return url
        }

        let runsDir = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
            .appendingPathComponent("runs")

        guard let latest = try InventoryLoader.findLatestInventory(in: runsDir) else {
            throw ValidationError("No inventory.json found in ./runs/. Specify --inventory path.")
        }

        return latest
    }

    private func printSummary(_ result: TaggingResult) {
        for cluster in result.clusters {
            let channels = cluster.topChannels.prefix(2).joined(separator: ", ")
            let channelNote = channels.isEmpty ? "" : " [\(channels)]"
            let label = cluster.label.padding(toLength: 40, withPad: " ", startingAt: 0)
            print("\(String(format: "%3d", cluster.videoCount)) videos  \(label)\(channelNote)")
        }
    }
}
