/**
 * Kaiming GUI Capture helper.
 *
 * A deliberately tiny, signed macOS app behind the model-facing `gui` tool. It has no shell, no
 * network code and no application control: it only converts one validated capture request into a
 * PNG and a JSON status file. The helper is the process that receives macOS Screen Recording
 * permission, so the tester's sandbox and the workbench's Node process do not need it.
 *
 * Arguments (all fixed by the host tool):
 *   --out PATH --status PATH --target screen|region|window
 *   [--display N] [--window-id N] [--x N --y N --width N --height N]
 *
 * Status is written even on failure. TCC denial is a real failure, never a fabricated image.
 */
import Foundation
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

let maxCoordinate = 100_000
let maxDimension = 100_000
let maxWindowId = 2_147_483_647
let maxDisplayIndex = 31

struct Options {
    var target = ""
    var out: String?
    var status: String?
    var display: Int?
    var windowId: Int?
    var x: Int?
    var y: Int?
    var width: Int?
    var height: Int?
}

func writeStatus(_ object: [String: Any]) {
    guard let path = options.status else { return }
    let url = URL(fileURLWithPath: path)
    guard let data = try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]) else { return }
    try? data.write(to: url, options: [.atomic])
}

func ensureTcc() {
    guard CGPreflightScreenCaptureAccess() else {
        fail("TCC_DENIED", "Screen Recording permission is not granted to the Kaiming GUI Capture helper")
    }
}

func fail(_ code: String, _ message: String) -> Never {
    writeStatus(["ok": false, "code": code, "message": message])
    exit(1)
}

func integer(_ value: String?) -> Int? {
    guard let value, let parsed = Int(value), String(parsed) == value || value.hasPrefix("-") && String(parsed) == value else {
        return nil
    }
    return parsed
}

var options = Options()
var index = 1
let arguments = CommandLine.arguments
while index < arguments.count {
    let arg = arguments[index]
    if arg == "--out" { index += 1; options.out = index < arguments.count ? arguments[index] : nil }
    else if arg == "--status" { index += 1; options.status = index < arguments.count ? arguments[index] : nil }
    else if arg == "--target" { index += 1; options.target = index < arguments.count ? arguments[index] : "" }
    else if arg == "--display" {
        index += 1
        guard index < arguments.count, let value = integer(arguments[index]) else { fail("INVALID_ARGUMENT", "display must be an integer") }
        options.display = value
    } else if arg == "--window-id" {
        index += 1
        guard index < arguments.count, let value = integer(arguments[index]) else { fail("INVALID_ARGUMENT", "window-id must be an integer") }
        options.windowId = value
    } else if arg == "--x" {
        index += 1
        guard index < arguments.count, let value = integer(arguments[index]) else { fail("INVALID_ARGUMENT", "x must be an integer") }
        options.x = value
    } else if arg == "--y" {
        index += 1
        guard index < arguments.count, let value = integer(arguments[index]) else { fail("INVALID_ARGUMENT", "y must be an integer") }
        options.y = value
    } else if arg == "--width" {
        index += 1
        guard index < arguments.count, let value = integer(arguments[index]) else { fail("INVALID_ARGUMENT", "width must be an integer") }
        options.width = value
    } else if arg == "--height" {
        index += 1
        guard index < arguments.count, let value = integer(arguments[index]) else { fail("INVALID_ARGUMENT", "height must be an integer") }
        options.height = value
    } else {
        fail("INVALID_ARGUMENT", "unknown argument: \(arg)")
    }
    index += 1
}

guard let out = options.out, let status = options.status else {
    fail("INVALID_ARGUMENT", "--out and --status are required")
}
guard !out.isEmpty, !status.isEmpty else {
    fail("INVALID_ARGUMENT", "--out and --status must not be empty")
}

let outURL = URL(fileURLWithPath: out)
let statusURL = URL(fileURLWithPath: status)
options.out = outURL.path
options.status = statusURL.path

var requestedTarget = options.target
if requestedTarget != "screen" && requestedTarget != "region" && requestedTarget != "window" {
    fail("INVALID_ARGUMENT", "target must be screen, region or window")
}

var image: CGImage?
if requestedTarget == "screen" {
    if options.windowId != nil || options.x != nil || options.y != nil || options.width != nil || options.height != nil {
        fail("INVALID_ARGUMENT", "screen accepts only the optional display")
    }
    if let display = options.display {
        guard display >= 0 && display <= maxDisplayIndex else {
            fail("INVALID_ARGUMENT", "display must be between 0 and \(maxDisplayIndex)")
        }
        var count: UInt32 = 0
        var displays = [CGDirectDisplayID](repeating: 0, count: maxDisplayIndex + 1)
        let result = displays.withUnsafeMutableBufferPointer { buffer in
            CGGetActiveDisplayList(UInt32(buffer.count), buffer.baseAddress, &count)
        }
        guard result == .success, display < Int(count) else {
            fail("CAPTURE_FAILED", "display \(display) is not available")
        }
        ensureTcc()
        image = CGDisplayCreateImage(displays[display])
    } else {
        ensureTcc()
        image = CGDisplayCreateImage(CGMainDisplayID())
    }
} else if requestedTarget == "window" {
    if options.display != nil || options.x != nil || options.y != nil || options.width != nil || options.height != nil {
        fail("INVALID_ARGUMENT", "window accepts only window-id")
    }
    guard let windowId = options.windowId, windowId >= 1, windowId <= maxWindowId else {
        fail("INVALID_ARGUMENT", "window-id must be between 1 and \(maxWindowId)")
    }
    ensureTcc()
    image = CGWindowListCreateImage(
        CGRect.null,
        .optionIncludingWindow,
        CGWindowID(windowId),
        [.bestResolution, .boundsIgnoreFraming]
    )
} else {
    if options.display != nil || options.windowId != nil {
        fail("INVALID_ARGUMENT", "region accepts only x, y, width and height")
    }
    guard let x = options.x, let y = options.y, let width = options.width, let height = options.height else {
        fail("INVALID_ARGUMENT", "region needs x, y, width and height")
    }
    guard x >= -maxCoordinate && x <= maxCoordinate, y >= -maxCoordinate && y <= maxCoordinate else {
        fail("INVALID_ARGUMENT", "x and y must be between -\(maxCoordinate) and \(maxCoordinate)")
    }
    guard width >= 1 && width <= maxDimension, height >= 1 && height <= maxDimension else {
        fail("INVALID_ARGUMENT", "width and height must be between 1 and \(maxDimension)")
    }
    ensureTcc()
    image = CGWindowListCreateImage(
        CGRect(x: x, y: y, width: width, height: height),
        .optionOnScreenOnly,
        kCGNullWindowID,
        [.bestResolution, .boundsIgnoreFraming]
    )
}

guard let captured = image else {
    fail("CAPTURE_FAILED", "CoreGraphics could not capture \(requestedTarget); the window or region may not be visible")
}

guard let destination = CGImageDestinationCreateWithURL(outURL as CFURL, UTType.png.identifier as CFString, 1, nil) else {
    fail("CAPTURE_FAILED", "could not create the PNG destination")
}
CGImageDestinationAddImage(destination, captured, nil)
guard CGImageDestinationFinalize(destination) else {
    fail("CAPTURE_FAILED", "could not write the PNG")
}

writeStatus(["ok": true, "bytes": 0, "target": requestedTarget])
exit(0)
