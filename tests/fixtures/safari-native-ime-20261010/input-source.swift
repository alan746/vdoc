import Carbon
import Foundation
func string(_ s:TISInputSource,_ key:CFString)->String {guard let p=TISGetInputSourceProperty(s,key) else{return ""};return Unmanaged<CFString>.fromOpaque(p).takeUnretainedValue() as String}
let current=TISCopyCurrentKeyboardInputSource().takeRetainedValue()
if CommandLine.arguments.count==1 {print(string(current,kTISPropertyInputSourceID));exit(0)}
let sources=TISCreateInputSourceList(nil,false).takeRetainedValue() as! [TISInputSource]
if CommandLine.arguments[1]=="list" {for s in sources {print(string(s,kTISPropertyInputSourceID)+" | "+string(s,kTISPropertyLocalizedName))}}
else if let s=sources.first(where:{string($0,kTISPropertyInputSourceID)==CommandLine.arguments[1]}) {let result=TISSelectInputSource(s);print("status=\(result) selected="+string(TISCopyCurrentKeyboardInputSource().takeRetainedValue(),kTISPropertyInputSourceID))}
else {print("Requested enabled input source not found");exit(1)}
