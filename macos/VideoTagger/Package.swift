// swift-tools-version: 6.2

import PackageDescription

let package = Package(
    name: "VideoTagger",
    platforms: [.macOS(.v14)],
    products: [
        .library(name: "TaggingKit", targets: ["TaggingKit"]),
        .executable(name: "video-tagger", targets: ["VideoTagger"])
    ],
    dependencies: [
        .package(url: "https://github.com/apple/swift-argument-parser.git", from: "1.5.0")
    ],
    targets: [
        .target(
            name: "TaggingKit",
            dependencies: []
        ),
        .executableTarget(
            name: "VideoTagger",
            dependencies: [
                "TaggingKit",
                .product(name: "ArgumentParser", package: "swift-argument-parser")
            ]
        ),
        .testTarget(
            name: "TaggingKitTests",
            dependencies: ["TaggingKit"]
        )
    ]
)
