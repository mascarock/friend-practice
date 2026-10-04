import AppKit
let destination = CommandLine.arguments[1]
let size = 1024
let image = NSImage(size: NSSize(width: size, height: size))
image.lockFocus()
NSColor(calibratedWhite: 0.055, alpha: 1).setFill()
NSBezierPath(roundedRect: NSRect(x: 24, y: 24, width: 976, height: 976), xRadius: 195, yRadius: 195).fill()
NSColor(calibratedWhite: 0.82, alpha: 1).setStroke()
let frame = NSBezierPath(rect: NSRect(x: 224, y: 268, width: 576, height: 460))
frame.lineWidth = 16
frame.stroke()
let split = NSBezierPath()
split.move(to: NSPoint(x: 420, y: 268)); split.line(to: NSPoint(x: 420, y: 728)); split.lineWidth = 12; split.stroke()
for y in [350, 420, 490, 560, 630] {
    NSBezierPath(rect: NSRect(x: 266, y: y, width: 108, height: 12)).fill()
}
NSColor.white.setStroke()
let glyph = NSBezierPath()
glyph.move(to: NSPoint(x: 504, y: 565)); glyph.line(to: NSPoint(x: 555, y: 514)); glyph.line(to: NSPoint(x: 504, y: 463)); glyph.move(to: NSPoint(x: 590, y: 455)); glyph.line(to: NSPoint(x: 701, y: 455)); glyph.lineWidth = 18; glyph.stroke()
image.unlockFocus()
let data = NSBitmapImageRep(data: image.tiffRepresentation!)!.representation(using: .png, properties: [:])!
try data.write(to: URL(fileURLWithPath: destination))
