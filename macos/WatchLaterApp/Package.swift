// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "WatchLaterApp",
    platforms: [
        .macOS(.v14)
    ],
    products: [
        .executable(
            name: "WatchLaterApp",
            targets: ["WatchLaterApp"]
        )
    ],
    targets: [
        .executableTarget(
            name: "WatchLaterApp",
            path: "Sources/WatchLaterApp"
        )
    ]
)
